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
  ts: 1_700_000_000_000,
};

describe('WEB-35 · законное проходит', () => {
  it('годная котировка разбирается без потерь', () => {
    const { quotes, rejected, novelties } = parseQuoteBatch([good]);

    expect(quotes).toEqual([good]);
    expect(rejected).toEqual([]);
    expect(novelties).toEqual([]);
  });

  it('незнакомое поле НЕ отказ — котировка проходит целиком', () => {
    const { quotes, rejected } = parseQuoteBatch([{ ...good, bid: 1.084, ask: 1.0844 }]);

    expect(quotes).toEqual([good]);
    expect(rejected).toEqual([]);
  });

  it('но незнакомое поле названо вслух — иначе оно потерялось бы молча', () => {
    const { novelties } = parseQuoteBatch([{ ...good, bid: 1.084, ask: 1.0844 }]);

    // Ровно то третье следствие, ради которого задача и заведена.
    expect(novelties).toEqual(['field:bid', 'field:ask']);
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
      { ...good, bid: 1 },
      { ...good, symbol: 'GBPUSD', bid: 2 },
    ]);

    expect(novelties).toEqual(['field:bid']);
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
