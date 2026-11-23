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

interface Rule { type: EntityType; re: RegExp; check?: (m: string) => boolean }

const RULES: Rule[] = [
  { type: 'EMAIL', re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g },
  { type: 'URL', re: /https?:\/\/[^\s)>\]]+/g },
  { type: 'CARD', re: /\b(?:\d[ -]?){13,19}\b/g, check: (m) => luhnOk(m.replace(/\D/g, '')) },
  // Japanese "My Number" (12 digits, optionally grouped 4-4-4)
  { type: 'ID_NUMBER', re: /\b\d{4}[ -]?\d{4}[ -]?\d{4}\b/g },
  // Passport-like: 1-2 letters followed by 7-8 digits
  { type: 'ID_NUMBER', re: /\b[A-Z]{1,2}\d{7,8}\b/g },
  // Phones: international (+81 90-1234-5678) and Japanese domestic (090-1234-5678, 03-1234-5678)
  { type: 'PHONE', re: /(?:\+\d{1,3}[ -]?)?\(?0?\d{1,4}\)?[ -]\d{2,4}[ -]\d{3,4}\b/g },
  { type: 'POSTCODE', re: /〒?\s?\b\d{3}-\d{4}\b/g },
  { type: 'DATE', re: /\b(?:19|20)\d{2}[-/.](?:0?[1-9]|1[0-2])[-/.](?:0?[1-9]|[12]\d|3[01])\b/g },
];

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
      if (!value || (rule.check && !rule.check(value))) continue;
      if (taken.some(([s, e]) => start < e && end > s)) continue; // earlier rules win overlaps
      taken.push([start, end]);
      out.push({ type: rule.type, text: value, source: 'rule' });
    }
  }
  return mergeEntities(out, detectNames(text));
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
