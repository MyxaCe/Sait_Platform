import { NextResponse } from 'next/server';

// GET-хендлер без динамических API Next пререндерит статически на билде —
// health-проба обязана выполняться на каждый запрос (баг B-010)
export const dynamic = 'force-dynamic';

/** Liveness: процесс жив. Паттерн платформы (у CRM — /health). */
export async function GET() {
  return NextResponse.json({
    status: 'ok',
    service: 'site-web',
    time: new Date().toISOString(),
  });
}
