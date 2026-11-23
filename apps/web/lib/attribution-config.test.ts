import { afterEach, describe, expect, it, vi } from 'vitest';
import { attributionWindowDays, resetAttributionConfigCache } from './attribution-config';
import { cabinetRegisterHref } from './cabinet-links';

afterEach(() => {
  resetAttributionConfigCache();
  vi.unstubAllEnvs();
});

describe('срок атрибуции — из настроек платформы (через кабинет)', () => {
  it('читает число из ручки кабинета и кеширует', async () => {
    vi.stubEnv('CABINET_INTERNAL_URL', 'http://cabinet.internal');
    const f = vi.fn(async () => Response.json({ attributionWindowDays: 45 }));
    expect(await attributionWindowDays(f as unknown as typeof fetch, 1_000)).toBe(45);
    expect(await attributionWindowDays(f as unknown as typeof fetch, 2_000)).toBe(45);
    expect(f).toHaveBeenCalledTimes(1);
    expect(String((f.mock.calls[0] as unknown[])[0])).toBe('http://cabinet.internal/api/public/platform-terms');
  });
  it('кабинет недоступен или мусор — null (срок не выдумываем)', async () => {
    vi.stubEnv('CABINET_INTERNAL_URL', 'http://cabinet.internal');
    expect(await attributionWindowDays((async () => { throw new Error('down'); }) as unknown as typeof fetch)).toBeNull();
    resetAttributionConfigCache();
    expect(await attributionWindowDays((async () => Response.json({ attributionWindowDays: 0 })) as unknown as typeof fetch)).toBeNull();
  });
});

describe('CTA «Открыть счёт» / акции → регистрация кабинета', () => {
  it('сохраняет query (promo, ref, account) и локаль; чужие ссылки не трогает', () => {
    const base = (process.env.NEXT_PUBLIC_CABINET_URL || 'http://localhost:3002').replace(/\/$/, '');
    expect(cabinetRegisterHref('/register?promo=welcome-first-deposit', 'ru')).toBe(`${base}/register?promo=welcome-first-deposit`);
    expect(cabinetRegisterHref('/register', 'en')).toBe(`${base}/en/register`);
    expect(cabinetRegisterHref('/registration', 'ru')).toBe('/registration');
    expect(cabinetRegisterHref('/partners', 'ru')).toBe('/partners');
  });
});

describe('старые адреса витрины /register и /login → кабинет', () => {
  const base = (process.env.NEXT_PUBLIC_CABINET_URL || 'http://localhost:3002').replace(/\/$/, '');
  it('переносит тариф account → accountType, промокод и демо; язык в пути', async () => {
    const { cabinetRegisterRedirect } = await import('./cabinet-links');
    expect(cabinetRegisterRedirect({ account: 'pro' }, 'ru')).toBe(`${base}/register?accountType=pro`);
    expect(cabinetRegisterRedirect({ accountType: 'ecn', account: 'pro' }, 'en')).toBe(`${base}/en/register?accountType=ecn`);
    expect(cabinetRegisterRedirect({ demo: '1', promo: ['a', 'b'], empty: '' }, 'ru')).toBe(`${base}/register?demo=1&promo=a`);
    expect(cabinetRegisterRedirect(undefined, 'de')).toBe(`${base}/de/register`);
  });
  it('вход витрины → вход кабинета', async () => {
    const { cabinetLoginHref } = await import('./cabinet-links');
    expect(cabinetLoginHref('ru')).toBe(`${base}/login`);
    expect(cabinetLoginHref('en')).toBe(`${base}/en/login`);
  });
});
