import { NextResponse } from 'next/server';

/** Liveness: процесс жив. Паттерн платформы (у CRM — /health). */
export async function GET() {
  return NextResponse.json({
    status: 'ok',
    service: 'site-web',
    time: new Date().toISOString(),
  });
}
