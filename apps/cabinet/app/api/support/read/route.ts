import { NextResponse } from 'next/server';
import { markClientRead } from '@broker/support';
import { getSessionUser } from '@/lib/auth/session';
import { getPool } from '@/lib/db';
import { sameOrigin } from '@/lib/support/state';

/** Клиент открыл переписку — ответы поддержки прочитаны (бейдж гаснет). */
export async function POST(req: Request) {
  if (!sameOrigin(req)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { ticketId } = (await req.json().catch(() => ({}))) as { ticketId?: string };
  if (typeof ticketId !== 'string' || !/^[0-9a-f-]{36}$/i.test(ticketId)) {
    return NextResponse.json({ error: 'invalidRequest' }, { status: 400 });
  }
  await markClientRead(getPool(), user.id, ticketId);
  return NextResponse.json({ ok: true });
}
