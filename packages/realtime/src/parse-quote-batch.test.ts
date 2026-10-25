import { describe, expect, it } from 'vitest';
import { parseQuoteBatch } from './parse-quote-batch';

/**
 * WEB-35 · тело с провода разбирается, а не объявляется.
 *
 * Проверяются ДВЕ стороны, и вторая здесь не формальность. Разбор,
 * падающий на всём незнакомом, уронит котировки в первый же день,
 * когда сосед что-нибудь добавит, — и его снимут, вернув приведение к
 * типу. Поэтому: незнакомое поле проходит, несовпавшая форма
 * известного — нет.
 */

const good = {
  symbol: 'EURUSD',
  name: 'Euro / US Dollar',
  category: 'forex',
  price: 1.0842,
  digits: 5,
  changePercent: 0.12,
  bid: 1.0841,
  ask: 1.0843,
  ts: 1_700_000_000_000,
};

describe('WEB-35 · законное проходит', () => {
  it('годная котировка разбирается без потерь', () => {
    const { quotes, rejected, novelties } = parseQuoteBatch([good]);

    expect(quotes).toEqual([good]);
    expect(rejected).toEqual([]);
    expect(novelties).toEqual([]);
  });

  /*
    Образцом незнакомого поля здесь были `bid` и `ask` — ровно до
    WEB-36, когда их завели в модель. Замена на объёмы сторон не
    косметическая: она показывает, что механизм сработал по
    назначению — новость перестала быть новостью, став читаемым
    полем. Следующий кандидат от биржи как раз они.
  */
  it('незнакомое поле НЕ отказ — котировка проходит целиком', () => {
    const { quotes, rejected } = parseQuoteBatch([{ ...good, bidSize: 12, askSize: 8 }]);

    expect(quotes).toEqual([good]);
    expect(rejected).toEqual([]);
  });

  it('но незнакомое поле названо вслух — иначе оно потерялось бы молча', () => {
    const { novelties } = parseQuoteBatch([{ ...good, bidSize: 12, askSize: 8 }]);

    // Ровно то третье следствие, ради которого задача и заведена.
    expect(novelties).toEqual(['field:bidSize', 'field:askSize']);
  });

  it('`source` новостью не считается: про него мы знаем и решение записано', () => {
    const { quotes, novelties } = parseQuoteBatch([{ ...good, source: 'binance' }]);

    expect(quotes).toHaveLength(1);
    expect(novelties).toEqual([]);
  });

  it('ноль в изменении — настоящее значение, а не незнание', () => {
    const [quote] = parseQuoteBatch([{ ...good, changePercent: 0 }]).quotes;

    expect(quote?.changePercent).toBe(0);
  });

  it('`ts: 0` законен — «настоящего чтения не было»', () => {
    const { quotes, rejected } = parseQuoteBatch([{ ...good, ts: 0 }]);

    expect(quotes).toHaveLength(1);
    expect(rejected).toEqual([]);
  });

  it('новость называется один раз на батч, а не по разу на котировку', () => {
    const { novelties } = parseQuoteBatch([
      { ...good, bidSize: 1 },
      { ...good, symbol: 'GBPUSD', bidSize: 2 },
    ]);

    expect(novelties).toEqual(['field:bidSize']);
  });
});

describe('WEB-35 · несовпавшая форма известного — отказ, и названный', () => {
  it.each([
    ['price строкой', { price: '1.0842' }, 'price'],
    ['price не число', { price: Number.NaN }, 'price'],
    ['ts строкой', { ts: '1700000000000' }, 'ts'],
    ['digits дробное', { digits: 2.5 }, 'digits'],
    ['digits отрицательное', { digits: -1 }, 'digits'],
    ['name пустое', { name: '' }, 'name'],
    ['category не из перечня', { category: 'bonds' }, 'category'],
  ])('%s → котировка отброшена, поле названо', (_name, patch, field) => {
    const { quotes, rejected } = parseQuoteBatch([{ ...good, ...patch }]);

    expect(quotes).toEqual([]);
    expect(rejected.map((r) => r.field)).toContain(field);
  });

  it.each([
    ['отсутствует', {}, 'missing'],
    ['не строка', { symbol: 42 }, 'wrong-type'],
  ])('символ %s → отбрасываем, отнести причину не к чему', (_n, patch, reason) => {
    const { symbol: _drop, ...noSymbol } = good;
    const { quotes, rejected } = parseQuoteBatch([{ ...noSymbol, ...patch }]);

    expect(quotes).toEqual([]);
    expect(rejected[0]).toEqual({ symbol: null, field: 'symbol', reason });
  });

  it('отсутствие и негодный тип различаются — чинят их разные люди', () => {
    const { price: _drop, ...noPrice } = good;

    expect(parseQuoteBatch([noPrice]).rejected[0]?.reason).toBe('missing');
    expect(parseQuoteBatch([{ ...good, price: 'x' }]).rejected[0]?.reason).toBe('wrong-type');
  });

  it('новая категория и отброшена, и названа новостью', () => {
    const { quotes, rejected, novelties } = parseQuoteBatch([{ ...good, category: 'bonds' }]);

    expect(quotes).toEqual([]);
    expect(rejected[0]?.reason).toBe('unknown-value');
    // Иначе «сосед завёл облигации» выглядело бы как «облигации не идут».
    expect(novelties).toEqual(['category:bonds']);
  });

  it('не массив — это не пустой батч', () => {
    // Пустой батч означал бы «обновлений нет»; здесь сосед не сказал
    // ничего понятного, и смешивать эти два сообщения нельзя.
    const { quotes, rejected } = parseQuoteBatch({ quotes: [good] });

    expect(quotes).toEqual([]);
    expect(rejected).toEqual([{ symbol: null, field: '(batch)', reason: 'wrong-type' }]);
  });

  it.each([[null], [undefined], ['текст'], [42]])('мусор вместо батча (%s) не роняет разбор', (v) => {
    expect(() => parseQuoteBatch(v)).not.toThrow();
    expect(parseQuoteBatch(v).quotes).toEqual([]);
  });

  it('негодный элемент не уносит с собой годные соседние', () => {
    const { quotes, rejected } = parseQuoteBatch([
      good,
      { ...good, symbol: 'BADPRICE', price: 'x' },
      { ...good, symbol: 'GBPUSD' },
    ]);

    expect(quotes.map((q) => q.symbol)).toEqual(['EURUSD', 'GBPUSD']);
    expect(rejected).toHaveLength(1);
  });
});

