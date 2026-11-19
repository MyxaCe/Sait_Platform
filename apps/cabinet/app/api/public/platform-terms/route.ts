import { NextResponse } from 'next/server';
import { portfolioLeverage, publicPortfolios } from '@broker/live-params';
import { TERMINAL_INSTRUMENT_CLASS } from '@broker/money';
import { getLiveSnapshot } from '@/lib/live-params';

/**
 * Публичные условия платформы — для витрины (у неё нет базы):
 *  - срок first-click атрибуции (max-age cookie `bp_ref`/`bp_promo`);
 *  - флаг «акции выключены»;
 *  - условия типов счетов для /accounts — только из админки (решение
 *    владельца №9);
 *  - `live` — снимок живых параметров (деньги, портфели, поддержка,
 *    акции): по нему витрина подставляет `{{…}}` в тексты CMS.
 *
 * Только чтение, без персональных данных, одним запросом с кэшем до 60 с.
 * Сбой базы — 503, витрина живёт без этих данных и показывает «—».
 */
export const dynamic = 'force-dynamic';

export async function GET() {
  const live = await getLiveSnapshot();
  if (!live) return NextResponse.json({ error: 'unavailable' }, { status: 503 });
  const accountTypes = (publicPortfolios(live) ?? []).map((p) => ({
    key: p.key,
    title: p.title,
    isDefault: p.isDefault,
    sortOrder: p.sortOrder,
    leverage: portfolioLeverage(p, TERMINAL_INSTRUMENT_CLASS),
    baseLeverage: p.baseLeverage,
    classOverrides: p.classOverrides,
    markupBps: p.markupBps,
    commissionBps: p.commissionBps,
    instruments: p.instruments,
    description: p.description,
  }));
  return NextResponse.json(
    {
      attributionWindowDays: live.promo?.attributionWindowDays ?? null,
      promotionsEnabled: live.promo?.enabled ?? false,
      accountTypes,
      live,
    },
    { headers: { 'Cache-Control': 'public, max-age=60' } },
  );
}
