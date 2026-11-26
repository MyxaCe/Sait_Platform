import { describe, expect, it } from 'vitest';
import { accentHoverChannels, brandAccent, brandAccentCss, contrastRatio, onAccentChannels } from './brand';

describe('цвет бренда из CMS красит всё, а не только --accent (ТД-009 п.3)', () => {
  it('без цвета или с кривым цветом — токены не трогаем', () => {
    expect(brandAccent(null)).toBeNull();
    expect(brandAccent('gold')).toBeNull();
    expect(brandAccentCss(undefined)).toBeNull();
  });

  it('светлый бренд (жёлтый): наведение темнее, текст тёмный, контраст AA', () => {
    const b = brandAccent('#f5d90a')!;
    expect(b.accent).toBe('245 217 10');
    const [r, g] = b.hover.split(' ').map(Number);
    expect(r!).toBeLessThan(245);
    expect(g!).toBeLessThan(217);
    expect(b.onAccent).toBe('22 17 6');
    expect(contrastRatio(b.onAccent, b.accent)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(b.onAccent, b.hover)).toBeGreaterThanOrEqual(4.5);
  });

  it('тёмный бренд (синий): наведение светлее, текст белый, контраст AA', () => {
    const b = brandAccent('#1d3fa8')!;
    const [r] = b.hover.split(' ').map(Number);
    expect(r!).toBeGreaterThan(29);
    expect(b.onAccent).toBe('255 255 255');
    expect(contrastRatio(b.onAccent, b.accent)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(b.onAccent, b.hover)).toBeGreaterThanOrEqual(4.5);
  });

  it('золото по умолчанию даёт то же, что токены (тёмный текст, наведение светлее)', () => {
    expect(onAccentChannels('212 164 55')).toBe('22 17 6');
    const [r] = accentHoverChannels('212 164 55').split(' ').map(Number);
    expect(r!).toBeGreaterThan(212);
  });

  it('строка для <style> задаёт все три переменные', () => {
    expect(brandAccentCss('#1d3fa8')).toMatch(/^:root\{--accent:29 63 168;--accent-hover:[\d ]+;--text-on-accent:255 255 255;\}$/);
  });
});
