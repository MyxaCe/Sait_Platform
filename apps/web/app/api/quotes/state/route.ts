import { NextResponse } from 'next/server';
import { getMdsQuotesState } from '@/lib/mds';

export const dynamic = 'force-dynamic';

export async function GET() {
  const outcome = await getMdsQuotesState();

  return NextResponse.json(
    outcome.state === 'available'
      ? {
          state: 'available',
          unavailable: outcome.quotes.unavailable,
          missing: outcome.quotes.missing,
        }
      : { state: 'unavailable', reason: outcome.reason, unavailable: [], missing: [] },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
