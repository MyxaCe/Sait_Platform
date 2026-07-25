import { NextResponse } from 'next/server';
import { pingDatabase } from '@/lib/db';

/** Liveness + readiness кабинета (env/время → обязателен force-dynamic, урок B-010). */
export const dynamic = 'force-dynamic';

export async function GET() {
  const db = await pingDatabase();
  return NextResponse.json(
    { status: db === 'ok' ? 'ok' : 'degraded', service: 'cabinet', db, time: new Date().toISOString() },
    { status: db === 'ok' ? 200 : 503 },
  );
}
