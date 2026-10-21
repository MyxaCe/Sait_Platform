import { describe, expect, it } from 'vitest';
import { displayParams, formatPriceForSymbol, tradeExecutedParams } from './notification-params';

/**
 * CAB-08 · уведомление об исполненной сделке называет цену (Р-193).
 *
 * Было «Сделка исполнена: buy 0.1 EURUSD» — факт сделки без её сути:
 * человеку не говорили, что произошло с деньгами. На этом же пути потом
 * встанет проскальзывание, но врать про него нечем, пока не названа даже
 * цена.
 */

describe('цена показывается с точностью ИНСТРУМЕНТА', () => {
  it('знаки берутся у символа, а не у форматирования чисел', () => {
    // `0.08143` в обычном форматировании стало бы «0,081» — это не
    // «короче», это ДРУГОЕ число, и стоит оно на месте денег.
    expect(formatPriceForSymbol(1.08425, 'EURUSD')).toBe('1.08425');
  });

  it('у инструмента с другой точностью — своя', () => {
    expect(formatPriceForSymbol(2401.5, 'XAUUSD')).toBe('2401.50');
  });

  it('символ неизвестен — печатаем как есть, а не угадываем точность', () => {
    // В каталоге MDS инструментов больше, чем в нашем справочнике.
    // Выдуманные знаки были бы умолчанием на показе денег; некрасиво
    // честнее неверного.
    expect(formatPriceForSymbol(0.08143, 'НЕТ-ТАКОГО')).toBe('0.08143');
  });
});

describe('негодные параметры не превращаются в сообщение', () => {
  const ok = { symbol: 'EURUSD', side: 'buy', volume: 0.1, price: 1.08425 };

  it('полный набор проходит', () => {
    expect(tradeExecutedParams(ok)).toEqual({
      symbol: 'EURUSD',
      side: 'buy',
      volume: '0.1',
      price: '1.08425',
    });
  });

  it.each(['symbol', 'side', 'volume', 'price'])('без «%s» — отказ показать шаблон', (field) => {
    // `null` означает «этим шаблоном показать нечего»: страница покажет
    // тип. Пустая подстановка дала бы «Сделка исполнена:  0.1  по » —
    // выглядит как сообщение и читается как поломка у клиента, а не у нас.
    const broken: Record<string, unknown> = { ...ok };
    delete broken[field];

    expect(tradeExecutedParams(broken)).toBeNull();
  });

  it('сторона вне словаря — отказ, а не показ машинного значения', () => {
    expect(tradeExecutedParams({ ...ok, side: 'хз' })).toBeNull();
  });

  it('цена не число — отказ', () => {
    // Строка «1.08» в JSON базы выглядит правдоподобно и форматируется
    // молча во что угодно.
    expect(tradeExecutedParams({ ...ok, price: '1.08' })).toBeNull();
  });

  it('цена NaN — отказ', () => {
    expect(tradeExecutedParams({ ...ok, price: Number.NaN })).toBeNull();
  });

  it('пустые параметры — отказ, а не предложение со скобками', () => {
    expect(tradeExecutedParams({})).toBeNull();
  });
});

describe('displayParams', () => {
  it('у сделки — своё правило', () => {
    expect(displayParams('tradeExecuted', {})).toBeNull();
  });

  it('у остальных типов параметры идут как есть', () => {
    // Растяжка: правило заведено там, где значение показывает деньги, и
    // не трогает остальные типы.
    expect(displayParams('documentUploaded', { filename: 'паспорт.pdf' })).toEqual({
      filename: 'паспорт.pdf',
    });
  });
});
