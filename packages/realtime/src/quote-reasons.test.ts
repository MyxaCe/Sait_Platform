import { describe, expect, it } from 'vitest';
import {
  displayPrice,
  isSymbolUnavailableReason,
  parseQuotesState,
  staleSymbolsOf,
  SYMBOL_UNAVAILABLE_REASONS,
} from './quote-reasons';

/**
 * WEB-12 · читатель `unavailable[]` и `missing[]` (Р-074).
 *
 * Эталон перечня выписан **руками из `_brain/КОНТРАКТЫ.md` §4г**, а не
 * импортирован из реализации: список, сверенный сам с собой, не проверяет
 * ничего. Правка §4г обязана краснить этот тест — это задумано, ровно так
 * же устроено у `mds`.
 */

/** §4г, ось символа. Переписано из контракта вручную. */
const CONTRACT_SYMBOL_AXIS = [
  'registry-unreadable',
  'no-source',
  'source-disabled',
  'source-silent',
  'stale',
  'not-in-catalog',
  'threshold-unset',
];

/** §4г, ось канала. Нужна, чтобы ловить совпадения имён между осями. */
const CONTRACT_CHANNEL_AXIS = ['not-configured', 'network', 'http-error', 'malformed', 'empty'];

describe('ось символа · перечень совпадает с контрактом', () => {
  it('состав тот же, что в §4г', () => {
    expect([...SYMBOL_UNAVAILABLE_REASONS].sort()).toEqual([...CONTRACT_SYMBOL_AXIS].sort());
  });

  it('стиль один — kebab-case, без `snake_case`', () => {
    // На 20.10 §4 контракта всё ещё показывает эти же причины через
    // подчёркивание, а §4г объявляет нормой дефис и говорит, что MDS
    // переименовывает сейчас. Проверка закрепляет норму на нашей стороне.
    for (const reason of SYMBOL_UNAVAILABLE_REASONS) {
      expect(reason).toMatch(/^[a-z]+(?:-[a-z]+)*$/);
      expect(reason).not.toContain('_');
    }
  });

  it('оси не пересекаются именами, кроме согласованного совпадения', () => {
    // §4г: совпадение `registry-unreadable` — одно состояние под одним
    // именем, сознательно. Любое ДРУГОЕ совпадение краснит тест.
    const overlap = SYMBOL_UNAVAILABLE_REASONS.filter((r) =>
      CONTRACT_CHANNEL_AXIS.includes(r),
    ) as string[];

    expect(overlap).toEqual([]);
  });

  it('перечень живёт в рантайме, а не только в типе', () => {
    // Перечисление, существующее лишь в типе, компилятор стирает — ни
    // стиль проверить, ни состав сверить (§4г).
    expect(Array.isArray(SYMBOL_UNAVAILABLE_REASONS)).toBe(true);
    expect(SYMBOL_UNAVAILABLE_REASONS.length).toBe(7);
  });

  it('распознаёт только имена контракта', () => {
    expect(isSymbolUnavailableReason('source-silent')).toBe(true);
    expect(isSymbolUnavailableReason('source_silent')).toBe(false);
    expect(isSymbolUnavailableReason('whatever')).toBe(false);
    expect(isSymbolUnavailableReason(undefined)).toBe(false);
  });
});

