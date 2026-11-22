import { draftMode } from 'next/headers';
import { NextResponse } from 'next/server';
import { requestOrigin, sanitizeRedirectPath } from '@/lib/preview';

export async function GET(request: Request) {
  draftMode().disable();
  const url = new URL(request.url);
  const path = sanitizeRedirectPath(url.searchParams.get('path'));
  return NextResponse.redirect(new URL(path, requestOrigin(request.headers, url.origin)));
}
