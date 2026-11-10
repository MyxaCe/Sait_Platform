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
