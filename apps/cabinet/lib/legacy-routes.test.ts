import { describe, expect, it } from 'vitest';
import { legacyTarget } from './legacy-routes';

describe('старые адреса кабинета → новое место (r2)', () => {
  it.each([
    ['/deposit', '', '/wallet?tab=deposit'],
    ['/withdraw', '', '/wallet?tab=withdraw'],
    ['/en/withdraw', '', '/en/wallet?tab=withdraw'],
    ['/verification', '', '/profile?tab=verification'],
    ['/documents/', '', '/profile?tab=documents'],
    ['/security', '', '/profile?tab=security'],
    ['/trade', '?account=real', '/terminal?account=real'],
    ['/en/trade', '?account=demo', '/en/terminal?account=demo'],
  ])('%s%s → %s', (path, search, target) => {
    expect(legacyTarget(path, search)).toBe(target);
  });

  it('новые и прочие адреса не трогаем', () => {
    expect(legacyTarget('/trade', '')).toBeNull();
    expect(legacyTarget('/trade', '?account=evil')).toBeNull();
    expect(legacyTarget('/wallet', '')).toBeNull();
    expect(legacyTarget('/depositx', '')).toBeNull();
  });
});
