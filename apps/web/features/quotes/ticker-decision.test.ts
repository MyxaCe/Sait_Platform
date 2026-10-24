import { describe, expect, it } from 'vitest';
import {
  decideTicker,
  NO_OVERLAP_REASON,
  type TickerAccess,
  type TickerCatalog,
} from './ticker-decision';

/**
 * WEB-08 / Р-050: на границе котировок нет умолчания.
 *
 * **Дефект.** Общий макет витрины звал `getMdsSymbols()` на сборке, где
 * `MDS_HTTP_URL` нет. Функция возвращала `null`, `null` читался как
 * «фильтра нет», и в бегущую строку уезжал зашитый
 * `DEFAULT_TICKER_SYMBOLS` — символы, про которые никто не подтверждал,
 * что они вообще транслируются. Рядом с живыми ценами стояли
 * выдуманные, и отличить одно от другого посетителю было нечем.
 *
 * **Почему проверки здесь, а не в компоненте.** Решение сведено в чистую
 * функцию именно затем, чтобы его можно было покрасить без DOM: дорогая
 * проверка, которую перестали запускать, не защищает ни от чего.
 *
 * **Мутация, которой это проверено** (журнал багов, B-029): вернуть в
 * `decideTicker` ветку `if (catalog.state !== 'available') return { kind:
 * 'ticker', symbols: DEFAULT_TICKER_SYMBOLS.filter(...) }` — то есть
 * ровно исходный дефект.
 */

const ALLOWED = (symbols: string[]): TickerAccess => ({ state: 'allowed', symbols });
const STREAMING = (symbols: string[]): TickerCatalog => ({ state: 'available', symbols });

describe('decideTicker · каталога нет — строки нет', () => {
  it.each([
    ['not-configured', 'MDS_HTTP_URL не задан в окружении отвечающего процесса'],
    ['unreachable', 'адрес есть, MDS молчит'],
    ['empty', 'MDS ответил, но не транслирует ничего'],
  ])('каталог %s → отказ, а не зашитый список', (reason) => {
    const decision = decideTicker(
      ['EURUSD', 'BTCUSD', 'XAUUSD'],
      ALLOWED(['EURUSD', 'BTCUSD', 'XAUUSD']),
      { state: 'unavailable', reason, symbols: [] },
    );

    // Главное утверждение задачи: НИ ОДНОГО символа наружу.
    expect(decision).toEqual({
      kind: 'notice',
      state: 'unavailable',
      reason: `quotes:${reason}`,
    });
  });

  it('причина каталога отличима от причины границы доступа машиной', () => {
    // `not-configured` бывает и у CMS, и у MDS. Один машинный признак на
    // два диагноза — это B-026 слово в слово: fail-closed спасает
    // разрешение, но не диагноз, и чинить отправляют не туда.
    const fromCms = decideTicker([], { state: 'unavailable', reason: 'not-configured', symbols: [] }, STREAMING(['EURUSD']));
    const fromMds = decideTicker(['EURUSD'], ALLOWED(['EURUSD']), {
      state: 'unavailable',
      reason: 'not-configured',
      symbols: [],
    });

    expect(fromCms).toMatchObject({ reason: 'not-configured' });
    expect(fromMds).toMatchObject({ reason: 'quotes:not-configured' });
    expect(fromCms).not.toEqual(fromMds);
  });

  it('граница доступа отвечает первой: каталог её не открывает и не объясняет', () => {
    // Регуляторный фильтр важнее. Живой каталог MDS не делает
    // неразрешённые инструменты разрешёнными.
    const decision = decideTicker(
      ['EURUSD'],
      { state: 'empty', symbols: [] },
      STREAMING(['EURUSD', 'BTCUSD']),
    );

    expect(decision).toMatchObject({ kind: 'notice', state: 'empty' });
  });

  it('у состояния «пусто» причины НЕТ, и выдумывать её нельзя (WEB-26)', () => {
    // Прежде здесь стояло `reason: 'unknown'`, и полоса писала
    // «котировки не показываются (unknown)». Это утверждение, что
    // причина была, а мы её не поняли, — тогда как список получен и
    // пуст, и пустота ЕСТЬ ответ. Тот же довод, что у пустого
    // `changePercent`: отсутствие значения и значение — разные
    // утверждения (Р-118).
    const decision = decideTicker(['EURUSD'], { state: 'empty', symbols: [] }, STREAMING(['EURUSD']));

    expect(decision.kind).toBe('notice');
    expect(decision.kind === 'notice' && decision.reason).toBeUndefined();
  });

  it('у недоступности причина ЕСТЬ и доезжает как есть', () => {
    // Растяжка: «не выдумывать» не значит «не показывать». Там, где
    // источник причину назвал, она обязана дойти до разметки.
    const decision = decideTicker(
      ['EURUSD'],
      { state: 'unavailable', reason: 'expired', symbols: [] },
      STREAMING(['EURUSD']),
    );

    expect(decision).toMatchObject({ kind: 'notice', state: 'unavailable', reason: 'expired' });
  });

  it('причина каталога без значения не превращается в голый префикс', () => {
    // `quotes:` без причины — признак, который ничего не называет, но
    // выглядит названным.
    const decision = decideTicker(
      ['EURUSD'],
      { state: 'allowed', symbols: ['EURUSD'] },
      { state: 'unavailable', symbols: [] },
    );

    expect(decision.kind === 'notice' && decision.reason).toBeUndefined();
  });
});

