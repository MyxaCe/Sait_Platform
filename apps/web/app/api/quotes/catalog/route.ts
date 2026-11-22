import { NextResponse } from 'next/server';
import { getMdsCatalog } from '@/lib/mds';

export const dynamic = 'force-dynamic';

export async function GET() {
  const catalog = await getMdsCatalog();

  return NextResponse.json(
    catalog.state === 'available'
      ? { state: 'available', symbols: [...catalog.symbols] }
      : { state: 'unavailable', reason: catalog.reason, symbols: [] },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
