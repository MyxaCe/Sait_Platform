export function hexToRgbChannels(hex: string): string | null {
  const match = /^#([0-9a-fA-F]{6})$/.exec(hex);
  if (!match) return null;
  const value = parseInt(match[1]!, 16);
  return `${(value >> 16) & 255} ${(value >> 8) & 255} ${value & 255}`;
}

type Rgb = readonly [number, number, number];

const DARK_TEXT: Rgb = [22, 17, 6];
const LIGHT_TEXT: Rgb = [255, 255, 255];

const parse = (channels: string): Rgb => {
  const [r = 0, g = 0, b = 0] = channels.trim().split(/\s+/).map(Number);
  return [r, g, b];
};
const fmt = (c: Rgb): string => c.map((v) => Math.round(Math.min(255, Math.max(0, v)))).join(' ');

const lin = (c: number): number => {
  const v = c / 255;
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};

export function relativeLuminance(channels: string): number {
  const [r, g, b] = parse(channels);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

export function contrastRatio(a: string, b: string): number {
  const [x, y] = [relativeLuminance(a), relativeLuminance(b)].sort((p, q) => q - p) as [number, number];
  return (x + 0.05) / (y + 0.05);
}

const mix = (c: Rgb, to: Rgb, share: number): Rgb => [
  c[0] + (to[0] - c[0]) * share,
  c[1] + (to[1] - c[1]) * share,
  c[2] + (to[2] - c[2]) * share,
];

/** Текст на кнопке цвета бренда: тёмный или белый — у кого контраст выше (по худшему из фона и наведения). */
export function onAccentChannels(accent: string, hover: string = accent): string {
  const dark = fmt(DARK_TEXT);
  const light = fmt(LIGHT_TEXT);
  const worst = (text: string) => Math.min(contrastRatio(text, accent), contrastRatio(text, hover));
  return worst(dark) >= worst(light) ? dark : light;
}

/** Цвет при наведении: светлый бренд темнеет, тёмный — светлеет (как в токенах: золото 212 164 55 → 230 188 85). */
export function accentHoverChannels(accent: string): string {
  const c = parse(accent);
  return fmt(relativeLuminance(accent) > 0.6 ? mix(c, [0, 0, 0], 0.12) : mix(c, [255, 255, 255], 0.15));
}

export interface BrandAccent {
  readonly accent: string;
  readonly hover: string;
  readonly onAccent: string;
}

/** Всё, что выводится из одного цвета бренда в CMS. null — цвет не задан или не #rrggbb: остаются токены. */
export function brandAccent(hex: string | null | undefined): BrandAccent | null {
  const accent = hex ? hexToRgbChannels(hex) : null;
  if (!accent) return null;
  const hover = accentHoverChannels(accent);
  return { accent, hover, onAccent: onAccentChannels(accent, hover) };
}

/** Строка для <style>: все переменные, которые красят интерфейс цветом бренда. */
export function brandAccentCss(hex: string | null | undefined): string | null {
  const b = brandAccent(hex);
  return b ? `:root{--accent:${b.accent};--accent-hover:${b.hover};--text-on-accent:${b.onAccent};}` : null;
}
