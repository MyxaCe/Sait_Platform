import { NextResponse } from 'next/server';
import { pingDatabase } from '@/lib/leads/store';

export const dynamic = 'force-dynamic';

export async function GET() {
  const database = await pingDatabase();
  const ready = database !== 'failed';
  return NextResponse.json(
    { status: ready ? 'ready' : 'degraded', checks: { database } },
    { status: ready ? 200 : 503 },
  );
}
