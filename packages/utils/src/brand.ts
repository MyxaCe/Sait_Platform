/**
 * '#d4a437' → '212 164 55' (формат RGB-каналов наших CSS-токенов).
 * Используется сайтом и кабинетом для инжекции акцента бренда из CMS.
 */
export function hexToRgbChannels(hex: string): string | null {
  const match = /^#([0-9a-fA-F]{6})$/.exec(hex);
  if (!match) return null;
  const value = parseInt(match[1]!, 16);
  return `${(value >> 16) & 255} ${(value >> 8) & 255} ${value & 255}`;
}
