import { NextResponse } from 'next/server';
import { rateTicket } from '@broker/support';
import { getSessionUser } from '@/lib/auth/session';
import { getPool } from '@/lib/db';
import { loadWidgetState, sameOrigin } from '@/lib/support/state';

/** Оценка 1–5 после «решено» — один раз, только своего обращения. */
export async function POST(req: Request) {
  if (!sameOrigin(req)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const b = (await req.json().catch(() => ({}))) as { ticketId?: string; score?: number; comment?: string };
  const r = await rateTicket(getPool(), {
    userId: user.id,
    ticketId: String(b.ticketId ?? ''),
    score: Number(b.score),
    comment: typeof b.comment === 'string' ? b.comment : null,
  });
  if (!r.ok) return NextResponse.json({ error: r.reason }, { status: 422 });
  return NextResponse.json(await loadWidgetState(user, String(b.ticketId)));
}