describe('разбор ответа /v1/quotes', () => {
  it('читает причину по каждому символу', () => {
    const state = parseQuotesState({
      unavailable: [
        { symbol: 'EURUSD', reason: 'source-silent' },
        { symbol: 'XAUUSD', reason: 'stale' },
      ],
      missing: ['BTCUSD'],
    });

    expect(state.unavailable).toEqual([
      { symbol: 'EURUSD', reason: 'source-silent' },
      { symbol: 'XAUUSD', reason: 'stale' },
    ]);
    expect(state.missing).toEqual(['BTCUSD']);
  });

  it('незнакомая причина СОХРАНЯЕТСЯ, а не выбрасывается молча', () => {
    // Главное свойство разбора. Если MDS не успел переименовать ось и
    // пришлёт `source_silent`, символ обязан остаться недоступным, а
    // рассинхрон — стать видимым. Молчаливый пропуск превратил бы
    // «причина незнакомая» в «причины нет», то есть в «всё хорошо».
    const state = parseQuotesState({
      unavailable: [{ symbol: 'EURUSD', reason: 'source_silent' }],
    });

    expect(state.unavailable).toEqual([
      { symbol: 'EURUSD', reason: null, rawReason: 'source_silent' },
    ]);
  });

  it('элемент без символа отбрасывается — причина ни к чему не относится', () => {
    const state = parseQuotesState({
      unavailable: [{ reason: 'stale' }, { symbol: '', reason: 'stale' }],
    });

    expect(state.unavailable).toEqual([]);
  });

  it('мусор вместо списков читается как пустые списки, а не падает', () => {
    expect(parseQuotesState({ unavailable: 'нет', missing: 42 })).toEqual({
      unavailable: [],
      missing: [],
    });
    expect(parseQuotesState(null)).toEqual({ unavailable: [], missing: [] });
    expect(parseQuotesState(undefined)).toEqual({ unavailable: [], missing: [] });
  });

  it('пустые списки не означают «всё свежо»', () => {
    // §5г, требование 1: пустой список — это «источник ничего не сказал».
    // Здесь это закреплено формой: `staleSymbolsOf` отдаёт пустое
    // множество, а `quoteState` по пустому множеству НЕ выносит вердикт
    // «свежо» — он судит по порогу, которого без источника тоже нет.
    expect(staleSymbolsOf(parseQuotesState({})).size).toBe(0);
  });
});

describe('символы, которым нельзя верить', () => {
  it('`missing` входит наравне с `unavailable`', () => {
    // «Источник не сказал о символе ничего» — это тоже «цены нет».
    const stale = staleSymbolsOf(
      parseQuotesState({
        unavailable: [{ symbol: 'EURUSD', reason: 'stale' }],
        missing: ['XAUUSD'],
      }),
    );

    expect([...stale].sort()).toEqual(['EURUSD', 'XAUUSD']);
  });

  it('символ с незнакомой причиной тоже недоступен', () => {
    // Растяжка: потеря символа из-за непонятного имени означала бы, что
    // рассинхрон контракта показывает цену как живую.
    const stale = staleSymbolsOf(
      parseQuotesState({ unavailable: [{ symbol: 'EURUSD', reason: 'source_silent' }] }),
    );

    expect(stale.has('EURUSD')).toBe(true);
  });
});

/**
 * PKG-06 · что показывать на месте цены, решается ОДИН раз на обе зоны.
 *
 * Правило делят витрина и кабинет: тикер лежит в общем пакете, и
 * разошедшиеся копии одного правила дали бы два разных отказа на одном
 * экране.
 */
describe('displayPrice · гасить можно только настоящее чтение', () => {
  const fmt = (p: number, d: number) => p.toFixed(d);

  it('чтение было → цену отдаём, её погасит компонент', () => {
    expect(displayPrice({ price: 1.0842, digits: 4, ts: 1_700_000_000_000 }, fmt)).toBe('1.0842');
  });

  it('чтения не было (`ts = 0`) → `null`, а не зашитая базовая цена', () => {
    // Главное свойство. Показать фикстуру погашенной, с меткой «последняя
    // известная», хуже прочерка: это утверждение «цена такая была»,
    // которого не было. Гасить (Р-070) можно только однажды прочитанное.
    expect(displayPrice({ price: 1.0842, digits: 4, ts: 0 }, fmt)).toBeNull();
  });

  it('форматирование остаётся за приложением', () => {
    // Растяжка: у витрины и кабинета оно своё, и пакет его не навязывает.
    const calls: [number, number][] = [];
    displayPrice({ price: 2.5, digits: 2, ts: 1 }, (p, d) => {
      calls.push([p, d]);
      return 'что угодно';
    });

    expect(calls).toEqual([[2.5, 2]]);
  });

  it('при `ts = 0` форматирование даже не вызывается', () => {
    // Иначе «ничего не показываем» зависело бы от того, что вернёт
    // форматирование — а оно про другое.
    let called = false;
    displayPrice({ price: 1, digits: 2, ts: 0 }, () => {
      called = true;
      return '1.00';
    });

    expect(called).toBe(false);
  });
});
