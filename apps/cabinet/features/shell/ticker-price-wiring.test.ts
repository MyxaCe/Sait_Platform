import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * PKG-06 · проводка общего правила про цену (Р-070, Р-127), половина
 * кабинета.
 *
 * Тикер делят оба приложения, и правка меняет вид отказа в обоих сразу —
 * поэтому проводка закрепляется в каждом. Разойтись им тем легче, что
 * внешне ничего не ломается: лента рисуется, цена на месте, просто в
 * одном приложении показывается зашитая базовая цена справочника,
 * погашенная и подписанная «последняя известная».
 *
 * Правило живёт в `@broker/realtime` (`displayPrice`) и закреплено там
 * поведением; здесь — только то, что кабинет его зовёт.
 */

const TICKER = path.resolve(__dirname, 'CabinetTicker.tsx');

/** Код без комментариев — иначе проверку зеленит собственная проза. */
const code = readFileSync(TICKER, 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('CabinetTicker · цена берётся общим правилом', () => {
  it('зовёт displayPrice, а не форматирует цену сам', () => {
    expect(code).toMatch(/price:\s*displayPrice\(/);
  });

  it('не подставляет formatPrice прямо в элемент ленты', () => {
    expect(code).not.toMatch(/price:\s*formatPrice\(/);
  });
});
