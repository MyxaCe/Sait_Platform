import { NextResponse } from 'next/server';
import { issueViewUrl } from '@broker/storage';
import { findClientAttachment } from '@broker/support';
import { getSessionUser } from '@/lib/auth/session';
import { getPool } from '@/lib/db';

/** Вложение своего обращения — короткоживущая подписанная ссылка (не прокси байтов). */
export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const a = await findClientAttachment(getPool(), user.id, params.id);
  if (!a) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  try {
    return NextResponse.redirect(await issueViewUrl(a.objectKey), 302);
  } catch {
    return NextResponse.json({ error: 'storage_unavailable' }, { status: 503 });
  }
}
