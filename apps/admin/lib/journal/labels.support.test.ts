import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SUPPORT_ACTIONS } from '@broker/support';
import { ACTION_GROUPS, ACTION_LABELS } from './labels';

/**
 * Сторож подписей журнала для кодов поддержки и auth-писем (`support.*`,
 * `auth.*`). Отдельным файлом от общего `labels.test.ts`, чтобы его регэксп
 * не трогать (его же расширяют соседние ветки). Коды берутся из кода
 * (`SUPPORT_ACTIONS` + литералы в admin и packages/support).
 */
const ROOTS = [resolve(__dirname, '..'), resolve(__dirname, '../../app'), resolve(__dirname, '../../../../packages/support/src')];
const CODE = /'((?:support|auth)\.[a-z_]+\.[a-z_.]+)'/g;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules') continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) && !p.includes('testing')) out.push(p);
  }
  return out;
}

describe('журнал · подписи поддержки и auth-писем', () => {
  it('у каждого кода SUPPORT_ACTIONS есть подпись в своей группе', () => {
    const groups = new Set(ACTION_GROUPS.map((g) => g.key));
    for (const code of Object.values(SUPPORT_ACTIONS)) {
      expect(ACTION_LABELS[code], code).toBeDefined();
      expect(groups.has(ACTION_LABELS[code]!.group)).toBe(true);
    }
  });

  it('литералы support.*/auth.* в коде тоже подписаны', () => {
    const found = new Set<string>();
    for (const root of ROOTS) {
      for (const file of walk(root)) {
        if (file.endsWith('labels.ts')) continue;
        for (const m of readFileSync(file, 'utf8').matchAll(CODE)) found.add(m[1]!);
      }
    }
    expect(found.size).toBeGreaterThan(10);
    expect([...found].filter((c) => !ACTION_LABELS[c])).toEqual([]);
  });
});
