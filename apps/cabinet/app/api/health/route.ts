import { NextResponse } from 'next/server';
import { pingDatabase } from '@/lib/db';
import { configFingerprint, instanceIdentity } from '@/lib/instance';

export const dynamic = 'force-dynamic';

export async function GET() {
  const db = await pingDatabase();
  return NextResponse.json(
    {
      status: db === 'ok' ? 'ok' : 'degraded',
      service: 'cabinet',
      db,
      instance: instanceIdentity(),
      config: configFingerprint(),
      time: new Date().toISOString(),
    },
    { status: db === 'ok' ? 200 : 503 },
  );
}
