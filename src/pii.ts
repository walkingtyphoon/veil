// Veil: local PII detection, masking and rehydration.
// Everything in this file runs in the browser. Nothing here touches the network.

export type EntityType =
  | 'PERSON' | 'EMAIL' | 'PHONE' | 'ADDRESS' | 'POSTCODE' | 'ORG'
  | 'ID_NUMBER' | 'CARD' | 'DATE' | 'URL' | 'OTHER';

export interface Entity {
  type: EntityType;
  text: string;
  source: 'rule' | 'on_device_ai';
}

export interface MaskResult {
  masked: string;
  /** placeholder -> original value. Stays on the device. */
  vault: Record<string, string>;
  count: number;
}

function luhnOk(digits: string): boolean {
  let sum = 0;
  let dbl = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (dbl) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
    dbl = !dbl;
  }
  return digits.length >= 13 && sum % 10 === 0;
}

/** Digits of a 13-19 digit card/account run, or null when the run is a different length. */
function cardDigits(value: string): string | null {
  if (value.replace(/[\d -]/g, '') !== '') return null;
  const digits = value.replace(/\D/g, '');
  return digits.length >= 13 && digits.length <= 19 ? digits : null;
}

function isDateLike(value: string): boolean {
  if (/^(?:19|20)\d{2}$/.test(value)) return true;
  if (/^(?:19|20)\d{2}[-/.](?:0?[1-9]|1[0-2])[-/.](?:0?[1-9]|[12]\d|3[01])$/.test(value)) return true;
  return /^(?:\d{1,2}[-/](?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[-/](?:19|20)?\d{2}|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[-/](?:\d{1,2}[-/])?(?:19|20)?\d{2})$/i.test(value);
}

const MONTH = /^(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)$/i;

interface Rule { type: EntityType; re: RegExp; check?: (m: string) => boolean }

const RULES: Rule[] = [
  { type: 'EMAIL', re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g },
  { type: 'URL', re: /https?:\/\/[^\s)>\]]+/g },
  // Entire digit run (spaces, dashes, or contiguous). Length is checked afterwards so a
  // longer number is not clipped to a 13-19 digit prefix.
  { type: 'CARD', re: /\b\d(?:[ -]?\d){12,}\b/g, check: (m) => { const d = cardDigits(m); return !!d && luhnOk(d); } },
  { type: 'ID_NUMBER', re: /\b\d(?:[ -]?\d){12,}\b/g, check: (m) => { const d = cardDigits(m); return !!d && !luhnOk(d); } },
  // Japanese "My Number" (12 digits, optionally grouped 4-4-4). Do not eat a prefix of a longer run.
  { type: 'ID_NUMBER', re: /(?<![\d][ -])\b\d{4}[ -]?\d{4}[ -]?\d{4}\b(?![ -]?\d)/g },
  // Passport-like and hyphenated ids: RC-448213, AB1234567, E12345678. Not month names.
  { type: 'ID_NUMBER', re: /\b(?:[A-Za-z]{2,3}-?\d{6,10}|[A-Za-z]-?\d{7,8})\b/g, check: (m) => !MONTH.test(/^[A-Za-z]+/.exec(m)?.[0] ?? '') },
  // Phones: international (+81 90-1234-5678) and Japanese domestic (090-1234-5678, 03-1234-5678)
  { type: 'PHONE', re: /(?:\+\d{1,3}[ -]?)?\(?0?\d{1,4}\)?[ -]\d{2,4}[ -]\d{3,4}\b/g },
  { type: 'POSTCODE', re: /〒?\s?\b\d{3}-\d{4}\b/g },
  { type: 'DATE', re: /\b(?:19|20)\d{2}[-/.](?:0?[1-9]|1[0-2])[-/.](?:0?[1-9]|[12]\d|3[01])\b/g },
];

