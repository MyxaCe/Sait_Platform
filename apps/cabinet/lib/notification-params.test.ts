import { describe, expect, it } from 'vitest';
import {
  displayParams,
  formatPriceForSymbol,
  marginCalledParams,
  notificationKey,
  tradeExecutedParams,
} from './notification-params';

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
    // Набор сверяется исчерпывающе нарочно: лишнее поле в параметрах
    // уедет в шаблон молча, а недостающее оставит в тексте скобки.
    expect(tradeExecutedParams(ok)).toEqual({
      symbol: 'EURUSD',
      side: 'buy',
      volume: '0.1',
      price: '1.08425',
      // Уровня в этом событии нет — о проскальзывании молчим (WEB-20).
      level: '',
      slippage: '',
      slippageKind: 'unknown',
      // Поля в событии нет: вопрос неприменим, а не «фид не рвался»
      // (WEB-40). Прежде здесь стояло `'no'`, и два состояния
      // сливались в одно.
      acrossGap: 'notApplicable',
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

describe('маржин-колл: видно и уровень, и сколько осталось', () => {
  const ok = {
    marginLevelPct: 97,
    stopOutLevelPct: 50,
    equityCents: 8071001,
    usedMarginCents: 8320619,
  };

  it('называет достигнутый уровень, порог и остаток', () => {
    // Довод терминала: «ваш уровень 97 %» ничего не говорит тому, кто не
    // помнит порог. Из предупреждения должно быть видно, сколько
    // осталось.
    expect(marginCalledParams(ok)).toMatchObject({
      level: '97',
      stopOut: '50',
      remaining: '47',
      hasStopOut: 'yes',
    });
  });

  it('центы превращаются в деньги, как у сделок', () => {
    // Целое 8071001 — это 80710.01, а не восемь миллионов.
    expect(marginCalledParams(ok)).toMatchObject({
      equity: '80710.01',
      usedMargin: '83206.19',
    });
  });

  it('порога нет → это НЕ ноль процентов', () => {
    // Главное свойство. Ноль означал бы «закроют при нулевой марже» —
    // конкретную и очень плохую новость. Отсутствие означает, что
    // закрытия не будет вовсе.
    const { stopOutLevelPct, ...noStop } = ok;
    void stopOutLevelPct;

    expect(marginCalledParams(noStop)).toMatchObject({
      hasStopOut: 'no',
      stopOut: '',
      remaining: '',
    });
  });

  it('`null` порога читается так же, как его отсутствие', () => {
    // Проекция кладёт именно `null`, когда события пришло без порога.
    expect(marginCalledParams({ ...ok, stopOutLevelPct: null })).toMatchObject({
      hasStopOut: 'no',
    });
  });

  it('НОЛЬ порога — это порог, а не его отсутствие', () => {
    // Растяжка против проверки на истинность: `!stopOutLevelPct`
    // отправил бы законный ноль в «порога нет», и человек не узнал бы о
    // закрытии при нулевой марже.
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
  /*
   * `side` — сторона ПОЗИЦИИ, а не исполняемой ноги (§5, WEB-40).
   * Здесь была `'sell'` при ожидании «хуже уровня» — прочтение, по
   * которому знак вердикта и перевернулся. Для длинной, закрывшейся
   * ниже уровня, верно `'buy'`.
   */
  const base = { symbol: 'EURUSD', side: 'buy', volume: 0.1, price: 1.082 };

  it('хуже уровня — названо и ОБЪЯСНЕНО', () => {
    // Без второй половины фразы закрытие хуже уровня читается как наша
    // ошибка. Шаблон выбирается тот, где причина названа.
    const params = tradeExecutedParams({ ...base, level: 1.085 });

    expect(params).toMatchObject({ slippageKind: 'against', slippage: '0.00300', level: '1.08500' });
    expect(notificationKey('tradeExecuted', params)).toBe('tradeExecutedWorse');
  });

  it('лучше уровня — тоже названо', () => {
    // У лимитного разрыв играет ЗА клиента. Промолчать значило бы
    // приписать себе чужую удачу. Была длинная, закрылась ВЫШЕ уровня.
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
    // Главное свойство. Рыночное закрытие или сделка старше поля: мы не
    // знаем уровня, и сказать «исполнено по уровню» было бы
    // утверждением о том, чего не знаем.
    const params = tradeExecutedParams({ ...base, level: null });

    expect(params).toMatchObject({ slippageKind: 'unknown', slippage: '', level: '' });
    expect(notificationKey('tradeExecuted', params)).toBe('tradeExecuted');
  });

  it('разрыв трёхзначен — и теперь это так и есть', () => {
    /*
     * **Эта проверка называлась «трёхзначен» и утверждала два
     * состояния** (WEB-40). В ней же стояло объяснение: «проверяли, не
     * было» и «не знаем» одинаково молчат, — и оно верно для ПОКАЗА,
     * но неверно для параметра: показ решает шаблон, а параметр обязан
     * донести то, что сказал источник.
     *
     * Склеенные здесь, два состояния дальше неразличимы уже никому.
     * Имя теста при этом утверждало обратное — и читалось как
     * доказательство того, чего в нём не было.
     */
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
    // Сделки, закрытые не триггером — вручную или неттингом, — ключа
    // не несут. Отсутствие не равно `false`.
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
    // Признак говорит о дыре в фиде (больше тридцати секунд без тика),
    // а не о величине скачка. Разрыв цены при `false` — обычное
    // проскальзывание внутри потока, и его мы называем.
    const p = tradeExecutedParams(trade({ acrossGap: false }));

    expect(p?.slippageKind).toBe('against');
    expect(p?.slippage).not.toBe('');
  });

  it('была ДЛИННАЯ, закрылась ниже уровня → «против», а не «в пользу»', () => {
    // Знак был инвертирован: `side` — сторона позиции, а не
    // исполняемой ноги. Стоп по лонгу на разрыве говорил человеку
    // «в вашу пользу».
    expect(tradeExecutedParams(trade({ side: 'buy' }))?.slippageKind).toBe('against');
  });

  it('была КОРОТКАЯ, закрылась ниже уровня → «в пользу»', () => {
    expect(tradeExecutedParams(trade({ side: 'sell' }))?.slippageKind).toBe('favour');
  });
});

describe('WEB-41 · тик не съедается округлением', () => {
  /*
   * **Живой случай, 25.10.** Длинная BTCUSD, стоп в трёх тиках ниже
   * bid, исполнение `80850.20` против уровня `80859.97`. Кабинет
   * сказал человеку: «по 80850 … уровня 80860 … на 10 ЛУЧШЕ».
   *
   * Три дефекта в одной строке: знак (WEB-40), округление до целых и
   * — следствием округления — риск, что проскальзывание исчезнет
   * вовсе. У BTCUSD в справочнике витрины `digits: 0`: для бегущей
   * строки целые доллары разумны, для стопа в три тика — нет.
   */
  const live = {
    symbol: 'BTCUSD',
    side: 'buy', // была ДЛИННАЯ
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

    // «по 80850.20 … на 10» противоречило бы само себе.
    expect(decimals(p.price)).toBe(decimals(p.level));
    expect(decimals(p.slippage)).toBe(decimals(p.price));
  });

  it('проскальзывание меньше полудоллара НЕ исчезает', () => {
    // Прежде округление до целых давало «на 0» — а вернее, вердикт
    // `none`, и о проскальзывании не говорилось вовсе. Знали и молчали.
    const p = tradeExecutedParams({ ...live, price: 80859.6 });

    expect(p?.slippageKind).toBe('against');
    expect(p?.slippage).toBe('0.37');
  });

  it('ВТОРАЯ СТОРОНА: ровно по уровню — про проскальзывание ни слова', () => {
    // Настоящий ноль — это «исполнено по уровню», и текста про
    // проскальзывание быть не должно вовсе.
    const p = tradeExecutedParams({ ...live, price: 80859.97 });

    expect(p?.slippageKind).toBe('none');
    expect(p?.slippage).toBe('');
    expect(notificationKey('tradeExecuted', p)).toBe('tradeExecuted');
  });

  it('справочная точность — нижняя граница, а не потолок', () => {
    // У EURUSD пять знаков; число с двумя не должно показываться
    // грубее, чем человек привык видеть.
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
