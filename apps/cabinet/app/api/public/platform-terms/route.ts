import { NextResponse } from 'next/server';
import { readAccountTypeTerms, type Queryable } from '@broker/money';
import { readPromoSettings } from '@broker/promo';
import { getPool } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const db = getPool() as unknown as Queryable;
    const [settings, accountTypes] = await Promise.all([readPromoSettings(db), readAccountTypeTerms(db)]);
    return NextResponse.json(
      {
        attributionWindowDays: settings?.attributionWindowDays ?? null,
        promotionsEnabled: settings?.promotionsEnabled ?? false,
        accountTypes,
      },
      { headers: { 'Cache-Control': 'public, max-age=60' } },
    );
  } catch (error) {
    console.error('[platform-terms] не прочитано', error);
    return NextResponse.json({ error: 'unavailable' }, { status: 503 });
  }
}
