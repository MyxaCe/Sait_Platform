import { randomUUID } from 'node:crypto';
import { appendJournalWithinTx, inTransaction, rollback, type PoolLike, type Queryable } from '@broker/money';
import { SUPPORT_ACTIONS, supportAccess } from './model';
import { parseSupportSettings, validateSettings, type SettingsError, type SupportSettings } from './settings';
import type { Actor } from './tickets';
import { sanitizeBody } from './text';

/** Администрирование поддержки: настройки, шаблоны, состояние почты. */

export type SaveSettingsResult = { ok: true } | { ok: false; reason: 'forbidden' | 'reasonRequired' | 'invalid'; errors?: SettingsError[] };

/**
 * Сохранить настройки: только admin, с основанием, в журнал «до/после»
 * (как денежные настройки платформы).
 */
export async function saveSupportSettings(
  db: PoolLike,
  actor: Actor,
  next: SupportSettings,
  reason: string,
): Promise<SaveSettingsResult> {
  if (!supportAccess.managesSettings(actor.role)) return { ok: false, reason: 'forbidden' };
  if (!reason.trim()) return { ok: false, reason: 'reasonRequired' };
  const errors = validateSettings(next);
  if (errors.length > 0) return { ok: false, reason: 'invalid', errors };
  return inTransaction<SaveSettingsResult>(db, async (tx) => {
    const cur = await tx.query(`SELECT settings FROM support_settings WHERE id = 1 FOR UPDATE`);
    const before = parseSupportSettings(cur.rows[0]?.settings ?? {});
    const entry = await appendJournalWithinTx(
      {
        operatorId: actor.operatorId,
        action: SUPPORT_ACTIONS.settingsUpdated,
        subjectKind: 'platform',
        subjectId: 'support:settings',
        payload: { before, after: next, basis: reason.trim() },
      },
      tx,
    );
    void entry;
    await tx.query(
      `INSERT INTO support_settings (id, settings, updated_at, updated_by, last_journal_seq)
       VALUES (1, $1, now(), $2, (SELECT max(seq) FROM admin_action_journal))
       ON CONFLICT (id) DO UPDATE SET settings = EXCLUDED.settings, updated_at = now(),
         updated_by = EXCLUDED.updated_by, last_journal_seq = EXCLUDED.last_journal_seq`,
      [JSON.stringify(next), actor.operatorId],
    );
    return { ok: true as const };
  });
}

export async function settingsMeta(db: Queryable): Promise<{ updatedAt: string | null; updatedByName: string | null }> {
  const r = await db.query(
    `SELECT s.updated_at, o.display_name FROM support_settings s LEFT JOIN operators o ON o.id = s.updated_by WHERE s.id = 1`,
  );
  const x = r.rows[0];
  return {
    updatedAt: x?.display_name ? new Date(x.updated_at as string).toISOString() : null,
    updatedByName: (x?.display_name as string | null) ?? null,
  };
}

/* ─── Шаблоны ответов ───────────────────────────────────────────────── */

export interface TemplateRow {
  id: string;
  key: string;
  locale: 'ru' | 'en';
  title: string;
  body: string;
  category: string | null;
  active: boolean;
  updatedAt: string;
  updatedByName: string | null;
}

export async function listTemplates(db: Queryable, opts: { activeOnly?: boolean; locale?: 'ru' | 'en' } = {}): Promise<TemplateRow[]> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (opts.activeOnly) where.push('t.active');
  if (opts.locale) {
    params.push(opts.locale);
    where.push(`t.locale = $${params.length}`);
  }
  const r = await db.query(
    `SELECT t.*, o.display_name FROM support_templates t LEFT JOIN operators o ON o.id = t.updated_by
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY t.active DESC, t.category NULLS LAST, t.title`,
    params,
  );
  return r.rows.map((x) => ({
    id: String(x.id),
    key: String(x.key),
    locale: x.locale === 'en' ? 'en' : 'ru',
    title: String(x.title),
    body: String(x.body),
    category: (x.category as string | null) ?? null,
    active: Boolean(x.active),
    updatedAt: new Date(x.updated_at as string).toISOString(),
    updatedByName: (x.display_name as string | null) ?? null,
  }));
}

export type TemplateResult = { ok: true; id: string } | { ok: false; reason: 'forbidden' | 'invalid' | 'duplicate' | 'notFound' };

const KEY = /^[a-z0-9][a-z0-9_.-]{0,63}$/;

