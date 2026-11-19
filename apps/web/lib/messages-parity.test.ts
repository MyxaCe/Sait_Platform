import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { PLATFORM_LOCALES } from '@broker/utils/locales';

const DIR = path.resolve(__dirname, '../messages');

function load(locale: string): unknown {
  return JSON.parse(readFileSync(path.join(DIR, `${locale}.json`), 'utf8'));
}

function flatten(value: unknown, prefix = ''): Map<string, string> {
  const out = new Map<string, string>();
  if (typeof value === 'string') {
    out.set(prefix, value);
    return out;
  }
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      for (const [k, v] of flatten(child, prefix ? `${prefix}.${key}` : key)) out.set(k, v);
    }
  }
  return out;
}

function markers(text: string): string[] {
  const placeholders = [...text.matchAll(/\{\s*([A-Za-z0-9_]+)[^{}]*\}/g)].map((m) => `{${m[1]}}`);
  const tags = [...text.matchAll(/<\/?([A-Za-z][A-Za-z0-9]*)\s*\/?>/g)].map((m) => `<${m[0].startsWith('</') ? '/' : ''}${m[1]}>`);
  return [...placeholders, ...tags].sort();
}

const reference = flatten(load('en'));

describe('словари витрины: одинаковые ключи и плейсхолдеры во всех языках', () => {
  it('словари не пусты', () => {
    expect(reference.size).toBeGreaterThan(300);
  });

  it.each(PLATFORM_LOCALES)('%s: набор ключей как в en', (locale) => {
    const dict = flatten(load(locale));
    expect([...dict.keys()].sort()).toEqual([...reference.keys()].sort());
  });

  it.each(PLATFORM_LOCALES)('%s: плейсхолдеры ICU и разметка как в en', (locale) => {
    const dict = flatten(load(locale));
    const mismatches = [...reference].filter(([key, en]) => {
      const text = dict.get(key);
      return text === undefined || text.trim() === '' || markers(text).join() !== markers(en).join();
    });
    expect(mismatches.map(([key]) => key)).toEqual([]);
  });

  it('проверка краснеет на расхождении', () => {
    expect(markers('Hi {name} <b>x</b>').join()).not.toBe(markers('Hi {brand} <b>x</b>').join());
  });
});
