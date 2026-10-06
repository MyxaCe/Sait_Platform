import { describe, expect, it } from 'vitest';
import { readStartBalance, type TenantStartBalance } from './balance';

/**
 * Стартовый демо-баланс — решение штаба Р-040.
 *
 * Проверяется ровно то, что отличает отказ от подстановки: ни один вход
 * не даёт суммы, которую источник не называл. Прежний набор тестов
 * утверждал обратное («умолчание $10 000 законно») — он переписан, а не
 * дополнен: политика отменена штабом, и оставить рядом два
 * противоположных утверждения значило бы потерять оба.
 */

const LEGACY_DEFAULT = 1_000_000; // $10 000 — то, что подставляла legacy

describe('источник назвал сумму', () => {
  it('целое → берём как есть', () => {
    expect(readStartBalance(500_000)).toEqual({ state: 'set', cents: 500_000 });
  });

  it('ноль — допустимая назначенная сумма, а не отсутствие суммы', () => {
    // `site-config.v1`: integer | null, minimum 0. Собственный контракт
    // источника надёжнее нашего представления о разумном.
    expect(readStartBalance(0)).toEqual({ state: 'set', cents: 0 });
  });
});

describe('источник сказал «не задан»', () => {
  it('null → unset, и это НЕ сумма', () => {
    expect(readStartBalance(null)).toEqual({ state: 'unset' });
  });

  it('РАСТЯЖКА: null не превращается в умолчание legacy ни при каких условиях', () => {
    const result = readStartBalance(null);

    // Мутация «вернуть миллион центов на null» красит именно этот тест.
    // Открыть демо-счёт на сумму, которую никто не назначал, хуже, чем
    // не открыть: за неё никто не отвечает, а терминал читает тот же
    // конфиг и увидит другое.
    expect(result).not.toEqual({ state: 'set', cents: LEGACY_DEFAULT });
    expect(result.state).not.toBe('set');
  });
});

describe('в поле не сумма', () => {
  it.each([
    ['поля нет вовсе', undefined],
    ['строка с числом', '1000000'],
    ['строка NaN', 'NaN'],
    ['NaN', Number.NaN],
    ['бесконечность', Number.POSITIVE_INFINITY],
    ['дробное', 1000.5],
    ['отрицательное', -1],
    ['за пределами целого', Number.MAX_SAFE_INTEGER + 2],
    ['объект', {}],
    ['true', true],
  ])('%s → unavailable:malformed, а не ноль и не умолчание', (_name, raw) => {
    const result = readStartBalance(raw);

    expect(result).toEqual({ state: 'unavailable', reason: 'malformed' });
  });

  it('РАСТЯЖКА: строка «1000000» из numeric-поля базы — не сумма', () => {
    // Поля типа numeric в Postgres возвращаются строкой, и `Number()`
    // пропустил бы её молча. Строгий разбор здесь — наш барьер: если
    // источник начнёт отдавать строки, это дефект контракта, а не повод
    // угадывать. Производитель валидирует строго — значит имеет право.
    expect(readStartBalance('1000000').state).toBe('unavailable');
  });

  it('РАСТЯЖКА: ни один вход не даёт `set` с суммой, которой не было во входе', () => {
    const inputs: unknown[] = [null, undefined, 'NaN', '500000', Number.NaN, {}, [], true, -5];

    for (const raw of inputs) {
      const result: TenantStartBalance = readStartBalance(raw);
      // Мутация «на непонятном входе подставить дефолт» красит этот тест
      // целиком, а не одну строку: сумма обязана приходить от источника.
      expect(result.state).not.toBe('set');
    }
  });
});
