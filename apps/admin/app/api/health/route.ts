import { NextResponse } from 'next/server';

/** Liveness центра управления. Публичный путь (гейт его не трогает). */
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
