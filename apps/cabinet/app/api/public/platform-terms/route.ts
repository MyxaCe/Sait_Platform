import { NextResponse } from 'next/server';
import { portfolioLeverage, publicPortfolios } from '@broker/live-params';
import { TERMINAL_INSTRUMENT_CLASS } from '@broker/money';
import { getLiveSnapshot } from '@/lib/live-params';

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
