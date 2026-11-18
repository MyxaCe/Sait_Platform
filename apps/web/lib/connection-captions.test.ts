import { describe, expect, it } from 'vitest';
import en from '../messages/en.json';
import ru from '../messages/ru.json';

const DATA_CLAIMS = [/реальн/i, /real[-\s]?time/i, /\bлайв\b/i, /\blive\b/i];

const CAPTIONS: Array<[string, string]> = [
  ['ru connection.connected', ru.connection.connected],
  ['en connection.connected', en.connection.connected],
  ['ru instruments.statusLive', ru.instruments.statusLive],
  ['en instruments.statusLive', en.instruments.statusLive],
];

describe('подписи состояния «соединение установлено»', () => {
  it.each(CAPTIONS)('%s не обещает настоящих данных', (name, text) => {
    const claim = DATA_CLAIMS.find((re) => re.test(text));
    expect(claim, `${name}: «${text}»`).toBeUndefined();
  });

  it('обе локали заполнены и различны между собой', () => {
    for (const [name, text] of CAPTIONS) {
      expect(text.trim().length, name).toBeGreaterThan(0);
    }
    expect(ru.connection.connected).not.toBe(en.connection.connected);
  });

  it('состояние simulated продолжает называть цены нерыночными (B-018)', () => {
    expect(ru.connection.simulated).toMatch(/не рыночные/i);
    expect(en.connection.simulated).toMatch(/not real market/i);
  });
});
