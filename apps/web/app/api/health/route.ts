import { NextResponse } from 'next/server';
import { configFingerprint, instanceIdentity } from '@/lib/instance';

// GET-хендлер без динамических API Next пререндерит статически на билде —
// health-проба обязана выполняться на каждый запрос (баг B-010)
export const dynamic = 'force-dynamic';

/**
 * Liveness: процесс жив. Паттерн платформы (у CRM — /health).
 *
 * `instance` и `config` добавлены по B-019: `service` называет приложение, и
 * два экземпляра с разной конфигурацией по ответу были неотличимы. `config` —
 * отпечаток (какие переменные заданы), а не значения: ручка не место утечки.
 */
export async function GET() {
  return NextResponse.json({
    status: 'ok',
    service: 'site-web',
    instance: instanceIdentity(),
    config: configFingerprint(),
    time: new Date().toISOString(),
  });
}
