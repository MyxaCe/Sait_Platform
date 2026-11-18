import MailComposer from 'nodemailer/lib/mail-composer';
import type { Queryable } from '@broker/money';
import {
  AUTH_MAIL_PURPOSES,
  claimDueMail,
  markMailFailed,
  markMailSent,
  SECRET_BODY_PURPOSES,
  SYSTEM_MAIL_PURPOSES,
  writeMailEvent,
  type ClaimedMail,
  type MailPurpose,
} from '@broker/support';

export interface RawTransport {
  send(raw: Buffer, envelope: { from: string; to: string[] }): Promise<{ response: string }>;
}

export interface SentCopy {
  append(raw: Buffer): Promise<void>;
}

export interface SenderDeps {
  db: Queryable;
  transport: RawTransport;
  sentCopy?: SentCopy | null;
  from: { address: string; name: string };
  domain: string;
  perHour: number;
  supportEmailEnabled: boolean;
  log?: (msg: string) => void;
}

function autoSubmitted(purpose: MailPurpose): string | undefined {
  if (purpose === 'support_ack') return 'auto-replied';
  if (SYSTEM_MAIL_PURPOSES.includes(purpose)) return 'auto-generated';
  return undefined;
}

export async function composeRaw(m: ClaimedMail, from: { address: string; name: string }): Promise<Buffer> {
  const headers: Record<string, string> = {};
  const as = autoSubmitted(m.purpose);
  if (as) headers['Auto-Submitted'] = as;
  const composer = new MailComposer({
    from: { name: from.name, address: from.address },
    to: m.to,
    replyTo: from.address,
    subject: m.subject,
    text: m.bodyText,
    messageId: m.rfcMessageId,
    inReplyTo: m.inReplyTo ?? undefined,
    references: m.references.length ? m.references : undefined,
    headers,
    date: new Date(),
  });
  return composer.compile().build();
}

export function isPermanent(error: unknown): boolean {
  const code = (error as { responseCode?: unknown })?.responseCode;
  return typeof code === 'number' && code >= 500 && code < 600 && code !== 552;
}

export async function sendTick(deps: SenderDeps): Promise<{ sent: number; failed: number; retry: number; throttled: boolean }> {
  const out = { sent: 0, failed: 0, retry: 0, throttled: false };
  const used = await deps.db.query(
    `SELECT count(*)::int AS n FROM outbound_mail WHERE sent_at > now() - interval '1 hour'`,
  );
  const room = deps.perHour - Number(used.rows[0]?.n ?? 0);
  if (room <= 0) {
    out.throttled = true;
    return out;
  }
  const purposes: MailPurpose[] = deps.supportEmailEnabled
    ? [...SYSTEM_MAIL_PURPOSES, 'support_reply', 'support_ack']
    : [...SYSTEM_MAIL_PURPOSES];
  const batch = await claimDueMail(deps.db, { limit: Math.min(room, 10), domain: deps.domain, purposes });
  for (const m of batch) {
    let raw: Buffer;
    try {
      raw = await composeRaw(m, deps.from);
      const r = await deps.transport.send(raw, { from: deps.from.address, to: [m.to] });
      await markMailSent(deps.db, m.id, m.purpose, r.response);
      out.sent++;
      await writeMailEvent(deps.db, 'outboundOk');
    } catch (error) {
      const msg = (error as Error).message ?? String(error);
      const res = await markMailFailed(deps.db, m, msg, { permanent: isPermanent(error) });
      if (res === 'failed') out.failed++;
      else out.retry++;
      await writeMailEvent(deps.db, 'error', `SMTP: ${msg}`);
      deps.log?.(`письмо ${m.id} (${m.purpose}) не ушло: ${msg} → ${res}`);
      continue;
    }
    if (deps.sentCopy && !SECRET_BODY_PURPOSES.includes(m.purpose) && !AUTH_MAIL_PURPOSES.includes(m.purpose)) {
      await deps.sentCopy.append(raw).catch((e: Error) => deps.log?.(`копия в Sent не легла: ${e.message}`));
    }
  }
  return out;
}
