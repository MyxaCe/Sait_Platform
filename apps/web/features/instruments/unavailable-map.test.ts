import { describe, expect, it } from 'vitest';
import type { QuotesState } from '@broker/realtime';
import {
  agreesWithStaleSymbols,
  reasonsFromState,
  unavailableReasonsOf,
} from './unavailable-map';

/**
 * WEB-39 · страница инструментов узнаёт причину молчания.
 *
 * **Почему это место хуже ленты.** Лента показывает несколько бегущих
 * символов; список показывает ВСЕ разрешённые, и неторгуемый стоит в
 * нём **рядом с работающими**. Прочерк рядом с уверенным числом
 * читается как «это неизвестно, а остальное известно» — мой же урок из
 * WEB-17, здесь повторённый семнадцать раз подряд.
 *
 * Список при этом каталогом MDS не фильтруется (в отличие от ленты):
 * он равен CMS ∩ allow-list, поэтому нетранслируемые символы в нём
 * остаются — и молчат.
 */

const state = (over: Partial<QuotesState> = {}): QuotesState => ({
  unavailable: [],
  missing: [],
  ...over,
});

describe('WEB-39 · раскладка причин', () => {
  it('причина доезжает по символу', () => {
    const map = reasonsFromState(
      state({ unavailable: [{ symbol: 'EURUSD', reason: 'source-disabled' }] }),
    );

    expect(map).toEqual({ EURUSD: 'source-disabled' });
  });

  it('имя вне контракта сохраняется, а не выбрасывается', () => {
    const map = reasonsFromState(
      state({ unavailable: [{ symbol: 'EURUSD', reason: null, rawReason: 'cosmic-rays' }] }),
    );

    expect(map.EURUSD).toBe('cosmic-rays');
  });

  it('«не упомянут» — своя причина, не та же, что «молчит»', () => {
    const map = reasonsFromState(state({ missing: ['XAUUSD'] }));

    expect(map.XAUUSD).toBe('missing');
  });

  it('названная причина важнее отсутствия упоминания', () => {
    const map = reasonsFromState(
      state({ unavailable: [{ symbol: 'EURUSD', reason: 'stale' }], missing: ['EURUSD'] }),
    );

    expect(map.EURUSD).toBe('stale');
  });

  it('у инструмента с ценой причины нет вовсе', () => {
    // Ключ, появившийся здесь, дал бы объяснение там, где объяснять
    // нечего.
    expect(reasonsFromState(state())).toEqual({});
  });
});

describe('WEB-39 · не спросили — не знаем', () => {
  it.each(['not-configured', 'network', 'http-error', 'malformed'] as const)(
    'отказ «%s» → пусто, а не причина отказа у каждого символа',
    (reason) => {
      // Это причина, по которой МЫ не смогли спросить, а не причина,
      // по которой у инструмента нет цены. Подставить одну вместо
      // другой значило бы объяснить человеку не то.
      expect(unavailableReasonsOf({ state: 'unavailable', reason })).toEqual({});
    },
  );

  it('ответили — причины раскладываются', () => {
    expect(
      unavailableReasonsOf({
        state: 'available',
        quotes: state({ unavailable: [{ symbol: 'EURUSD', reason: 'no-source' }] }),
      }),
    ).toEqual({ EURUSD: 'no-source' });
  });
});

describe('WEB-39 · два перечисления одного множества не разошлись', () => {
  it.each([
    ['только недоступные', state({ unavailable: [{ symbol: 'A', reason: 'stale' }] })],
    ['только неупомянутые', state({ missing: ['B'] })],
    [
      'и те и другие',
      state({ unavailable: [{ symbol: 'A', reason: 'stale' }], missing: ['B', 'A'] }),
    ],
    ['пусто', state()],
  ])('%s', (_name, s) => {
    // Иначе объяснение стояло бы не у тех инструментов, у которых
    // погашена цена, — и это было бы заметно только глазами.
    expect(agreesWithStaleSymbols(s)).toBe(true);
  });

  it('проверка согласия умеет краснеть', () => {
    // Растяжка: подменяем одну из сторон и ждём несогласия.
    const s = state({ unavailable: [{ symbol: 'A', reason: 'stale' }] });
    const broken = { ...s, missing: ['Z'] };

    expect(agreesWithStaleSymbols(s)).toBe(true);
    expect(Object.keys(reasonsFromState(broken))).toContain('Z');
  });
});
