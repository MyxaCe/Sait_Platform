import { describe, expect, it } from 'vitest';
import {
  moneyFromEvent,
  MoneyDisagreementError,
  UnrepresentableMoneyError,
} from './money-from-event';

/**
 * Шаг 2 денежной тройки: читаем новое поле, старое остаётся запасным.
 *
 * Терминал уже шлёт оба. Снять старое он может только после нашего
 * шага 3 — иначе строгий разбор уронит события, уже лежащие в
 * очереди, и вместе с суммой потеряется **всё событие**.
 */

const base = {
  field: 'balance',
  cents: 880000,
  minor: 880000,
  currency: 'USD',
  currencyMinorUnits: 2,
};

describe('шаг 2 · тройка предпочитается, старое поле запасное', () => {
  it('есть тройка → берём её', () => {
    expect(moneyFromEvent(base)).toEqual({ minor: 880000, currency: 'USD', minorUnits: 2 });
  });

  it('тройки нет → берём старое поле, и точность честно неизвестна', () => {
    const m = moneyFromEvent({ ...base, minor: undefined, currencyMinorUnits: undefined });

    expect(m?.minor).toBe(880000);
    // `null`, а не «два»: мы не знаем точность, а полагаемся на старое
    // соглашение. Шаг 3 уберёт этот случай.
    expect(m?.minorUnits).toBeNull();
  });

  it('старого поля уже нет (после шага 3 у терминала) → тройки довольно', () => {
    expect(moneyFromEvent({ ...base, cents: undefined })).toEqual({
      minor: 880000,
      currency: 'USD',
      minorUnits: 2,
    });
  });

  it('величины нет вовсе → null, и это не ноль', () => {
    // У сделки без реализованного результата называть нечего; ноль
    // означал бы «ничего не заработано».
    expect(
      moneyFromEvent({
        field: 'realizedPnl',
        cents: undefined,
        minor: undefined,
        currency: 'USD',
        currencyMinorUnits: 2,
      }),
    ).toBeNull();
  });

  it('ноль — настоящая сумма, а не отсутствие', () => {
    expect(moneyFromEvent({ ...base, cents: 0, minor: 0 })?.minor).toBe(0);
  });

  it('отрицательный баланс проходит: долг — это сумма', () => {
    expect(moneyFromEvent({ ...base, cents: -500, minor: -500 })?.minor).toBe(-500);
  });
});

describe('сторож совпадения, перенятый у терминала', () => {
  it('старое и новое разошлись → отказ, выбирать молча нельзя', () => {
    expect(() => moneyFromEvent({ ...base, cents: 880000, minor: 880001 })).toThrow(
      MoneyDisagreementError,
    );
  });

  it('отказ называет оба числа — иначе чинить нечего', () => {
    try {
      moneyFromEvent({ ...base, cents: 880000, minor: 42 });
      expect.unreachable('ожидался отказ');
    } catch (e) {
      expect((e as Error).message).toContain('880000');
      expect((e as Error).message).toContain('42');
      expect((e as Error).message).toContain('balance');
    }
  });

  it('совпадение ловушкой не становится: равные числа проходят', () => {
    // Ловушка «числа совпадают, значит шаги лишние» превращена в
    // проверку: совпадение стало утверждением, которое можно нарушить.
    expect(() => moneyFromEvent(base)).not.toThrow();
  });

  it('сверяет и когда число единиц не названо — там старое соглашение та же двойка', () => {
    expect(() =>
      moneyFromEvent({ ...base, currencyMinorUnits: undefined, cents: 1, minor: 2 }),
    ).toThrow(MoneyDisagreementError);
  });

  it('без старого поля сверять не с чем, и это не отказ', () => {
    expect(() => moneyFromEvent({ ...base, cents: undefined, minor: 7 })).not.toThrow();
  });
});

describe('валюта с иной точностью — отказ, а не округление', () => {
  it.each([
    ['иена, 0 младших единиц', 0, 'JPY'],
    ['динар, 3 младших единицы', 3, 'BHD'],
  ])('%s → громкий отказ', (_n, units, currency) => {
    // Хранилище считает в центах. Делить или домножать здесь значило бы
    // придумать точность, которой у нас нет, и положить в счёт неверное
    // число молча.
    expect(() =>
      moneyFromEvent({ ...base, currency, currencyMinorUnits: units, cents: undefined }),
    ).toThrow(UnrepresentableMoneyError);
  });

  it('отказ называет валюту и число единиц', () => {
    try {
      moneyFromEvent({ ...base, currency: 'JPY', currencyMinorUnits: 0, cents: undefined });
      expect.unreachable('ожидался отказ');
    } catch (e) {
      expect((e as Error).message).toContain('JPY');
      expect((e as Error).message).toContain('0');
    }
  });

  it('двойка — единственное, что проходит, и это осознанно', () => {
    expect(() => moneyFromEvent({ ...base, currencyMinorUnits: 2 })).not.toThrow();
  });
});
