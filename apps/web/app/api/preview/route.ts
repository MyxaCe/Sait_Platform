import { draftMode } from 'next/headers';
import { NextResponse } from 'next/server';
import { requestOrigin, sanitizeRedirectPath } from '@/lib/preview';

/**
 * Вход в preview: CMS даёт редактору ссылку
 * /api/preview?secret=<PREVIEW_SECRET>&path=/promotions
 * draftMode-кука включает обход кеша в getCms (черновой контент)
 * и noindex на страницах.
 */
export async function GET(request: Request) {
  const secret = process.env.PREVIEW_SECRET;
  if (!secret) {
    return NextResponse.json({ error: 'preview_not_configured' }, { status: 503 });
  }

  const url = new URL(request.url);
  if (url.searchParams.get('secret') !== secret) {
    return NextResponse.json({ error: 'invalid_secret' }, { status: 401 });
  }

  draftMode().enable();
  const path = sanitizeRedirectPath(url.searchParams.get('path'));
  return NextResponse.redirect(new URL(path, requestOrigin(request.headers, url.origin)));
}