// Labeled identifiers. The label stays in the text; only the value is masked.
const LABELED_ID = new RegExp(
  String.raw`\b((?:patient|member|policy|account|passport|insurance|national)\s*(?:number|no|i\.?d|#)` +
    String.raw`|mrn|case\s*(?:#|number|no|i\.?d)|ref(?:erence)?(?:\s*(?:#|number|no|i\.?d))?)\s*(?![A-Za-z])\s*([:#.]*)\s*` +
    String.raw`([A-Za-z0-9](?:[A-Za-z0-9]|[/-](?=[A-Za-z0-9])){3,39})`,
  'gi',
);

function acceptLabeledId(label: string, sep: string, value: string): boolean {
  if (!/\d/.test(value) || isDateLike(value)) return false;
  const digits = value.replace(/\D/g, '');
  // Pure 4-digit values are usually years or too small to be an id. Alphanumeric ids can be shorter.
  if (digits.length < 4 || (!/[A-Za-z]/.test(value) && digits.length < 5)) return false;
  // Bare "reference 12000" is prose. "Reference: 883419" / "Ref No. 883419" is an id.
  if (/^(?:ref|reference)$/i.test(label) && !sep && !/[A-Za-z-]/.test(value)) return false;
  return true;
}

function detectLabeledIds(text: string): Entity[] {
  const out: Entity[] = [];
  LABELED_ID.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = LABELED_ID.exec(text)) !== null) {
    const label = m[1];
    const value = m[3];
    if (!label || !value || !acceptLabeledId(label, m[2] ?? '', value)) continue;
    out.push({ type: 'ID_NUMBER', text: value, source: 'rule' });
  }
  return out;
}

/** IBAN mod-97. Letters expand to A=10..Z=35. A valid IBAN has remainder 1. */
function ibanChecksumOk(compact: string): boolean {
  const rearranged = (compact.slice(4) + compact.slice(0, 4)).toUpperCase();
  let rem = 0;
  for (const c of rearranged) {
    const code = c.charCodeAt(0);
    const chunk = code >= 65 && code <= 90 ? String(code - 55) : c;
    for (const ch of chunk) rem = (rem * 10 + (ch.charCodeAt(0) - 48)) % 97;
  }
  return rem === 1;
}

const IBAN_START = /\b[A-Za-z]{2}\d{2}(?=[A-Za-z0-9 ])/g;
const IBAN_BODY = /^[A-Za-z]{2}\d{2}(?:[A-Za-z0-9]{1,30}|(?: [A-Za-z0-9]{1,4}\b){1,12})/;

function ibanAt(slice: string): string | null {
  const body = IBAN_BODY.exec(slice);
  if (!body) return null;
  const parts = body[0].split(' ');
  // Longest first, then drop trailing words ("now", "today") until mod-97 passes.
  for (let n = parts.length; n >= 1; n--) {
    const compact = parts.slice(0, n).join('');
    if (compact.length < 15 || compact.length > 34) continue;
    if (!/^[A-Za-z]{2}\d{2}[A-Za-z0-9]+$/.test(compact)) continue;
    if (ibanChecksumOk(compact)) return parts.slice(0, n).join(' ');
  }
  return null;
}

function detectIbans(text: string): Entity[] {
  const out: Entity[] = [];
  IBAN_START.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = IBAN_START.exec(text)) !== null) {
    const value = ibanAt(text.slice(m.index, m.index + 70));
    if (!value) continue;
    out.push({ type: 'ID_NUMBER', text: value, source: 'rule' });
    IBAN_START.lastIndex = m.index + value.length;
  }
  return out;
}

const NAME = String.raw`[A-Z][a-z]+(?:[ -][A-Z][a-z]+){0,2}`;
// Heuristic name cues used when Gemini Nano is not available: honorifics and salutations.
const NAME_CUES: RegExp[] = [
  new RegExp(String.raw`\b(?:Dr|Mr|Mrs|Ms|Prof)\.?\s+(${NAME})`, 'g'),
  new RegExp(String.raw`\b(?:Dear|Hi|Hello|To:|Patient:|Name:|Best,|Regards,|From:)\s+(${NAME})`, 'g'),
];

