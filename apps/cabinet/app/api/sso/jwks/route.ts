import { NextResponse } from 'next/server';
import { isSsoConfigured, publicJwks } from '@/lib/sso/jwt';

/**
 * JWKS для валидации handoff-токенов терминалом.
 * Публичный по определению (только публичный ключ).
 */
export const dynamic = 'force-dynamic';

export async function GET() {
  if (!isSsoConfigured()) {
    return NextResponse.json({ error: 'sso_not_configured' }, { status: 503 });
  }
  return NextResponse.json(await publicJwks(), {
    headers: { 'Cache-Control': 'public, max-age=3600' },
  });
}
