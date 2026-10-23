import { describe, expect, it } from 'vitest';
import { envOr, readEnv } from './env';

/**
 * WEB-21 · пустая строка — не отсутствие.
 *
 * Дефект был двойным, и обе половины безобидны поодиночке: аргумент
 * сборки с пустым значением перекрывает умолчание, а `??` в коде ловит
 * только `undefined`. Наружу это вышло нерабочими кнопками входа —
 * ссылка на кабинет стала ссылкой на саму витрину.
 */

describe('readEnv', () => {
  it('значение возвращается как есть', () => {
    expect(readEnv('https://wholesalefy.com')).toBe('https://wholesalefy.com');
  });

  it('пустая строка — отсутствие, а не значение', () => {
    // Главное свойство. Именно её пропускал `??`.
    expect(readEnv('')).toBeNull();
  });

  it('пробелы — тоже отсутствие', () => {
    // `X=" "` в файле окружения это опечатка, а не адрес.
    expect(readEnv('   ')).toBeNull();
    expect(readEnv('\t\n')).toBeNull();
  });

  it('пробелы по краям срезаются', () => {
    expect(readEnv('  https://wholesalefy.com  ')).toBe('https://wholesalefy.com');
  });

  it('не задано — отсутствие', () => {
    expect(readEnv(undefined)).toBeNull();
    expect(readEnv(null)).toBeNull();
  });

  it('строка «0» и «false» — ЗНАЧЕНИЯ, а не отсутствие', () => {
    // Растяжка против проверки на истинность: `!raw` отправил бы их в
    // отсутствие. Переменная со значением «0» задана.
    expect(readEnv('0')).toBe('0');
    expect(readEnv('false')).toBe('false');
  });
});

describe('envOr', () => {
  it('пустая строка получает умолчание — в этом вся суть', () => {
    // Ровно тот случай, которого не было: `'' ?? d` возвращает `''`.
    expect(envOr('', 'http://localhost:3002')).toBe('http://localhost:3002');
  });

  it('заданное значение умолчанием не перекрывается', () => {
    expect(envOr('https://cabinet.wholesalefy.com', 'http://localhost:3002')).toBe(
      'https://cabinet.wholesalefy.com',
    );
  });

  it('не задано — умолчание', () => {
    expect(envOr(undefined, 'd')).toBe('d');
  });
});
