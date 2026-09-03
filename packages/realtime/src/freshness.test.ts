import { describe, expect, it } from 'vitest';
import { quoteState } from './freshness';
import type { Quote } from './types';

const NOW = 1_800_000_000_000;

const quote = (over: Partial<Quote> = {}): Quote => ({
  symbol: 'EURUSD',
  name: 'Euro / US Dollar',
  category: 'forex',
  price: 1.0842,
  digits: 5,
  changePercent: 0.12,
  ts: NOW - 1_000,
  ...over,
});

describe('quoteState · три разных сообщения, а не два', () => {
  it('живой фид, свежая котировка → live', () => {
    expect(quoteState(quote(), { feedStatus: 'connected', now: NOW })).toBe('live');
  });

  it('мок-фид → simulated, а не unavailable: цифра есть, но не рыночная', () => {
    expect(quoteState(quote(), { feedStatus: 'simulated', now: NOW })).toBe('simulated');
  });

  it('символа нет вовсе → unavailable', () => {
    expect(quoteState(undefined, { feedStatus: 'connected', now: NOW })).toBe('unavailable');
  });

  it('символ объявлен источником протухшим → unavailable', () => {
    const state = quoteState(quote(), {
      feedStatus: 'connected',
      staleSymbols: new Set(['EURUSD']),
      now: NOW,
    });
    expect(state).toBe('unavailable');
  });

  it('стартовый снапшот (ts=0) → unavailable, а не цена справочника', () => {
    expect(quoteState(quote({ ts: 0 }), { feedStatus: 'connected', now: NOW })).toBe('unavailable');
  });

  it('фид отвалился → unavailable: молчание не выдаётся за тихий рынок', () => {
    expect(quoteState(quote(), { feedStatus: 'offline', now: NOW })).toBe('unavailable');
  });
});

describe('quoteState · порог возраста приходит снаружи', () => {
  it('без порога возраст не судим — источник о свежести ничего не сказал', () => {
    const old = quote({ ts: NOW - 86_400_000 }); // сутки
    expect(quoteState(old, { feedStatus: 'connected', now: NOW })).toBe('live');
  });

  it('с порогом старше него → unavailable', () => {
    const old = quote({ ts: NOW - 120_000 });
    expect(quoteState(old, { feedStatus: 'connected', staleAfterMs: 60_000, now: NOW })).toBe(
      'unavailable',
    );
  });

  it('с порогом младше него → live', () => {
    const fresh = quote({ ts: NOW - 30_000 });
    expect(quoteState(fresh, { feedStatus: 'connected', staleAfterMs: 60_000, now: NOW })).toBe(
      'live',
    );
  });

  it('ровно на пороге ещё live — граница не выбрасывает валидную цену', () => {
    const edge = quote({ ts: NOW - 60_000 });
    expect(quoteState(edge, { feedStatus: 'connected', staleAfterMs: 60_000, now: NOW })).toBe(
      'live',
    );
  });
});

describe('quoteState · приоритет вердиктов', () => {
  it('мок важнее протухания: спрашивать возраст у выдуманной цены бессмысленно', () => {
    const state = quoteState(quote({ ts: NOW - 999_999 }), {
      feedStatus: 'simulated',
      staleSymbols: new Set(['EURUSD']),
      staleAfterMs: 1_000,
      now: NOW,
    });
    expect(state).toBe('simulated');
  });

  it('пустое множество протухших не означает «всё свежо»', () => {
    // Источник ничего не сказал — судим только по порогу, а он здесь есть
    const state = quoteState(quote({ ts: NOW - 120_000 }), {
      feedStatus: 'connected',
      staleSymbols: new Set(),
      staleAfterMs: 60_000,
      now: NOW,
    });
    expect(state).toBe('unavailable');
  });
});
