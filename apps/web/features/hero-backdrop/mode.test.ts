import { describe, expect, it } from 'vitest';
import { brandSchema } from '@broker/api-client/schemas';
import type { ConnStatus } from '@broker/realtime';
import {
  backdropMode,
  backdropProfile,
  DESKTOP_PROFILE,
  MOBILE_PROFILE,
  readHeroBackground,
} from './mode';

describe('heroBackground из бренда CMS', () => {
  it.each([
    ['quotes', { name: 'B', heroBackground: 'quotes' }, 'quotes'],
    ['off', { name: 'B', heroBackground: 'off' }, 'off'],
    ['поля нет — умолчание quotes', { name: 'B' }, 'quotes'],
    ['незнакомое значение — умолчание', { name: 'B', heroBackground: 'video' }, 'quotes'],
    ['не строка — умолчание', { name: 'B', heroBackground: 1 }, 'quotes'],
    ['бренда нет', null, 'quotes'],
  ])('%s', (_name, brand, expected) => {
    expect(readHeroBackground(brand)).toBe(expected);
  });
});

describe('режим фона', () => {
  const base = {
    setting: 'quotes' as const,
    feedStatus: 'connected' as ConnStatus,
    symbols: ['BTCUSD'],
    reducedMotion: false,
  };

  it('живой фид — линии текут', () => {
    expect(backdropMode(base)).toBe('flow');
  });

  it('prefers-reduced-motion — неподвижная картинка', () => {
    expect(backdropMode({ ...base, reducedMotion: true })).toBe('still');
  });

  it('heroBackground=off — фона нет, что бы ни было с фидом', () => {
    expect(backdropMode({ ...base, setting: 'off' })).toBe('off');
    expect(backdropMode({ ...base, setting: 'off', reducedMotion: true })).toBe('off');
  });

  it.each<ConnStatus>(['simulated', 'offline', 'connecting'])(
    'фид %s — только сетка, без линий',
    (feedStatus) => {
      expect(backdropMode({ ...base, feedStatus })).toBe('grid');
      expect(backdropMode({ ...base, feedStatus, reducedMotion: true })).toBe('grid');
    },
  );

  it('символов нет — только сетка', () => {
    expect(backdropMode({ ...base, symbols: [] })).toBe('grid');
  });
});

describe('профиль устройства', () => {
  it('на телефоне меньше линий и кадров', () => {
    expect(backdropProfile(true)).toBe(MOBILE_PROFILE);
    expect(backdropProfile(false)).toBe(DESKTOP_PROFILE);
    expect(MOBILE_PROFILE.maxLines).toBeLessThan(DESKTOP_PROFILE.maxLines);
    expect(MOBILE_PROFILE.fps).toBeLessThan(DESKTOP_PROFILE.fps);
    expect(DESKTOP_PROFILE.fps).toBeLessThanOrEqual(30);
  });
});

describe('heroBackground из ответа CMS через схему бренда', () => {
  const live = { feedStatus: 'connected' as ConnStatus, symbols: ['BTCUSD'], reducedMotion: false };
  const legacy = (extra: Record<string, unknown>) => ({
    name: 'B',
    logo: null,
    favicon: null,
    primaryColor: null,
    socials: [],
    ...extra,
  });
  const v2 = (extra: Record<string, unknown>) => ({
    contract: 'v1',
    site: { name: 'B' },
    brand: { logoLight: null, favicon: null, primaryColor: null, socials: [], ...extra },
  });

  it.each([
    ['legacy', legacy],
    ['v2', v2],
  ])('%s: "off" → фона нет', (_name, make) => {
    const setting = readHeroBackground(brandSchema.parse(make({ heroBackground: 'off' })));
    expect(setting).toBe('off');
    expect(backdropMode({ ...live, setting })).toBe('off');
  });

  it.each([
    ['legacy без поля', legacy({})],
    ['v2 без поля', v2({})],
    ['legacy с мусором', legacy({ heroBackground: 'video' })],
    ['v2 с мусором', v2({ heroBackground: 42 })],
  ])('%s → quotes', (_name, raw) => {
    const setting = readHeroBackground(brandSchema.parse(raw));
    expect(setting).toBe('quotes');
    expect(backdropMode({ ...live, setting })).toBe('flow');
  });
});
