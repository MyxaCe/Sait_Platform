import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ACTION_GROUPS, ACTION_LABELS, actionGroup, actionLabel, basisOf } from './labels';

/**
 * Словарь подписей журнала полон: каждый код действия, который пишет код
 * приложения (admin + @broker/money), имеет человекочитаемую подпись. Иначе
 * в разделе «Журнал» всплывёт машинный код — для комплаенса это брак.
 */
const ROOTS = [resolve(__dirname, '..'), resolve(__dirname, '../../app'), resolve(__dirname, '../../../../packages/money/src')];
const CODE = /'((?:client|crypto|leverage|operator|journal)\.[a-z_.]+|money\.command\.[a-z_]+|platform\.money_settings\.[a-z_]+)'/g;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules') continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) && !p.includes('testing')) out.push(p);
  }
  return out;
}

describe('journal labels', () => {
  it('у каждого кода действия из кода приложения есть подпись', () => {
    const found = new Set<string>();
    for (const root of ROOTS) {
      for (const file of walk(root)) {
        if (file.endsWith('labels.ts')) continue;
        // Префикс вида 'client.verification.' (фильтр startsWith) — не код действия.
        for (const m of readFileSync(file, 'utf8').matchAll(CODE)) if (!m[1]!.endsWith('.')) found.add(m[1]!);
      }
    }
    expect(found.size).toBeGreaterThan(30);
    const missing = [...found].filter((code) => !ACTION_LABELS[code]);
    expect(missing).toEqual([]);
  });

  it('группа каждой подписи объявлена в ACTION_GROUPS', () => {
    const groups = new Set(ACTION_GROUPS.map((g) => g.key));
    for (const meta of Object.values(ACTION_LABELS)) expect(groups.has(meta.group)).toBe(true);
  });

  it('неизвестный код — как есть, нейтрально', () => {
    expect(actionLabel('x.unknown')).toEqual({ label: 'x.unknown', tone: 'neutral' });
    expect(actionGroup('x.unknown')).toBeNull();
    expect(actionLabel('crypto.deposit.credited').label).toBe('Пополнение зачислено');
  });

  it('основание — из basis или reason', () => {
    expect(basisOf({ basis: 'a' })).toBe('a');
    expect(basisOf({ reason: 'b' })).toBe('b');
    expect(basisOf({ basis: '  ' })).toBeNull();
    expect(basisOf({})).toBeNull();
  });
});
