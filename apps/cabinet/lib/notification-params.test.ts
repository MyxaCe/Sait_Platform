import { describe, expect, it } from 'vitest';
import {
  displayParams,
  formatPriceForSymbol,
  marginCalledParams,
  notificationKey,
  tradeExecutedParams,
} from './notification-params';

describe('цена показывается с точностью ИНСТРУМЕНТА', () => {
  it('знаки берутся у символа, а не у форматирования чисел', () => {
    expect(formatPriceForSymbol(1.08425, 'EURUSD')).toBe('1.08425');
  });

  it('у инструмента с другой точностью — своя', () => {
    expect(formatPriceForSymbol(2401.5, 'XAUUSD')).toBe('2401.50');
  });

  it('символ неизвестен — печатаем как есть, а не угадываем точность', () => {
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
      level: '',
      slippage: '',
      slippageKind: 'unknown',
      acrossGap: 'notApplicable',
    });
  });

  it.each(['symbol', 'side', 'volume', 'price'])('без «%s» — отказ показать шаблон', (field) => {
    const broken: Record<string, unknown> = { ...ok };
    delete broken[field];

    expect(tradeExecutedParams(broken)).toBeNull();
  });

  it('сторона вне словаря — отказ, а не показ машинного значения', () => {
    expect(tradeExecutedParams({ ...ok, side: 'хз' })).toBeNull();
  });

  it('цена не число — отказ', () => {
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
    expect(displayParams('documentUploaded', { filename: 'паспорт.pdf' })).toEqual({
      filename: 'паспорт.pdf',
    });
  });
});

describe('маржин-колл: видно и уровень, и сколько осталось', () => {
  const ok = {
    marginLevelPct: 97,
    stopOutLevelPct: 50,
    equityCents: 8071001,
    usedMarginCents: 8320619,
  };

  it('называет достигнутый уровень, порог и остаток', () => {
    expect(marginCalledParams(ok)).toMatchObject({
      level: '97',
      stopOut: '50',
      remaining: '47',
      hasStopOut: 'yes',
    });
  });

  it('центы превращаются в деньги, как у сделок', () => {
    expect(marginCalledParams(ok)).toMatchObject({
      equity: '80710.01',
      usedMargin: '83206.19',
    });
  });

  it('порога нет → это НЕ ноль процентов', () => {
    const { stopOutLevelPct, ...noStop } = ok;
    void stopOutLevelPct;

    expect(marginCalledParams(noStop)).toMatchObject({
      hasStopOut: 'no',
      stopOut: '',
      remaining: '',
    });
  });

  it('`null` порога читается так же, как его отсутствие', () => {
    expect(marginCalledParams({ ...ok, stopOutLevelPct: null })).toMatchObject({
      hasStopOut: 'no',
    });
  });

  it('НОЛЬ порога — это порог, а не его отсутствие', () => {
    expect(marginCalledParams({ ...ok, stopOutLevelPct: 0 })).toMatchObject({
      hasStopOut: 'yes',
      stopOut: '0',
      remaining: '97',
    });
  });

  it('без уровня маржи показывать нечего', () => {
    const { marginLevelPct, ...broken } = ok;
    void marginLevelPct;

    expect(marginCalledParams(broken)).toBeNull();
  });

  it('шаблон выбирается по наличию порога', () => {
    expect(notificationKey('marginCalled', marginCalledParams(ok))).toBe('marginCalled');

    const { stopOutLevelPct, ...noStop } = ok;
    void stopOutLevelPct;
    expect(notificationKey('marginCalled', marginCalledParams(noStop))).toBe(
      'marginCalledNoStopOut',
    );
  });
});

describe('WEB-20 · проскальзывание доходит до уведомления', () => {
  const base = { symbol: 'EURUSD', side: 'buy', volume: 0.1, price: 1.082 };

  it('хуже уровня — названо и ОБЪЯСНЕНО', () => {
    const params = tradeExecutedParams({ ...base, level: 1.085 });

    expect(params).toMatchObject({ slippageKind: 'against', slippage: '0.00300', level: '1.08500' });
    expect(notificationKey('tradeExecuted', params)).toBe('tradeExecutedWorse');
  });

  it('лучше уровня — тоже названо', () => {
    const params = tradeExecutedParams({ ...base, level: 1.08 });

    expect(params).toMatchObject({ slippageKind: 'favour' });
    expect(notificationKey('tradeExecuted', params)).toBe('tradeExecutedBetter');
  });

  it('ровно по уровню — обычный шаблон, лишних слов нет', () => {
    const params = tradeExecutedParams({ ...base, level: 1.082 });

    expect(params).toMatchObject({ slippageKind: 'none', slippage: '' });
    expect(notificationKey('tradeExecuted', params)).toBe('tradeExecuted');
  });

  it('уровня нет → молчим о проскальзывании, а не утверждаем «по уровню»', () => {
    const params = tradeExecutedParams({ ...base, level: null });

    expect(params).toMatchObject({ slippageKind: 'unknown', slippage: '', level: '' });
    expect(notificationKey('tradeExecuted', params)).toBe('tradeExecuted');
  });

  it('разрыв трёхзначен — и теперь это так и есть', () => {
    expect(tradeExecutedParams({ ...base, acrossGap: true })).toMatchObject({ acrossGap: 'yes' });
    expect(tradeExecutedParams({ ...base, acrossGap: false })).toMatchObject({ acrossGap: 'no' });
    expect(tradeExecutedParams({ ...base, acrossGap: null })).toMatchObject({
      acrossGap: 'notApplicable',
    });
  });
});

