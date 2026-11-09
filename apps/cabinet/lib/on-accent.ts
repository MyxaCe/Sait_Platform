/**
 * Цвет текста на залитом акценте для акцента бренда из CMS (аудит С2/К9).
 *
 * Токен `--text-on-accent` подобран под наше золото. Бренд может подменить
 * `--accent` любым цветом — тогда текст на кнопке выбирается здесь: из двух
 * кандидатов (тёмный токена и белый) — тот, у которого контраст WCAG с
 * акцентом выше. Вход и выход — RGB-каналы «R G B» (формат токенов).
 */
const DARK = '22 17 6';
const LIGHT = '255 255 255';

const lin = (c: number): number => {
  const v = c / 255;
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};

export function relativeLuminance(channels: string): number {
  const [r = 0, g = 0, b = 0] = channels.split(/\s+/).map(Number);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

export function contrastRatio(a: string, b: string): number {
  const [x, y] = [relativeLuminance(a), relativeLuminance(b)].sort((p, q) => q - p) as [number, number];
  return (x + 0.05) / (y + 0.05);
}

export function onAccentChannels(accent: string): string {
  return contrastRatio(DARK, accent) >= contrastRatio(LIGHT, accent) ? DARK : LIGHT;
}