describe('decideTicker · пересечение, а не замена', () => {
  it('в строку попадает только то, что разрешено И транслируется И есть на витрине', () => {
    const decision = decideTicker(
      ['EURUSD', 'BTCUSD', 'AAPL'],
      ALLOWED(['EURUSD', 'BTCUSD', 'TSLA']),
      STREAMING(['EURUSD', 'AAPL', 'TSLA']),
    );

    // BTCUSD разрешён, но не транслируется. AAPL транслируется, но не
    // разрешён. TSLA разрешена и транслируется, но её нет на витрине.
    expect(decision).toEqual({ kind: 'ticker', symbols: ['EURUSD'] });
  });

  it('символ, которого нет в каталоге, не проходит даже будучи разрешённым', () => {
    // Растяжка под ADR-024: именно это свойство — «замершие мок-цены
    // рядом с живыми нельзя» — и есть смысл третьего сомножителя. Тот,
    // кто решит упростить пересечение до двух, увидит этот тест.
    const decision = decideTicker(['EURUSD', 'BTCUSD'], ALLOWED(['EURUSD', 'BTCUSD']), STREAMING(['EURUSD']));

    expect(decision).toEqual({ kind: 'ticker', symbols: ['EURUSD'] });
  });

  it('оба ответа есть, пересечение пусто → отдельное состояние, а не исчезнувшая строка', () => {
    // `TickerTape` при нуле элементов возвращает `null`: пустой список
    // отдать в ленту значит молча убрать строку, и «показывать нечего»
    // станет неотличимо от «строки тут не бывает».
    const decision = decideTicker(['AAPL'], ALLOWED(['EURUSD']), STREAMING(['EURUSD']));

    expect(decision).toEqual({ kind: 'notice', state: 'empty', reason: NO_OVERLAP_REASON });
    expect(decision).not.toMatchObject({ kind: 'ticker' });
  });

  it('пустое пересечение отличимо от пустого allow-list', () => {
    // Два разных факта о мире: «владелец ничего не выбрал» и «выбранное
    // сейчас не торгуется». Один текст на оба отправил бы владельца
    // править настройку, которая в порядке.
    const noSelection = decideTicker(['AAPL'], { state: 'empty', symbols: [] }, STREAMING(['AAPL']));
    const noOverlap = decideTicker(['AAPL'], ALLOWED(['EURUSD']), STREAMING(['EURUSD']));

    expect(noSelection.kind === 'notice' && noSelection.reason).not.toBe(
      noOverlap.kind === 'notice' && noOverlap.reason,
    );
  });
});