function detectNames(text: string): Entity[] {
  const out: Entity[] = [];
  for (const re of NAME_CUES) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const name = m[1].trim();
      if (name.length >= 3) out.push({ type: 'PERSON', text: name, source: 'rule' });
    }
  }
  return out;
}

/** Deterministic, rule-based detector. Always runs, even when no AI model is available. */
export function detectByRules(text: string): Entity[] {
  const out: Entity[] = [];
  const taken: Array<[number, number]> = [];
  for (const rule of RULES) {
    rule.re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = rule.re.exec(text)) !== null) {
      const value = m[0].trim();
      const start = m.index;
      const end = start + m[0].length;
      if (!value || (rule.check && !rule.check(value))) {
        // Keep a too-long digit run reserved so a later rule cannot mask only a fragment of it.
        const digits = value.replace(/\D/g, '');
        if (digits.length > 19 && value.replace(/[\d -]/g, '') === '') taken.push([start, end]);
        continue;
      }
      if (taken.some(([s, e]) => start < e && end > s)) continue; // earlier rules win overlaps
      taken.push([start, end]);
      out.push({ type: rule.type, text: value, source: 'rule' });
    }
  }
  return mergeEntities(out, detectNames(text), detectLabeledIds(text), detectIbans(text));
}

const VALID_TYPES = new Set<EntityType>([
  'PERSON', 'EMAIL', 'PHONE', 'ADDRESS', 'POSTCODE', 'ORG', 'ID_NUMBER', 'CARD', 'DATE', 'URL', 'OTHER',
]);

/**
 * Parse the JSON returned by the on-device model and keep only entities
 * that literally occur in the source text (guards against hallucinated spans).
 */
export function parseModelEntities(json: string, source: string): Entity[] {
  let data: unknown;
  try { data = JSON.parse(json); } catch { return []; }
  const list = (data as { entities?: unknown })?.entities;
  if (!Array.isArray(list)) return [];
  const out: Entity[] = [];
  for (const item of list) {
    const type = String((item as { type?: unknown })?.type ?? '').toUpperCase() as EntityType;
    const text = String((item as { text?: unknown })?.text ?? '').trim();
    if (text.length < 2 || !source.includes(text)) continue;
    out.push({ type: VALID_TYPES.has(type) ? type : 'OTHER', text, source: 'on_device_ai' });
  }
  return out;
}

/** Merge entity lists, dropping duplicates and entities fully contained in a longer one. */
export function mergeEntities(...lists: Entity[][]): Entity[] {
  const all = lists.flat();
  const byText = new Map<string, Entity>();
  for (const e of all) if (!byText.has(e.text)) byText.set(e.text, e);
  const uniq = [...byText.values()].sort((a, b) => b.text.length - a.text.length);
  return uniq.filter((e, i) => !uniq.slice(0, i).some((longer) => longer.text.includes(e.text)));
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Replace every entity with a stable placeholder like [PERSON_1]. */
export function mask(text: string, entities: Entity[]): MaskResult {
  const vault: Record<string, string> = {};
  const counters: Partial<Record<EntityType, number>> = {};
  let masked = text;
  // Longest first so "Taro Yamada" is replaced before "Taro".
  const ordered = [...entities].sort((a, b) => b.text.length - a.text.length);
  for (const e of ordered) {
    if (!masked.includes(e.text)) continue;
    const n = (counters[e.type] ?? 0) + 1;
    counters[e.type] = n;
    const ph = `[${e.type}_${n}]`;
    vault[ph] = e.text;
    masked = masked.replace(new RegExp(escapeRe(e.text), 'g'), ph);
  }
  return { masked, vault, count: Object.keys(vault).length };
}

/** Put the original values back into a model answer, locally. */
export function rehydrate(text: string, vault: Record<string, string>): string {
  return text.replace(/\[([A-Z_]+_\d+)\]/g, (whole, inner) => vault[`[${inner}]`] ?? whole);
}

/** Final safety net: true if any vault value would still leave the device. */
export function leaks(payload: string, vault: Record<string, string>): string[] {
  return Object.values(vault).filter((v) => payload.includes(v));
}
