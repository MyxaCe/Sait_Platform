import { getCms } from './cms';

export { hexToRgbChannels } from '@broker/utils';

export async function brandName(locale: string): Promise<string> {
  const brand = await getCms('brand', { locale: locale === 'en' ? 'en' : 'ru' });
  return brand.name;
}

export function legalNameFromEnv(): string | null {
  const raw = process.env.SITE_LEGAL_NAME?.trim();
  return raw ? raw : null;
}

export type PrimaryColorSource = 'cms' | 'tokens';

export interface ResolvedPrimaryColor {
  readonly color: string | null;
  readonly source: PrimaryColorSource;
}

export function resolvePrimaryColor(fromCms: string | null | undefined): ResolvedPrimaryColor {
  return fromCms ? { color: fromCms, source: 'cms' } : { color: null, source: 'tokens' };
}