describe('WEB-35 · изменение в процентах — единственное терпимое поле', () => {
  it('отсутствует → null, цена сохраняется', () => {
    const { changePercent: _drop, ...noChange } = good;
    const [quote] = parseQuoteBatch([noChange]).quotes;

    expect(quote?.changePercent).toBeNull();
    expect(quote?.price).toBe(good.price);
  });

  it('`null` → null, и это не отказ', () => {
    const { quotes, rejected } = parseQuoteBatch([{ ...good, changePercent: null }]);

    expect(quotes[0]?.changePercent).toBeNull();
    expect(rejected).toEqual([]);
  });

  it('негодная форма → null И запись об отказе: цену не теряем, но и не молчим', () => {
    // Терпимость здесь не ложь ровно потому, что незнание выразимо
    // третьим состоянием. Там, где оно невыразимо, терпимости нет.
    const { quotes, rejected } = parseQuoteBatch([{ ...good, changePercent: 'много' }]);

    expect(quotes[0]?.changePercent).toBeNull();
    expect(quotes[0]?.price).toBe(good.price);
    expect(rejected).toEqual([
      { symbol: 'EURUSD', field: 'changePercent', reason: 'wrong-type' },
    ]);
  });
});

describe('WEB-36 · цены покупки и продажи', () => {
  it('приходят — читаются, а не выбрасываются', () => {
    const [quote] = parseQuoteBatch([{ ...good, bid: 1.0841, ask: 1.0843 }]).quotes;

    // До WEB-36 они доезжали до нас и терялись при разборе.
    expect(quote?.bid).toBe(1.0841);
    expect(quote?.ask).toBe(1.0843);
  });

  it.each([
    ['отсутствуют', {}],
    ['пришли пустыми', { bid: null, ask: null }],
  ])('%s → null, и это не отказ: поставщик их может не давать вовсе', (_n, patch) => {
    const { bid: _b, ask: _a, ...base } = good;
    const { quotes, rejected } = parseQuoteBatch([{ ...base, ...patch }]);

    expect(quotes[0]?.bid).toBeNull();
    expect(quotes[0]?.ask).toBeNull();
    expect(rejected).toEqual([]);
  });

  it('цена остаётся настоящей, когда книги нет', () => {
    const { bid: _b, ask: _a, ...base } = good;

    expect(parseQuoteBatch([base]).quotes[0]?.price).toBe(good.price);
  });

  it.each([
    ['ноль', 0],
    ['отрицательная', -1.5],
  ])('%s цена покупки — не пусто, а утверждение, и отвергается', (_n, value) => {
    // Нулевая цена покупки означала бы сделку по нулю.
    const { quotes, rejected } = parseQuoteBatch([{ ...good, bid: value }]);

    expect(quotes[0]?.bid).toBeNull();
    expect(rejected).toEqual([{ symbol: 'EURUSD', field: 'bid', reason: 'unknown-value' }]);
  });

  it('негодная форма → null и запись об отказе, но котировка цела', () => {
    // Критерий терпимости: незнание выразимо, значит цену не теряем.
    const { quotes, rejected } = parseQuoteBatch([{ ...good, ask: 'дорого' }]);

    expect(quotes[0]?.ask).toBeNull();
    expect(quotes[0]?.price).toBe(good.price);
    expect(quotes[0]?.bid).toBe(good.bid);
    expect(rejected).toEqual([{ symbol: 'EURUSD', field: 'ask', reason: 'wrong-type' }]);
  });

  it('одна сторона негодна — вторая сохраняется', () => {
    const [quote] = parseQuoteBatch([{ ...good, bid: 0 }]).quotes;

    expect(quote?.bid).toBeNull();
    expect(quote?.ask).toBe(good.ask);
  });

  it('`bid` и `ask` больше не числятся новостью: мы их читаем', () => {
    expect(parseQuoteBatch([{ ...good, bid: 1, ask: 2 }]).novelties).toEqual([]);
  });
});
