import { cookies } from 'next/headers';

/** Варианты палитры центра управления (блоки в @broker/ui/tokens.css). */
export const ADMIN_PALETTES = ['graphite', 'gold', 'paper'] as const;
export type AdminPalette = (typeof ADMIN_PALETTES)[number];

/**
 * Палитра для СРАВНЕНИЯ вариантов на локальном стенде (cookie `adm_palette`).
 *
 * Fail-closed: работает ТОЛЬКО при `NODE_ENV=development` (`next dev`). В
 * собранном приложении (`next build`/`start` — всегда production) функция
 * возвращает `undefined` и cookie даже не читается: прод показывает палитру по
 * умолчанию из tokens.css, и переключить её извне нельзя.
 */
export function devPalette(): AdminPalette | undefined {
  if (process.env.NODE_ENV !== 'development') return undefined;
  const value = cookies().get('adm_palette')?.value;
  return (ADMIN_PALETTES as readonly string[]).includes(value ?? '')
    ? (value as AdminPalette)
    : undefined;
}
