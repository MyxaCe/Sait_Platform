import {
  parseCabinetHomeModules,
  promotionsResponseSchema,
  type CabinetHomeModule,
} from '@broker/api-client';
import { cmsGet } from './chrome';
import { getPool } from './db';
import {
  getTenantConfig,
  isSymbolAllowed,
  type TenantAccessUnavailableReason,
} from './tenant';

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

/** Каталог MDS для модуля «Рынки» (server-side). */
export interface MarketInstrument {
  symbol: string;
  name: string;
  digits: number;
  /** Абсолютный URL иконки монеты (браузерный origin MDS) либо null */
  icon: string | null;
}

/**
 * Почему модуль «Рынки» ничего не показывает. Раньше ответом был пустой
 * массив на ВСЕ причины сразу, и модуль по нему просто исчезал со
 * страницы — отказ, выглядящий как отсутствие функции (Р-025, п. 3).
 *
 * Четыре исхода, и ни один не сводится к другому:
 *
 *   ok                  — каталог получен и отфильтрован доступом. Пустой
 *                         `instruments` здесь значит «доступ есть, но ни
 *                         один разрешённый символ MDS не котирует» — это
 *                         тоже отдельная причина, и её видно по
 *                         `instruments.length === 0`;
 *   access-empty        — allow-list получен и пуст: владелец ещё не выбрал
 *                         инструменты в CMS. Настройка, не поломка;
 *   access-unavailable  — allow-list получить не удалось. Граница закрыта
 *                         fail-closed, чинится не там, где `access-empty`;
 *   catalog-unavailable — граница открыта, но каталог MDS недоступен.
 */
export type MarketsData =
  | { state: 'ok'; instruments: MarketInstrument[] }
  | { state: 'access-empty' }
  | { state: 'access-unavailable'; reason: TenantAccessUnavailableReason }
  | { state: 'catalog-unavailable'; reason: 'not-configured' | 'http-error' | 'network' };

/**
 * Порядок вердиктов — от сильного знания к слабому, как в §5г
 * КОНТРАКТЫ.md: сначала граница доступа, потом каталог. Если граница
 * закрыта, состояние MDS на исход не влияет вовсе и называть его причиной
 * было бы враньём: показывать нечего не потому, что нет котировок, а
 * потому, что ничего не разрешено.
 */
export async function getMarketInstruments(): Promise<MarketsData> {
  const access = (await getTenantConfig()).access;
  if (access.state === 'empty') return { state: 'access-empty' };
  if (access.state === 'unavailable') {
    return { state: 'access-unavailable', reason: access.reason };
  }

  const url = process.env.MDS_HTTP_URL;
  if (!url) return { state: 'catalog-unavailable', reason: 'not-configured' };
  // Иконки грузит браузер — база должна быть браузерным origin MDS
  const iconBase = process.env.NEXT_PUBLIC_WS_URL?.replace(/\/$/, '');
  try {
    const res = await fetch(`${url.replace(/\/$/, '')}/v1/instruments`, {
      next: { revalidate: 300 },
      signal: AbortSignal.timeout(2_000),
    });
    if (!res.ok) return { state: 'catalog-unavailable', reason: 'http-error' };
    const data = (await res.json()) as { items?: (MarketInstrument & { icon?: string | null })[] };
    return {
      state: 'ok',
      instruments: (data.items ?? [])
        .filter((i) => isSymbolAllowed(access, i.symbol))
        .map((i) => ({
          symbol: i.symbol,
          name: i.name,
          digits: i.digits,
          icon: iconBase && i.icon ? `${iconBase}${i.icon}` : null,
        })),
    };
  } catch {
    return { state: 'catalog-unavailable', reason: 'network' };
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