describe('WEB-40 · признак разрыва трёхзначен, и знак проскальзывания верен', () => {
  const trade = (over: Record<string, unknown> = {}) => ({
    symbol: 'EURUSD',
    side: 'buy',
    volume: 0.1,
    price: 1.082,
    level: 1.085,
    ...over,
  });

  it('поля нет вовсе → «вопрос неприменим», а не «не рвался»', () => {
    expect(tradeExecutedParams(trade())?.acrossGap).toBe('notApplicable');
  });

  it('поле пришло `false` → «не рвался», и это другое состояние', () => {
    expect(tradeExecutedParams(trade({ acrossGap: false }))?.acrossGap).toBe('no');
  });

  it('поле пришло `true` → «был разрыв»', () => {
    expect(tradeExecutedParams(trade({ acrossGap: true }))?.acrossGap).toBe('yes');
  });

  it('три состояния РАЗЛИЧНЫ — иначе трёхзначность была бы на словах', () => {
    const states = new Set([
      tradeExecutedParams(trade())?.acrossGap,
      tradeExecutedParams(trade({ acrossGap: false }))?.acrossGap,
      tradeExecutedParams(trade({ acrossGap: true }))?.acrossGap,
    ]);

    expect(states.size).toBe(3);
  });

  it('`false` НЕ отменяет проскальзывания: оно считается из уровня и цены', () => {
    const p = tradeExecutedParams(trade({ acrossGap: false }));

    expect(p?.slippageKind).toBe('against');
    expect(p?.slippage).not.toBe('');
  });

  it('была ДЛИННАЯ, закрылась ниже уровня → «против», а не «в пользу»', () => {
    expect(tradeExecutedParams(trade({ side: 'buy' }))?.slippageKind).toBe('against');
  });

  it('была КОРОТКАЯ, закрылась ниже уровня → «в пользу»', () => {
    expect(tradeExecutedParams(trade({ side: 'sell' }))?.slippageKind).toBe('favour');
  });
});

describe('WEB-41 · тик не съедается округлением', () => {
  const live = {
    symbol: 'BTCUSD',
    side: 'buy',
    volume: 0.01,
    price: 80850.2,
    level: 80859.97,
  };

  it('тот самый случай теперь называется верно и в тиках', () => {
    const p = tradeExecutedParams(live);

    expect(p?.slippageKind).toBe('against');
    expect(p?.slippage).toBe('9.77');
    expect(p?.price).toBe('80850.20');
    expect(p?.level).toBe('80859.97');
    expect(notificationKey('tradeExecuted', p)).toBe('tradeExecutedWorse');
  });

  it('цена, уровень и разница печатаются ОДНОЙ точностью', () => {
    const p = tradeExecutedParams(live);
    if (!p) throw new Error('параметры не собрались');
    const decimals = (v: string | undefined) => (v ?? '').split('.')[1]?.length ?? 0;

    expect(decimals(p.price)).toBe(decimals(p.level));
    expect(decimals(p.slippage)).toBe(decimals(p.price));
  });

  it('проскальзывание меньше полудоллара НЕ исчезает', () => {
    const p = tradeExecutedParams({ ...live, price: 80859.6 });

    expect(p?.slippageKind).toBe('against');
    expect(p?.slippage).toBe('0.37');
  });

  it('ВТОРАЯ СТОРОНА: ровно по уровню — про проскальзывание ни слова', () => {
    const p = tradeExecutedParams({ ...live, price: 80859.97 });

    expect(p?.slippageKind).toBe('none');
    expect(p?.slippage).toBe('');
    expect(notificationKey('tradeExecuted', p)).toBe('tradeExecuted');
  });

  it('справочная точность — нижняя граница, а не потолок', () => {
    const p = tradeExecutedParams({
      symbol: 'EURUSD',
      side: 'buy',
      volume: 0.1,
      price: 1.08,
      level: 1.085,
    });

    expect(p?.price).toBe('1.08000');
  });
});
