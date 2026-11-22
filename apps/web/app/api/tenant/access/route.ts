import { NextResponse } from 'next/server';
import { accessNotice, getTenantAccess } from '@/lib/tenant';

export const dynamic = 'force-dynamic';

export async function GET() {
  const access = await getTenantAccess();
  const notice = accessNotice(access);

  return NextResponse.json(
    {
      state: access.state,
      reason: access.state === 'unavailable' ? access.reason : undefined,
      symbols: access.state === 'allowed' ? [...access.symbols] : [],
      notice,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
