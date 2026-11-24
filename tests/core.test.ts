import { describe, it, expect } from 'vitest';
import { detectByRules, mask, rehydrate, leaks, mergeEntities, parseModelEntities } from '../src/pii';
import { decideRoute, DEFAULT_POLICY } from '../src/router';
import { SAMPLES } from '../src/samples';

const SAMPLE = `Dear Dr. Sato,
My name is Taro Yamada (taro.yamada@example.jp, 090-1234-5678).
I live at 〒150-0001 Shibuya 1-2-3. My Number: 1234 5678 9012.
Card 4111 1111 1111 1111 was charged on 2026-11-02.`;

describe('rule detector', () => {
  it('finds structured identifiers', () => {
    const types = detectByRules(SAMPLE).map((e) => e.type);
    expect(types).toContain('EMAIL');
    expect(types).toContain('PHONE');
    expect(types).toContain('CARD');
    expect(types).toContain('ID_NUMBER');
    expect(types).toContain('POSTCODE');
    expect(types).toContain('DATE');
  });
  it('rejects numbers that fail the Luhn check as cards', () => {
    const text = 'ref 4111 1111 1111 1112';
    const ents = detectByRules(text);
    expect(ents.some((e) => e.type === 'CARD')).toBe(false);
    const { masked, vault } = mask(text, ents);
    expect(masked).not.toContain('1112');
    expect(masked).not.toContain('4111');
    expect(rehydrate(masked, vault)).toBe(text);
  });
});

const CLINIC_BUG = 'Dear Mr. Daniel Brooks, your lab results from Riverside Clinic dated 3 Nov 2026 are ready. Patient ID: RC-448213. Please call 415-555-0137 or email d.brooks@example.com. Your account 4532-1188-0042-9917 will be billed $120.';

describe('card, account, and labeled ids', () => {
  it('masks the reported rules-only leak and rehydrates', () => {
    const ents = detectByRules(CLINIC_BUG);
    const { masked, vault } = mask(CLINIC_BUG, ents);
    expect(masked).toBe(
      'Dear Mr. [PERSON_1], your lab results from Riverside Clinic dated 3 Nov 2026 are ready. Patient ID: [ID_NUMBER_2]. Please call [PHONE_1] or email [EMAIL_1]. Your account [ID_NUMBER_1] will be billed $120.',
    );
    expect(leaks(masked, vault)).toEqual([]);
    expect(rehydrate(masked, vault)).toBe(CLINIC_BUG);
  });

  it('does not leave a leftover group of a number longer than 19 digits', () => {
    const groups = ['1234', '5678', '9012', '3456', '7890'];
    const samples = [
      'token 1234-5678-9012-3456-7890 end',
      'token 1234 5678 9012 3456 7890 end',
      'token 12345678901234567890 end',
    ];
    for (const text of samples) {
      const { masked, vault } = mask(text, detectByRules(text));
      expect(rehydrate(masked, vault), text).toBe(text);
      const left = groups.filter((group) => masked.includes(group));
      expect(left.length === 0 || left.length === groups.length, masked).toBe(true);
    }
  });

  it('masks 13-19 digit account numbers with spaces, dashes, or no separator', () => {
    const formats = [
      '4532-1188-0042-9917',
      '4532 1188 0042 9917',
      '4532118800429917',
      '4532 1188-0042 9917',
      '1234567890123',
      '1234 5678 9012 3456 789',
    ];
    for (const value of formats) {
      const text = `pay ${value} today`;
      const ents = detectByRules(text);
      expect(ents.some((e) => e.text === value), value).toBe(true);
      const { masked, vault } = mask(text, ents);
      const digits = value.replace(/\D/g, '');
      expect(masked, value).not.toContain(digits.slice(0, 4));
      expect(masked, value).not.toContain(digits.slice(-4));
      expect(rehydrate(masked, vault)).toBe(text);
    }
  });

  it('keeps Luhn-valid cards typed as cards in every common grouping', () => {
    const formats = [
      '4111 1111 1111 1111',
      '4111-1111-1111-1111',
      '4111111111111111',
      '378282246310005',
      '3782 822463 10005',
      '4222222222222',
    ];
    for (const value of formats) {
      const text = `card ${value} ok`;
      const ents = detectByRules(text);
      expect(ents.some((e) => e.type === 'CARD' && e.text === value), value).toBe(true);
      const { masked, vault } = mask(text, ents);
      expect(masked, value).not.toContain(value.replace(/\D/g, '').slice(-4));
      expect(rehydrate(masked, vault)).toBe(text);
    }
  });

  it('masks labeled alphanumeric ids and still rehydrates', () => {
    const text = [
      'Member ID: M-99281.',
      'Policy No. POL-392814.',
      'MRN: 00482137.',
      'Passport No. TK9876543.',
      'Case # 2024-CR-1882.',
      'Reference: REF-88341.',
      'National ID: Y12345678.',
      'Patient I.D.: rc-448213.',
      'Seen on 3 Nov 2026.',
      'Balance $120.',
      'Year 2026.',
    ].join(' ');
    const hidden = ['M-99281', 'POL-392814', '00482137', 'TK9876543', '2024-CR-1882', 'REF-88341', 'Y12345678', 'rc-448213'];
    const { masked, vault } = mask(text, detectByRules(text));
    for (const value of hidden) expect(masked, value).not.toContain(value);
    expect(masked).toContain('3 Nov 2026');
    expect(masked).toContain('$120');
    expect(masked).toContain('Year 2026');
    expect(rehydrate(masked, vault)).toBe(text);
    expect(leaks(masked, vault)).toEqual([]);
  });

  it('masks compact and grouped IBANs without taking the following word', () => {
    const text = 'Send GB82WEST12345698765432 or GB82 WEST 1234 5698 7654 32 today. DE89 3704 0044 0532 0130 00 now.';
    const { masked, vault } = mask(text, detectByRules(text));
    expect(masked).not.toContain('GB82');
    expect(masked).not.toContain('WEST');
    expect(masked).not.toContain('DE89');
    expect(masked).not.toContain('3704');
    expect(masked).toContain('today');
    expect(masked).toContain('now');
    expect(rehydrate(masked, vault)).toBe(text);
  });

  it('does not mask dates, amounts, years, or a short bank account', () => {
    const text = 'DOB 1994-03-17, filed 3 Nov 2026, billed $120 in 2026, account 1234567, call +81 90-1234-5678.';
    const ents = detectByRules(text);
    expect(ents.some((e) => e.type === 'DATE' && e.text === '1994-03-17')).toBe(true);
    expect(ents.some((e) => e.type === 'PHONE')).toBe(true);
    const { masked, vault } = mask(text, ents);
    expect(masked).toContain('3 Nov 2026');
    expect(masked).toContain('$120');
    expect(masked).toContain('in 2026');
    expect(masked).toContain('1234567');
    expect(masked).not.toContain('90-1234-5678');
    expect(rehydrate(masked, vault)).toBe(text);
  });

  it('still round-trips the demo documents', () => {
    for (const sample of Object.values(SAMPLES)) {
      const { masked, vault } = mask(sample.text, detectByRules(sample.text));
      expect(leaks(masked, vault), sample.label).toEqual([]);
      expect(rehydrate(masked, vault), sample.label).toBe(sample.text);
    }
    const lease = mask(SAMPLES.lease.text, detectByRules(SAMPLES.lease.text)).masked;
    expect(lease).toContain('98,000');
    expect(lease).toContain('1234567');
    const clinic = mask(SAMPLES.clinic.text, detectByRules(SAMPLES.clinic.text)).masked;
    expect(clinic).toContain('6.4%');
    expect(clinic).toContain('3,200');
  });
});

