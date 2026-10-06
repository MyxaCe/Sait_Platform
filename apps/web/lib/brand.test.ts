import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { FALLBACK_PRIMARY_COLOR, hexToRgbChannels, resolvePrimaryColor } from './brand';

/**
 * Запасной фирменный цвет витрины — WEB-05, решение штаба Р-040.
 *
 * Проверяются два разных утверждения, и второе важнее первого:
 *   1. `null` от источника даёт наш цвет, а не пустоту;
 *   2. наш цвет и правда фирменный — он совпадает с токеном `--accent`,
 *      а не просто «какой-то валидный hex».
 */

describe('цвет от источника', () => {
  it('строка из CMS берётся как есть', () => {
    expect(resolvePrimaryColor('#112233')).toEqual({ color: '#112233', source: 'cms' });
  });
});

describe('цвета от источника нет', () => {
  it.each([
    ['null — штатное значение v2', null],
    ['поля нет вовсе', undefined],
    ['пустая строка', ''],
  ])('%s → наш запасной, и это видно по source', (_name, value) => {
    const resolved = resolvePrimaryColor(value);

    expect(resolved).toEqual({ color: FALLBACK_PRIMARY_COLOR, source: 'fallback' });
  });

  it('РАСТЯЖКА: ни один вход не оставляет страницу без акцента', () => {
    for (const value of [null, undefined, '', '#d4a437']) {
      const { color } = resolvePrimaryColor(value);
      // `hexToRgbChannels` возвращает null на негодном значении, и тогда
      // `<style>` в layout не инжектируется вовсе. Мутация «вернуть
      // пустую строку вместо запасного цвета» красит этот тест.
      expect(hexToRgbChannels(color)).not.toBeNull();
    }
  });
});

describe('запасной цвет — тот же, что в токенах', () => {
  it('РАСТЯЖКА: совпадает с --accent тёмной темы @broker/ui', () => {
    // Эталон берётся из источника токенов, а не из самой константы:
    // ожидание, снятое с проверяемого кода, закрепило бы его ошибку.
    // Разъедутся — тест покраснеет, и подмена перестанет быть незаметной
    // ровно там, где она обязана быть незаметной для посетителя.
    const css = readFileSync(
      path.resolve(__dirname, '../../../packages/ui/src/tokens/tokens.css'),
      'utf8',
    );
    const dark = css.split("[data-theme='light']")[0]!;
    const token = /--accent:\s*([\d\s]+);/.exec(dark)?.[1]?.trim();

    expect(token).toBeTruthy();
    expect(hexToRgbChannels(FALLBACK_PRIMARY_COLOR)).toBe(token);
  });
});
