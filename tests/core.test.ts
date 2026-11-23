import { describe, it, expect } from 'vitest';
import { detectByRules, mask, rehydrate, leaks, mergeEntities, parseModelEntities } from '../src/pii';
import { decideRoute, DEFAULT_POLICY } from '../src/router';

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
    expect(detectByRules('ref 4111 1111 1111 1112').some((e) => e.type === 'CARD')).toBe(false);
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
