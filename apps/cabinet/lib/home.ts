import {
  parseCabinetHomeModules,
  promotionsResponseSchema,
  type CabinetHomeModule,
} from '@broker/api-client';
import { cmsGet } from './chrome';
import { getPool } from './db';

/**
 * Данные модульной главной ЛК (ADR-026).
 * Конфиг модулей — из CMS (cabinet-home); CMS недоступна → дефолт
 * «всё включено» (главная живёт без CMS, просто без кастомизации).
 */

export const DEFAULT_MODULES: CabinetHomeModule[] = [
  { type: 'profile', enabled: true },
  { type: 'onboarding', enabled: true, steps: { verification: true, deposit: true, firstTrade: true } },
  { type: 'balance', enabled: true, buttons: { deposit: true, withdraw: true, buyFiat: true } },
  {
    type: 'markets',
    enabled: true,
    tabs: { assets: true, popular: true, newListing: true, favorites: false, gainers: true, volume: false },
    newListingSymbols: [],
  },
  { type: 'promotions', enabled: true },
];

export async function getHomeModules(locale: string): Promise<CabinetHomeModule[]> {
  const data = await cmsGet('cabinet-home', locale);
  if (!data) return DEFAULT_MODULES;
  const modules = parseCabinetHomeModules(data);
  return modules.length > 0 ? modules : DEFAULT_MODULES;
}

export interface PromoItem {
  id: string;
  badge: string;
  title: string;
  description: string;
  ctaLabel: string;
  ctaHref: string;
  featured: boolean;
}

export async function getPromotions(locale: string): Promise<PromoItem[]> {
  const data = await cmsGet('promotions', locale);
  const parsed = promotionsResponseSchema.safeParse(data);
  return parsed.success ? parsed.data.items : [];
}

/** Каталог MDS для модуля «Рынки» (server-side; MDS недоступен → пусто). */
export interface MarketInstrument {
  symbol: string;
  name: string;
  digits: number;
  /** Абсолютный URL иконки монеты (браузерный origin MDS) либо null */
  icon: string | null;
}

export async function getMarketInstruments(): Promise<MarketInstrument[]> {
  const url = process.env.MDS_HTTP_URL;
  if (!url) return [];
  // Иконки грузит браузер — база должна быть браузерным origin MDS
  const iconBase = process.env.NEXT_PUBLIC_WS_URL?.replace(/\/$/, '');
  try {
    const res = await fetch(`${url.replace(/\/$/, '')}/v1/instruments`, {
      next: { revalidate: 300 },
      signal: AbortSignal.timeout(2_000),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { items?: (MarketInstrument & { icon?: string | null })[] };
    return (data.items ?? []).map((i) => ({
      symbol: i.symbol,
      name: i.name,
      digits: i.digits,
      icon: iconBase && i.icon ? `${iconBase}${i.icon}` : null,
    }));
  } catch {
    return [];
  }
}

/** Статус верификации для онбординга: по документам пользователя. */
export type VerificationStatus = 'none' | 'pending' | 'approved';

export async function getVerificationStatus(userId: string): Promise<VerificationStatus> {
  const r = await getPool().query(
    `SELECT status FROM documents WHERE user_id = $1 AND kind = 'identity'
      ORDER BY created_at DESC LIMIT 1`,
    [userId],
  );
  const status = r.rows[0]?.status as string | undefined;
  if (status === 'approved') return 'approved';
  if (status === 'uploaded') return 'pending';
  return 'none';
}
