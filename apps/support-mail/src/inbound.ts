import { createHash, randomUUID } from 'node:crypto';
import { simpleParser, type AddressObject, type ParsedMail } from 'mailparser';
import type { PoolLike } from '@broker/money';
import {
  ATTACHMENT_MIME,
  buildAttachmentKey,
  buildRawMailKey,
  processInboundMail,
  recordInboundFailure,
  type AttachmentInput,
  type InboundMail,
  type InboundVerdict,
  type SupportSettings,
} from '@broker/support';

/**
 * Разбор сырого письма → `InboundMail` и обработка одного письма ящика.
 * Транспорт (IMAP) — в `imap.ts`; здесь — то, что проверяется без сервера.
 */

export interface ObjectStore {
  put(key: string, body: Buffer, contentType: string): Promise<void>;
}

function firstAddress(a: AddressObject | AddressObject[] | undefined): { address: string; name: string | null } {
  const list = Array.isArray(a) ? a : a ? [a] : [];
  const v = list.flatMap((x) => x.value)[0];
  return { address: v?.address ?? '', name: v?.name || null };
}

function allAddresses(...as: (AddressObject | AddressObject[] | undefined)[]): string[] {
  return as
    .flatMap((a) => (Array.isArray(a) ? a : a ? [a] : []))
    .flatMap((x) => x.value)
    .map((v) => v.address ?? '')
    .filter(Boolean);
}

function header(parsed: ParsedMail, name: string): string | null {
  const v = parsed.headers.get(name);
  if (v == null) return null;
  return typeof v === 'string' ? v : typeof v === 'object' && 'value' in (v as object) ? String((v as { value: unknown }).value) : String(v);
}

function refs(v: string | string[] | undefined): string[] {
  if (!v) return [];
  return (Array.isArray(v) ? v : v.split(/\s+/)).map((x) => x.trim()).filter(Boolean);
}

/** HTML → текст: разметка, скрипты, стили и картинки отбрасываются (ничего внешнего не грузится). */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h[1-6]|blockquote)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export interface ParsedInbound {
  mail: InboundMail;
  rawSha256: string;
}

/**
 * Сырое письмо → нормализованное. Вложения из закрытого перечня MIME и не
 * больше лимита настроек сохраняются в хранилище; прочие — только упоминание
 * в тексте (оператор видит, что было что-то ещё, — исходник в `.eml`).
 */
export async function parseInbound(
  raw: Buffer,
  meta: { mailbox: string; uid: number | null; uidValidity: number | null; tenant: string },
  settings: SupportSettings,
  store: ObjectStore | null,
  now = new Date(),
): Promise<ParsedInbound> {
  const parsed = await simpleParser(raw, { skipImageLinks: true, skipTextToHtml: true });
  const rawSha256 = createHash('sha256').update(raw).digest('hex');
  let rawObjectKey: string | null = null;
  if (store) {
    rawObjectKey = buildRawMailKey(meta.tenant, now);
    await store.put(rawObjectKey, raw, 'message/rfc822');
  }
  const notes: string[] = [];
  const attachments: AttachmentInput[] = [];
  for (const a of parsed.attachments ?? []) {
    const name = (a.filename || 'attachment').slice(0, 200);
    if (a.contentDisposition === 'inline' && !a.filename) continue;
    if (!ATTACHMENT_MIME.includes(a.contentType) || a.size > settings.attachments.maxBytes) {
      notes.push(`[вложение «${name}» (${a.contentType}, ${a.size} байт) не принято — тип или размер; исходник письма сохранён]`);
      continue;
    }
    if (!store) {
      notes.push(`[вложение «${name}» не сохранено: хранилище не настроено]`);
      continue;
    }
    const key = buildAttachmentKey(meta.tenant, 'mail', randomUUID());
    await store.put(key, a.content, a.contentType);
    attachments.push({
      objectKey: key,
      filename: name,
      mime: a.contentType,
      sizeBytes: a.size,
      sha256: createHash('sha256').update(a.content).digest('hex'),
    });
  }
  // HTML-письмо: mailparser сам строит текст; внешние картинки и разметка не хранятся.
  const body = parsed.text?.trim() ? parsed.text : typeof parsed.html === 'string' ? htmlToText(parsed.html) : '';
  const text = [body, ...notes].filter(Boolean).join('\n\n');
  return {
    rawSha256,
    mail: {
      messageId: parsed.messageId ?? null,
      inReplyTo: parsed.inReplyTo ?? null,
      references: refs(parsed.references),
      from: firstAddress(parsed.from),
      to: allAddresses(parsed.to, parsed.cc),
      subject: parsed.subject ?? null,
      text,
      date: parsed.date ?? null,
      autoSubmitted: header(parsed, 'auto-submitted'),
      precedence: header(parsed, 'precedence'),
      autoReplyHeader: parsed.headers.has('x-autoreply') || parsed.headers.has('x-autorespond'),
      listId: header(parsed, 'list-id'),
      mailbox: meta.mailbox,
      uid: meta.uid,
      uidValidity: meta.uidValidity,
      rawObjectKey,
      attachments,
      rawSha256,
    },
  };
}

export type HandleResult = { ok: true; verdict: InboundVerdict } | { ok: false; error: string };

/**
 * Одно письмо ящика: разобрать → обработать. Ошибка разбора/обработки →
 * запись `failed` для оператора; вызывающий переносит письмо в `Failed`.
 */
export async function handleRawMessage(
  db: PoolLike,
  raw: Buffer,
  meta: { mailbox: string; uid: number | null; uidValidity: number | null; tenant: string },
  ctx: { settings: SupportSettings; ownAddresses: string[]; store: ObjectStore | null },
): Promise<HandleResult> {
  let parsed: ParsedInbound | null = null;
  try {
    parsed = await parseInbound(raw, meta, ctx.settings, ctx.store);
    const verdict = await processInboundMail(db, parsed.mail, { settings: ctx.settings, ownAddresses: ctx.ownAddresses });
    return { ok: true, verdict };
  } catch (error) {
    const msg = (error as Error).message ?? String(error);
    const sha = parsed?.rawSha256 ?? createHash('sha256').update(raw).digest('hex');
    await recordInboundFailure(db, {
      mailbox: meta.mailbox,
      uid: meta.uid,
      uidValidity: meta.uidValidity,
      messageId: parsed?.mail.messageId ?? `<failed-${sha}@inbound>`,
      from: parsed?.mail.from.address ?? '',
      subject: parsed?.mail.subject ?? null,
      rawObjectKey: parsed?.mail.rawObjectKey ?? null,
      error: msg,
    }).catch(() => {});
    return { ok: false, error: msg };
  }
}
