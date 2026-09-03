import { NextResponse } from 'next/server';
import { pingDatabase } from '@/lib/db';
import { configFingerprint, instanceIdentity } from '@/lib/instance';

/** Liveness + readiness кабинета (env/время → обязателен force-dynamic, урок B-010). */
export const dynamic = 'force-dynamic';

/**
 * `instance` и `config` добавлены по B-019: `service` называет приложение, и
 * два экземпляра с разной конфигурацией по ответу были неотличимы. `config` —
 * отпечаток (какие переменные заданы), а не значения: ручка не место утечки.
 */
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
