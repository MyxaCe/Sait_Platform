import { cookies } from 'next/headers';

export const ADMIN_PALETTES = ['graphite', 'gold', 'paper'] as const;
export type AdminPalette = (typeof ADMIN_PALETTES)[number];

export function devPalette(): AdminPalette | undefined {
  if (process.env.NODE_ENV !== 'development') return undefined;
  const value = cookies().get('adm_palette')?.value;
  return (ADMIN_PALETTES as readonly string[]).includes(value ?? '')
    ? (value as AdminPalette)
    : undefined;
}
