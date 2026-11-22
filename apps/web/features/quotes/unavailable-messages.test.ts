import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { SYMBOL_UNAVAILABLE_REASONS } from '@broker/realtime';
import { explainUnavailable, MISSING, UNKNOWN_REASON } from './unavailable-text';

const ROOT = path.resolve(__dirname, '../..');
const LOCALES = ['ru', 'en', 'de', 'fr', 'es'];
const NAMESPACE = 'instrumentUnavailable';

function messages(locale: string): Record<string, string> {
  const raw = readFileSync(path.join(ROOT, 'messages', `${locale}.json`), 'utf8');
  const parsed = JSON.parse(raw) as Record<string, Record<string, string>>;
  return parsed[NAMESPACE] ?? {};
}

const usedKeys = [
  ...SYMBOL_UNAVAILABLE_REASONS.map((r) => explainUnavailable(r).key),
  MISSING.key,
  UNKNOWN_REASON.key,
  'marketClosedUntil',
  'shortLimited',
  'shortFault',
];

describe('WEB-38 · словари', () => {
  it('скан дошёл до словарей, а не зелен из-за пустого разбора', () => {
    for (const locale of LOCALES) {
      expect(Object.keys(messages(locale)).length).toBeGreaterThan(5);
    }
  });

  it.each(LOCALES)('в %s переведён каждый ключ, который код может запросить', (locale) => {
    const dict = messages(locale);
    const missing = usedKeys.filter((k) => typeof dict[k] !== 'string' || dict[k].length === 0);

    expect(missing).toEqual([]);
  });

  it('локали не разошлись между собой', () => {
    const [first, ...rest] = LOCALES.map((l) => Object.keys(messages(l)).sort());

    for (const other of rest) expect(other).toEqual(first);
  });

  it('проверка умеет краснеть — на ключе, которого нет', () => {
    const dict = messages('ru');

    expect(typeof dict['sourceDisabled']).toBe('string');
    expect(dict['takogo-klyucha-net']).toBeUndefined();
  });
});
