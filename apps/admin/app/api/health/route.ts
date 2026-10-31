import { NextResponse } from 'next/server';

/**
 * Liveness центра управления. Единственный ПУБЛИЧНЫЙ `/api`-роут — он в явном
 * allowlist гейта (`API_PUBLIC_PATHS`, Р-451). Остальной `/api` закрыт
 * default-deny. Секретов не отдаёт: только отпечаток готовности гейта.
 */
export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json(
    {
      status: 'ok',
      service: 'admin',
      // Готов ли гейт закрываться по-настоящему: без секрета сессии невалидны
      // (fail-closed, Р-394). Это отпечаток готовности, а не значение секрета.
      sessionSecret: process.env.ADMIN_SESSION_SECRET ? 'set' : 'unset',
      time: new Date().toISOString(),
    },
    { status: 200 },
  );
}
