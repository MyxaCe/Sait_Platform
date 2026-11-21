import { describe, expect, it } from 'vitest';
import { explainUnavailable, shortKeyOf } from './unavailable-text';

describe('закрытый рынок · причина MDS понятна человеку', () => {
  it.each([
    ['market-closed', 'marketClosed'],
    ['closed', 'marketClosed'],
    ['market-halted', 'marketHalted'],
    ['halted', 'marketHalted'],
  ])('%s → %s, семейство market', (reason, key) => {
    expect(explainUnavailable(reason)).toEqual({ key, family: 'market' });
  });

  it('короткая подпись рынка — сама фраза, а не «цены нет»', () => {
    expect(shortKeyOf(explainUnavailable('market-closed'))).toBe('marketClosed');
    expect(shortKeyOf(explainUnavailable('source-silent'))).toBe('shortFault');
    expect(shortKeyOf(explainUnavailable('source-disabled'))).toBe('shortLimited');
  });

  it('имя из прототипа объекта не принимается за причину рынка', () => {
    expect(explainUnavailable('constructor')).toEqual({ key: 'technical', family: 'fault' });
    expect(explainUnavailable('toString')).toEqual({ key: 'technical', family: 'fault' });
  });
});
