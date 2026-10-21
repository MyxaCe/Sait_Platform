import { describe, expect, it } from 'vitest';
import { describeSlippage } from './slippage';

/**
 * WEB-20 · проскальзывание названо, и названо со знаком (Р-178, Р-183).
 *
 * Закрытие идёт по первой наблюдённой цене, значит бывает хуже уровня —
 * и без объяснения это читается как наша ошибка. Но у лимитного ордера
 * разрыв играет ЗА клиента, поэтому «проскальзывание» без знака молча
 * превратило бы выигрыш в оправдание.
 */

const EURUSD = { digits: 5 } as const;

describe('describeSlippage · направление', () => {
  it('продажа ниже уровня — против клиента', () => {
    // Закрытие лонга стопом на разрыве: денег пришло меньше, чем по уровню.
    // Это ровно тот случай, ради которого задача и заведена.
    expect(
      describeSlippage({ execution: 1.0820, level: 1.0850, side: 'sell', ...EURUSD }),
    ).toEqual({ kind: 'against', amount: 0.003 });
  });

  it('продажа выше уровня — в пользу клиента', () => {
    expect(
      describeSlippage({ execution: 1.0870, level: 1.0850, side: 'sell', ...EURUSD }),
    ).toEqual({ kind: 'favour', amount: 0.002 });
  });

  it('покупка выше уровня — против клиента', () => {
    // Закрытие шорта: хуже — дороже. Знак обратный продаже, и перепутать
    // его легко; ошибка здесь превратила бы объяснение в обвинение себя
    // там, где всё прошло в пользу клиента.
    expect(
      describeSlippage({ execution: 1.0880, level: 1.0850, side: 'buy', ...EURUSD }),
    ).toEqual({ kind: 'against', amount: 0.003 });
  });

  it('покупка ниже уровня — в пользу клиента', () => {
    expect(
      describeSlippage({ execution: 1.0830, level: 1.0850, side: 'buy', ...EURUSD }),
    ).toEqual({ kind: 'favour', amount: 0.002 });
  });
});

describe('describeSlippage · когда говорить нечего', () => {
  it('исполнение ровно по уровню — молчим', () => {
    expect(
      describeSlippage({ execution: 1.0850, level: 1.0850, side: 'sell', ...EURUSD }),
    ).toEqual({ kind: 'none', amount: 0 });
  });

  it('разница ниже видимой точности — молчим', () => {
    // Назвать разницу, которой не видно на экране, значит отправить
    // человека искать то, чего он не найдёт. Сообщение обязано
    // соответствовать тому, что видно: тот же принцип, по которому мы не
    // рисуем «0.00%» вместо отсутствующего значения.
    expect(
      describeSlippage({ execution: 1.08501, level: 1.085, side: 'sell', digits: 3 }),
    ).toEqual({ kind: 'none', amount: 0 });
  });

  it('но на своей точности та же разница названа', () => {
    // Растяжка к предыдущему: «молчим» — про видимость, а не про величину.
    expect(
      describeSlippage({ execution: 1.08501, level: 1.085, side: 'sell', digits: 5 }).kind,
    ).toBe('favour');
  });
});

describe('describeSlippage · величина', () => {
  it('величина — модуль разницы, без знака в числе', () => {
    // Знак несёт `kind`, число остаётся величиной. Отрицательная величина
    // рядом со словом «хуже» читалась бы как двойное отрицание.
    const against = describeSlippage({
      execution: 1.082,
      level: 1.085,
      side: 'sell',
      ...EURUSD,
    });

    expect(against.amount).toBeGreaterThan(0);
  });

  it('величина округляется до видимой точности, а не тянет хвост', () => {
    // Иначе рядом с ценой «1.085» стояло бы проскальзывание
    // «0.0029999999999998916» — число настоящее, но нечитаемое.
    const v = describeSlippage({ execution: 1.082, level: 1.085, side: 'sell', ...EURUSD });

    expect(String(v.amount).length).toBeLessThanOrEqual(7);
  });

  it('работает на инструменте с другой точностью', () => {
    // Растяжка: точность приходит снаружи и не зашита. У золота два знака.
    expect(
      describeSlippage({ execution: 2401.5, level: 2403.0, side: 'sell', digits: 2 }),
    ).toEqual({ kind: 'against', amount: 1.5 });
  });
});

describe('describeSlippage · уровня нет (CAB-10)', () => {
  it('уровень пустой → `unknown`, а не «исполнено ровно»', () => {
    // Главное свойство третьего состояния. Сделка могла быть закрыта по
    // команде (уровня не было) или до появления поля (не знаем). В обоих
    // случаях утверждать «исполнено по уровню» нельзя — а именно это и
    // получилось бы, подставь мы цену исполнения вместо уровня.
    expect(
      describeSlippage({ execution: 1.085, level: null, side: 'sell', ...EURUSD }),
    ).toEqual({ kind: 'unknown', amount: 0 });
  });

  it('уровень не передан вовсе → тоже `unknown`', () => {
    expect(
      describeSlippage({ execution: 1.085, level: undefined, side: 'sell', ...EURUSD }),
    ).toEqual({ kind: 'unknown', amount: 0 });
  });

  it('`unknown` отличим от `none` — это разные утверждения', () => {
    // «Исполнено ровно по уровню» и «про уровень ничего не известно»
    // человеку говорят разное. Слить их — то же, что показать прочерк
    // нулём (Р-118).
    const unknown = describeSlippage({ execution: 1.085, level: null, side: 'sell', ...EURUSD });
    const none = describeSlippage({ execution: 1.085, level: 1.085, side: 'sell', ...EURUSD });

    expect(unknown.kind).not.toBe(none.kind);
  });

  it('ноль уровня — это уровень, а не его отсутствие', () => {
    // Растяжка против `!level`: ноль ложен в булевом смысле, и проверка
    // «если не задан» отправила бы законный уровень в `unknown`.
    expect(describeSlippage({ execution: 0, level: 0, side: 'sell', digits: 2 }).kind).toBe(
      'none',
    );
  });
});
