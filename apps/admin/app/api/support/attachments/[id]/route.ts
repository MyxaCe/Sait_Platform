import { NextResponse } from 'next/server';
import { issueViewUrl } from '@broker/storage';
import { findAttachmentForOperator, recordAttachmentView } from '@broker/support';
import { getPool } from '@/lib/db';
import { supportActor, supportPool } from '@/lib/support/runtime';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const actor = await supportActor();
  if (!actor) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const a = await findAttachmentForOperator(getPool(), actor, params.id);
  if (!a) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  let url: string;
  try {
    url = await issueViewUrl(a.objectKey);
  } catch {
    return NextResponse.json({ error: 'storage_unavailable' }, { status: 503 });
  }
  await recordAttachmentView(supportPool(), actor, { ticketId: a.ticketId, attachmentId: params.id });
  return NextResponse.redirect(url, 302);
}
