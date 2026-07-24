import { NextResponse } from 'next/server';
import { pingDatabase } from '@/lib/leads/store';

// См. B-010: без force-dynamic ответ замораживается на билде
export const dynamic = 'force-dynamic';

/**
 * Readiness: готовность принимать трафик. Проверяет СВОЮ БД (failure
 * domain сайта). Соседи (CMS, шина) сюда сознательно НЕ входят —
 * сайт обязан работать при их недоступности (§3 брифа платформы).
 */
export async function GET() {
  const database = await pingDatabase();
  const ready = database !== 'failed';
  return NextResponse.json(
    { status: ready ? 'ready' : 'degraded', checks: { database } },
    { status: ready ? 200 : 503 },
  );
}
