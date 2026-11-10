import { createHash, randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { putObject } from '@broker/storage';
import {
  ATTACHMENT_MIME,
  buildPendingAttachmentKey,
  loadSupportSettings,
  postClientChatMessage,
  type AttachmentInput,
} from '@broker/support';
import { requireTenantSlug } from '@broker/tenant';
import { getSessionUser } from '@/lib/auth/session';
import { getPool } from '@/lib/db';
import { loadWidgetState, sameOrigin, supportPool } from '@/lib/support/state';

/**
 * Чат поддержки кабинета. GET — состояние (опрос раз в 4 с, пока панель
 * открыта); POST — сообщение клиента (multipart: body + необязательный файл).
 * Только для вошедших: личность — из сессии, не из запроса. Route handler, а
 * не server action: у server actions лимит тела 1 МБ, а вложение — до лимита
 * из настроек.
 */
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const ticket = new URL(req.url).searchParams.get('ticket');
  return NextResponse.json(await loadWidgetState(user, ticket), { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(req: Request) {
  if (!sameOrigin(req)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  let fd: FormData;
  try {
    fd = await req.formData();
  } catch {
    return NextResponse.json({ error: 'invalidRequest' }, { status: 400 });
  }
  const settings = await loadSupportSettings(getPool());
  const body = String(fd.get('body') ?? '');
  const file = fd.get('file');
  const attachments: AttachmentInput[] = [];
  if (file instanceof File && file.size > 0) {
    if (!ATTACHMENT_MIME.includes(file.type)) return NextResponse.json({ error: 'unsupportedFormat' }, { status: 422 });
    if (file.size > settings.attachments.maxBytes) return NextResponse.json({ error: 'fileTooLarge' }, { status: 422 });
    const bytes = Buffer.from(await file.arrayBuffer());
    let key: string;
    try {
      const tenant = requireTenantSlug(process.env.SITE_SLUG, 'вложение в чат поддержки');
      key = buildPendingAttachmentKey(tenant, user.id, randomUUID());
      await putObject({ key, body: bytes, contentType: file.type });
    } catch {
      // Хранилище не настроено — файл не принимаем (fail-closed); текст — да.
      return NextResponse.json({ error: 'attachmentsUnavailable' }, { status: 503 });
    }
    attachments.push({
      objectKey: key,
      filename: file.name.slice(0, 200) || 'file',
      mime: file.type,
      sizeBytes: file.size,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    });
  }
  const r = await postClientChatMessage(supportPool(), settings, { userId: user.id, body, attachments });
  if (!r.ok) return NextResponse.json({ error: r.reason }, { status: r.reason === 'rateLimited' ? 429 : 422 });
  return NextResponse.json(await loadWidgetState(user, r.ticketId));
}
