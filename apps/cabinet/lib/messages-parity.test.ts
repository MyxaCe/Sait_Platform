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

function icuMarkers(text: string): string[] {
  const found: string[] = [];
  let i = 0;
  const message = (depth: number): void => {
    while (i < text.length) {
      const ch = text[i]!;
      if (ch === '}' && depth > 0) return;
      if (ch === '{') {
        i += 1;
        argument();
        continue;
      }
      i += 1;
    }
  };
  const argument = (): void => {
    const head = /^\s*([A-Za-z0-9_]+)\s*(?:,\s*([a-z]+)\s*)?/.exec(text.slice(i));
    if (!head) throw new Error(`не разобрано: ${text}`);
    i += head[0].length;
    const [, name, type] = head;
    found.push(type ? `{${name},${type}}` : `{${name}}`);
    if (text[i] === '}') {
      i += 1;
      return;
    }
    if (text[i] !== ',') throw new Error(`не разобрано: ${text}`);
    i += 1;
    if (type !== 'plural' && type !== 'select' && type !== 'selectordinal') {
      while (i < text.length && text[i] !== '}') i += 1;
      i += 1;
      return;
    }
    for (;;) {
      const sel = /^\s*(offset:\d+\s*)?([=A-Za-z0-9_]+)\s*\{/.exec(text.slice(i));
      if (!sel) break;
      i += sel[0].length;
      if (type === 'select') found.push(`${name}:${sel[2]}`);
      message(1);
      i += 1;
    }
    while (i < text.length && text[i] !== '}') i += 1;
    i += 1;
  };
  message(0);
  const tags = [...text.matchAll(/<\/?([A-Za-z][A-Za-z0-9]*)\s*\/?>/g)].map((m) => `<${m[0].startsWith('</') ? '/' : ''}${m[1]}>`);
  return [...found, ...tags].sort();
}

const reference = flatten(load('en'));

describe('словари кабинета: одинаковые ключи, плейсхолдеры ICU и разметка во всех языках', () => {
  it('словари не пусты', () => {
    expect(reference.size).toBeGreaterThan(800);
  });

  it.each(PLATFORM_LOCALES)('%s: набор ключей как в en', (locale) => {
    const dict = flatten(load(locale));
    expect([...dict.keys()].sort()).toEqual([...reference.keys()].sort());
  });

  it.each(PLATFORM_LOCALES)('%s: плейсхолдеры ICU, ветки select и разметка как в en', (locale) => {
    const dict = flatten(load(locale));
    const mismatches = [...reference].filter(([key, en]) => {
      const text = dict.get(key);
      return text === undefined || text.trim() === '' || icuMarkers(text).join() !== icuMarkers(en).join();
    });
    expect(mismatches.map(([key]) => key)).toEqual([]);
  });

  it.each(PLATFORM_LOCALES)('%s: прямой апостроф не экранирует плейсхолдер', (locale) => {
    const bad = [...flatten(load(locale))].filter(([, text]) => /'[{}#]/.test(text)).map(([key]) => key);
    expect(bad).toEqual([]);
  });

  it('проверка краснеет на расхождении, текст веток select не считается плейсхолдером', () => {
    expect(icuMarkers('Hi {name} <b>x</b>').join()).not.toBe(icuMarkers('Hi {brand} <b>x</b>').join());
    expect(icuMarkers('{side, select, buy {Kauf} other {{side}}}').join()).toBe(
      icuMarkers('{side, select, buy {buy} other {{side}}}').join(),
    );
    expect(icuMarkers('{n, plural, one {# Tag} other {# Tage}}').join()).toBe(icuMarkers('{n, plural, one {# day} other {# days}}').join());
  });
});
