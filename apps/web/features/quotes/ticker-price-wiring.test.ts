import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * PKG-06 · у правила про цену ОДИН источник (Р-070, Р-127).
 *
 * **Что здесь проверяется теперь — и чего не проверяет разметка.**
 * С появлением компонентных проверок (WEB-16) само поведение закрыто
 * честнее: `QuotesTicker.test.tsx` рисует котировку без настоящего
 * чтения и требует прочерк, переживая любую перепись компонента.
 *
 * Я собирался эту проверку удалить как замещённую и ошибся. Остаётся
 * случай, который разметка поймать не может в принципе: правило
 * **переписали заново прямо здесь** — `q.ts === 0 ? null : format(...)`.
 * Разметка выйдет та же, все поведенческие проверки останутся зелёными,
 * а источников правила станет два. Расхождение проявится не сейчас, а
 * когда порог свежести приедет от MDS и поменяется в пакете — здесь он
 * останется прежним.
 *
 * Инвариант «источник один» наблюдаемых следствий здесь не имеет. Это
 * ровно тот случай, когда проверка по тексту законна, а не заменяет
 * собой ненаписанную.
 *
 * **Хрупкость снята.** Прежняя редакция читала один файл и требовала
 * вызов именно в нём. Перенос маппинга в соседний модуль — приём, на
 * котором стоит вся эта зона, — покрасил бы её на законной правке, а
 * сторожа, красящего законное, отключают первым. Теперь смотрится вся
 * папка: важно, что в ней нет второго источника правила, а не в каком
 * файле стоит вызов.
 */

const DIR = __dirname;

/** Код без комментариев: проза называет функции по имени. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function sources(): { file: string; code: string }[] {
  return readdirSync(DIR)
    .filter((e) => (e.endsWith('.ts') || e.endsWith('.tsx')) && !e.includes('.test.'))
    .filter((e) => statSync(path.join(DIR, e)).isFile())
    .map((e) => ({ file: e, code: stripComments(readFileSync(path.join(DIR, e), 'utf8')) }));
}

describe('лента котировок · цена берётся общим правилом', () => {
  it('скан доходит до файлов, а не зелен из-за пустой папки', () => {
    const files = sources().map((s) => s.file);

    expect(files.length).toBeGreaterThan(0);
    expect(files).toContain('QuotesTicker.tsx');
  });

  it('общее правило зовут — хотя бы в одном файле папки', () => {
    expect(sources().some((s) => /price:\s*displayPrice\(/.test(s.code))).toBe(true);
  });

  it('цена элемента ленты не форматируется в обход правила', () => {
    // Именно эта запись и была до PKG-06.
    const offenders = sources()
      .filter((s) => /price:\s*formatPrice\(/.test(s.code))
      .map((s) => s.file);

    expect(offenders).toEqual([]);
  });

  it('порог «настоящего чтения не было» не переписан на месте', () => {
    // Второй источник того же правила: разметка та же, а менять
    // придётся в двух местах — и во втором забудут.
    const offenders = sources()
      .filter((s) => /\bts\s*===\s*0\b/.test(s.code))
      .map((s) => s.file);

    expect(offenders).toEqual([]);
  });

  it('проверка умеет и краснеть, и молчать', () => {
    const red = /price:\s*formatPrice\(/;
    const inlined = /\bts\s*===\s*0\b/;

    expect(red.test('price: formatPrice(q.price, q.digits),')).toBe(true);
    expect(inlined.test('price: q.ts === 0 ? null : formatPrice(q.price, q.digits),')).toBe(true);

    // Законное не красит: вызов общего правила и перенос в другой файл.
    expect(red.test('price: displayPrice(q, formatPrice),')).toBe(false);
    expect(inlined.test('price: displayPrice(q, formatPrice),')).toBe(false);
  });
});