export async function saveTemplate(
  db: PoolLike,
  actor: Actor,
  t: { id?: string | null; key: string; locale: 'ru' | 'en'; title: string; body: string; category?: string | null; active: boolean },
): Promise<TemplateResult> {
  if (!supportAccess.managesSettings(actor.role)) return { ok: false, reason: 'forbidden' };
  const body = sanitizeBody(t.body);
  const title = t.title.trim().slice(0, 120);
  if (!KEY.test(t.key) || !title || !body || (t.locale !== 'ru' && t.locale !== 'en')) return { ok: false, reason: 'invalid' };
  return inTransaction<TemplateResult>(db, async (tx) => {
    const dup = await tx.query(`SELECT id FROM support_templates WHERE key = $1 AND locale = $2`, [t.key, t.locale]);
    const dupId = dup.rows[0]?.id as string | undefined;
    if (dupId && dupId !== t.id) return rollback({ ok: false as const, reason: 'duplicate' as const });
    let id = t.id ?? null;
    if (id) {
      const u = await tx.query(
        `UPDATE support_templates SET key = $2, locale = $3, title = $4, body = $5, category = $6, active = $7,
           updated_by = $8, updated_at = now() WHERE id = $1 RETURNING id`,
        [id, t.key, t.locale, title, body, t.category || null, t.active, actor.operatorId],
      );
      if (!u.rows[0]) return rollback({ ok: false as const, reason: 'notFound' as const });
    } else {
      id = randomUUID();
      await tx.query(
        `INSERT INTO support_templates (id, key, locale, title, body, category, active, updated_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [id, t.key, t.locale, title, body, t.category || null, t.active, actor.operatorId],
      );
    }
    await appendJournalWithinTx(
      {
        operatorId: actor.operatorId,
        action: t.active ? SUPPORT_ACTIONS.templateSaved : SUPPORT_ACTIONS.templateDeactivated,
        subjectKind: 'support_template',
        subjectId: id,
        payload: { key: t.key, locale: t.locale, title, active: t.active },
      },
      tx,
    );
    return { ok: true as const, id };
  });
}

/* ─── Состояние почтового канала ────────────────────────────────────── */

export type MailChannelState =
  | { state: 'notConfigured'; missing: string[] }
  | { state: 'workerDown'; lastHeartbeatAt: string | null }
  | { state: 'ok'; mailbox: string | null; imap: boolean; lastInboundOkAt: string | null; lastOutboundOkAt: string | null; lastError: string | null; lastErrorAt: string | null };

/** Воркер считается живым, если отметился за последние 3 минуты. */
export async function readMailChannelState(db: Queryable, now = new Date()): Promise<MailChannelState & { queue: { queued: number; failed: number } }> {
  const [s, q] = await Promise.all([
    db.query(`SELECT * FROM support_mail_status WHERE id = 1`),
    db.query(
      `SELECT count(*) FILTER (WHERE status IN ('queued','sending'))::int AS queued,
              count(*) FILTER (WHERE status = 'failed')::int AS failed FROM outbound_mail`,
    ),
  ]);
  const queue = { queued: Number(q.rows[0]?.queued ?? 0), failed: Number(q.rows[0]?.failed ?? 0) };
  const x = s.rows[0];
  const iso = (v: unknown) => (v == null ? null : new Date(v as string).toISOString());
  if (!x || !x.last_heartbeat_at) {
    return { state: 'workerDown', lastHeartbeatAt: null, queue };
  }
  if (!x.smtp_configured) return { state: 'notConfigured', missing: (x.missing_env as string[]) ?? [], queue };
  if (now.getTime() - new Date(x.last_heartbeat_at as string).getTime() > 3 * 60_000) {
    return { state: 'workerDown', lastHeartbeatAt: iso(x.last_heartbeat_at), queue };
  }
  return {
    state: 'ok',
    mailbox: (x.mailbox as string | null) ?? null,
    imap: Boolean(x.imap_configured),
    lastInboundOkAt: iso(x.last_inbound_ok_at),
    lastOutboundOkAt: iso(x.last_outbound_ok_at),
    lastError: (x.last_error as string | null) ?? null,
    lastErrorAt: iso(x.last_error_at),
    queue,
  };
}

/** Отметка воркера (heartbeat + конфиг без секретов). */
export async function writeMailHeartbeat(
  db: Queryable,
  s: { smtp: boolean; imap: boolean; missing: string[]; mailbox: string | null },
): Promise<void> {
  await db.query(
    `INSERT INTO support_mail_status (id, smtp_configured, imap_configured, missing_env, mailbox, last_heartbeat_at)
     VALUES (1, $1, $2, $3, $4, now())
     ON CONFLICT (id) DO UPDATE SET smtp_configured = $1, imap_configured = $2, missing_env = $3, mailbox = $4,
       last_heartbeat_at = now()`,
    [s.smtp, s.imap, s.missing, s.mailbox],
  );
}

export async function writeMailEvent(db: Queryable, kind: 'inboundOk' | 'outboundOk' | 'error', error?: string): Promise<void> {
  const set =
    kind === 'inboundOk'
      ? 'last_inbound_ok_at = now()'
      : kind === 'outboundOk'
        ? 'last_outbound_ok_at = now()'
        : 'last_error = $1, last_error_at = now()';
  await db.query(
    `INSERT INTO support_mail_status (id) VALUES (1) ON CONFLICT (id) DO NOTHING`,
  );
  await db.query(`UPDATE support_mail_status SET ${set} WHERE id = 1`, kind === 'error' ? [(error ?? '').slice(0, 500)] : []);
}

/** Просмотр вложения оператором — в журнал (комплаенс: кто открывал файлы клиента). */
export async function recordAttachmentView(db: PoolLike, actor: Actor, a: { ticketId: string; attachmentId: string }): Promise<void> {
  await inTransaction(db, async (tx) => {
    await appendJournalWithinTx(
      {
        operatorId: actor.operatorId,
        action: SUPPORT_ACTIONS.attachmentViewed,
        subjectKind: 'support_ticket',
        subjectId: a.ticketId,
        payload: { attachmentId: a.attachmentId },
      },
      tx,
    );
  });
}

export async function findAttachmentForOperator(
  db: Queryable,
  actor: Actor,
  attachmentId: string,
): Promise<{ ticketId: string; objectKey: string; filename: string; mime: string } | null> {
  if (!supportAccess.worksTickets(actor.role) || !/^[0-9a-f-]{36}$/i.test(attachmentId)) return null;
  const r = await db.query(
    `SELECT a.ticket_id, a.object_key, a.filename, a.mime, t.assignee_operator_id
       FROM support_attachments a JOIN support_tickets t ON t.id = a.ticket_id WHERE a.id = $1`,
    [attachmentId],
  );
  const a = r.rows[0];
  if (!a) return null;
  if (!supportAccess.seesWholeQueue(actor.role) && a.assignee_operator_id !== actor.operatorId) return null;
  return { ticketId: String(a.ticket_id), objectKey: String(a.object_key), filename: String(a.filename), mime: String(a.mime) };
}