describe('model output parsing', () => {
  it('keeps only spans present in the text', () => {
    const json = JSON.stringify({ entities: [{ type: 'person', text: 'Taro Yamada' }, { type: 'PERSON', text: 'Hanako' }] });
    const got = parseModelEntities(json, SAMPLE);
    expect(got).toEqual([{ type: 'PERSON', text: 'Taro Yamada', source: 'on_device_ai' }]);
  });
  it('survives malformed JSON', () => {
    expect(parseModelEntities('not json', SAMPLE)).toEqual([]);
  });
});

describe('mask and rehydrate', () => {
  it('round-trips and leaks nothing', () => {
    const ents = mergeEntities(detectByRules(SAMPLE), [
      { type: 'PERSON', text: 'Taro Yamada', source: 'on_device_ai' },
      { type: 'PERSON', text: 'Dr. Sato', source: 'on_device_ai' },
    ]);
    const { masked, vault } = mask(SAMPLE, ents);
    expect(leaks(masked, vault)).toEqual([]);
    expect(masked).toContain('[PERSON_');
    expect(rehydrate(masked, vault)).toBe(SAMPLE);
  });
  it('uses one placeholder per repeated value', () => {
    const { masked } = mask('Taro said hi. Taro left.', [{ type: 'PERSON', text: 'Taro', source: 'rule' }]);
    expect(masked).toBe('[PERSON_1] said hi. [PERSON_1] left.');
  });
});

describe('router', () => {
  const base = { chars: 500, task: 'summarize' as const, online: true, deviceModel: 'available' as const, policy: DEFAULT_POLICY };
  it('prefers on-device for short tasks', () => expect(decideRoute(base).route).toBe('on_device'));
  it('goes to cloud for long docs', () => expect(decideRoute({ ...base, chars: 20000 }).route).toBe('cloud_masked'));
  it('goes to cloud when no local model', () => expect(decideRoute({ ...base, deviceModel: 'unavailable' }).route).toBe('cloud_masked'));
  it('works offline on device', () => expect(decideRoute({ ...base, online: false }).route).toBe('on_device'));
  it('blocks offline without a model', () => expect(decideRoute({ ...base, online: false, deviceModel: 'unavailable' }).route).toBe('blocked'));
  it('strict local never uses cloud', () =>
    expect(decideRoute({ ...base, chars: 20000, policy: { ...DEFAULT_POLICY, strictLocal: true } }).route).toBe('blocked'));
});

describe('name heuristics', () => {
  it('catches names after honorifics and salutations', () => {
    const names = detectByRules(SAMPLE).filter((e) => e.type === 'PERSON').map((e) => e.text);
    expect(names).toContain('Sato');
  });
  it('catches full names after Dear / Patient:', () => {
    const names = detectByRules('Patient: Wei Chen\nDear Wei Chen, Dr. Keiko Sato says hi.').filter((e) => e.type === 'PERSON').map((e) => e.text);
    expect(names).toContain('Wei Chen');
    expect(names).toContain('Keiko Sato');
  });
});
