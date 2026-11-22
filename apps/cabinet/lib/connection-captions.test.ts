import { describe, expect, it } from 'vitest';
import en from '../messages/en.json';
import ru from '../messages/ru.json';

const DATA_CLAIMS = [/реальн/i, /real[-\s]?time/i, /\bлайв\b/i, /\blive\b/i];

describe('подписи состояния соединения в кабинете', () => {
  it.each([
    ['ru', ru.connection.connected],
    ['en', en.connection.connected],
  ])('%s connection.connected не обещает настоящих данных', (locale, text) => {
    const claim = DATA_CLAIMS.find((re) => re.test(text));
    expect(claim, `${locale}: «${text}»`).toBeUndefined();
    expect(text.trim().length).toBeGreaterThan(0);
  });

  it('состояние simulated продолжает называть цены нерыночными (B-018)', () => {
    expect(ru.connection.simulated).toMatch(/не рыночные/i);
    expect(en.connection.simulated).toMatch(/not real market/i);
  });
});
