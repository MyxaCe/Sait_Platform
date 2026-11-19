import { NextResponse } from 'next/server';
import { countAwaitingOperator } from '@broker/support';
import { getPool } from '@/lib/db';
import { supportActor } from '@/lib/support/runtime';

export const dynamic = 'force-dynamic';

export async function GET() {
  const actor = await supportActor();
  if (!actor) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  try {
    const count = await countAwaitingOperator(getPool(), actor);
    return NextResponse.json({ count }, { headers: { 'cache-control': 'no-store' } });
  } catch {
    return NextResponse.json({ error: 'unavailable' }, { status: 503 });
  }
}
