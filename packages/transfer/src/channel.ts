import type { KeyObject } from 'node:crypto';
import { inTransaction, rollback, type PoolLike, type Queryable } from '@broker/money';
import { TRANSFER_ACTIONS, TRANSFER_SYSTEM_OPERATOR, journal } from './common';
import {
  MAX_CLOCK_SKEW_MS,
  MESSAGES_PATH,
  PROTOCOL_VERSION,
  canonicalSha256,
  newNonce,
  parseSignedMessage,
  sha256Hex,
  signEnvelope,
  verifyEnvelope,
  type Envelope,
  type MessageKind,
} from './envelope';
import { STATUS_EVENTS, dedupeKey, type PackageData, type RevokeData, type StatusData } from './messages';
import { getGroupPlatform } from './registry';
import {
  applyTargetStatusWithinTx,
  markPackageDeliveredWithinTx,
  markPackageRefusedWithinTx,
  noteDeliveryErrorWithinTx,
} from './source';
import { receivePackageWithinTx, receiveRevokeWithinTx } from './target';

/**
 * Межплатформенный канал: доставка из outbox и приём.
 *
 * Отправка: сообщение берётся из `platform_transfer_outbox` (`FOR UPDATE SKIP
 * LOCKED` — две реплики не возьмут одно), подписывается ключом платформы
 * со свежими `nonce`/`issuedAt` и уходит POST на внутренний адрес цели из
 * реестра. 2xx — доставлено; 4xx (кроме 409/429) — окончательный отказ
 * (неверная подпись, запрещённое направление); сеть/5xx — повтор с
 * нарастающей паузой (15 с · 2^n, не больше 30 мин), после 20 попыток —
 * `failed` (видно в «Переводах клиентов», есть «Повторить доставку»).
 *
 * Приём: строгая форма → получатель = мы → отправитель в реестре с ключом →
 * подпись → окно времени → одноразовый nonce → обработка, всё в одной
 * транзакции. Повтор того же факта (новый nonce, тот же transferId+тип+
 * событие) — «дубликат», 200.
 */

export const MAX_DELIVERY_ATTEMPTS = 20;

export function deliveryBackoffMs(attempts: number): number {
  return Math.min(30 * 60_000, 15_000 * 2 ** Math.max(0, attempts - 1));
}

export interface HttpResponseLike {
  status: number;
  text(): Promise<string>;
}
export type FetchLike = (url: string, init: { method: 'POST'; headers: Record<string, string>; body: string; signal?: AbortSignal }) => Promise<HttpResponseLike>;

export interface DeliveryDeps {
  selfSlug: string;
  signingKey: KeyObject | null;
  fetch: FetchLike;
  now?: () => Date;
  timeoutMs?: number;
  limit?: number;
  log?: (msg: string) => void;
}

interface Claimed {
  id: string;
  transferId: string;
  to: string;
  kind: MessageKind;
  data: unknown;
  attempts: number;
}

async function claimDue(pool: PoolLike, limit: number, now: Date): Promise<Claimed[]> {
  return inTransaction(pool, async (tx) => {
    const r = await tx.query(
      `UPDATE platform_transfer_outbox o SET state = 'sending', locked_at = $1, attempts = o.attempts + 1
        WHERE o.id IN (
          SELECT id FROM platform_transfer_outbox
           WHERE (state = 'queued' AND next_attempt_at <= $1)
              OR (state = 'sending' AND locked_at < $1::timestamptz - interval '5 minutes')
           ORDER BY next_attempt_at
           LIMIT $2
           FOR UPDATE SKIP LOCKED)
        RETURNING o.id, o.transfer_id, o.to_platform, o.kind, o.data, o.attempts`,
      [now, limit],
    );
    return r.rows.map((x) => ({
      id: String(x.id),
      transferId: String(x.transfer_id),
      to: String(x.to_platform),
      kind: x.kind as MessageKind,
      data: typeof x.data === 'string' ? JSON.parse(x.data) : x.data,
      attempts: Number(x.attempts),
    }));
  });
}

async function settle(
  pool: PoolLike,
  m: Claimed,
  outcome: { kind: 'delivered'; code: string } | { kind: 'refused'; code: string } | { kind: 'retry'; error: string },
  now: Date,
): Promise<void> {
  await inTransaction(pool, async (tx) => {
    if (outcome.kind === 'delivered') {
      await tx.query(
        `UPDATE platform_transfer_outbox SET state = 'delivered', delivered_at = $2, locked_at = NULL, last_error = NULL, response_code = $3 WHERE id = $1`,
        [m.id, now, outcome.code],
      );
      if (m.kind === 'transfer.package') await markPackageDeliveredWithinTx(tx, m.transferId, now);
      return;
    }
    if (outcome.kind === 'refused') {
      await tx.query(
        `UPDATE platform_transfer_outbox SET state = 'refused', locked_at = NULL, last_error = $2, response_code = $2 WHERE id = $1`,
        [m.id, outcome.code],
      );
      if (m.kind === 'transfer.package') await markPackageRefusedWithinTx(tx, m.transferId, outcome.code, now);
      await journal(tx, {
        operatorId: TRANSFER_SYSTEM_OPERATOR,
        action: TRANSFER_ACTIONS.messageRefused,
        subjectKind: 'platform_transfer',
        subjectId: m.transferId,
        payload: { kind: m.kind, to: m.to, code: outcome.code },
      });
      return;
    }
    const give = m.attempts >= MAX_DELIVERY_ATTEMPTS;
    await tx.query(
      `UPDATE platform_transfer_outbox SET state = $2, locked_at = NULL, last_error = $3, next_attempt_at = $4 WHERE id = $1`,
      [m.id, give ? 'failed' : 'queued', outcome.error.slice(0, 500), new Date(now.getTime() + deliveryBackoffMs(m.attempts))],
    );
    if (m.kind === 'transfer.package') await noteDeliveryErrorWithinTx(tx, m.transferId, outcome.error);
  });
}

export async function deliverDue(pool: PoolLike, deps: DeliveryDeps): Promise<{ delivered: number; refused: number; retry: number }> {
  const out = { delivered: 0, refused: 0, retry: 0 };
  const now = deps.now ?? (() => new Date());
  if (!deps.signingKey) return out; // ключа нет — не подписать; сообщения ждут (видно в админке)
  const batch = await claimDue(pool, deps.limit ?? 20, now());
  for (const m of batch) {
    const target = await getGroupPlatform(pool, m.to);
    if (!target?.apiUrl) {
      await settle(pool, m, { kind: 'retry', error: `нет внутреннего адреса платформы ${m.to} в реестре` }, now());
      out.retry++;
      continue;
    }
    const envelope: Envelope = {
      v: PROTOCOL_VERSION,
      kind: m.kind,
      messageId: m.id,
      from: deps.selfSlug,
      to: m.to,
      transferId: m.transferId,
      issuedAt: now().toISOString(),
      nonce: newNonce(),
      data: m.data,
    };
    const body = JSON.stringify(signEnvelope(envelope, deps.signingKey));
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), deps.timeoutMs ?? 8_000);
      const res = await deps
        .fetch(`${target.apiUrl}${MESSAGES_PATH}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body,
          signal: ctrl.signal,
        })
        .finally(() => clearTimeout(timer));
      const text = await res.text().catch(() => '');
      let code = String(res.status);
      try {
        const j = JSON.parse(text) as { result?: string; code?: string };
        code = j.code ?? j.result ?? code;
      } catch {
        /* тело не JSON — код HTTP */
      }
      if (res.status >= 200 && res.status < 300) {
        await settle(pool, m, { kind: 'delivered', code }, now());
        out.delivered++;
      } else if (res.status >= 400 && res.status < 500 && res.status !== 409 && res.status !== 429 && res.status !== 408) {
        await settle(pool, m, { kind: 'refused', code }, now());
        out.refused++;
      } else {
        await settle(pool, m, { kind: 'retry', error: `HTTP ${res.status}: ${code}` }, now());
        out.retry++;
      }
    } catch (e) {
      await settle(pool, m, { kind: 'retry', error: `сеть: ${(e as Error).message}` }, now());
      out.retry++;
      deps.log?.(`[transfer] ${m.kind} ${m.transferId} → ${m.to}: ${(e as Error).message}`);
    }
  }
  return out;
}

/* ── Приём ──────────────────────────────────────────────────────────────── */

export interface IncomingResponse {
  status: number;
  body: { ok: boolean; result?: string; code?: string };
}

const refuse = (status: number, code: string): IncomingResponse => ({ status, body: { ok: false, code } });

function validStatusData(d: unknown): d is StatusData {
  const x = d as StatusData;
  return Boolean(x && typeof x.number === 'string' && STATUS_EVENTS.includes(x.event) && !Number.isNaN(Date.parse(x.at)));
}

export async function handleIncoming(
  pool: PoolLike,
  rawBody: string,
  deps: { selfSlug: string; now?: Date },
): Promise<IncomingResponse> {
  const now = deps.now ?? new Date();
  if (rawBody.length > 64_000) return refuse(413, 'tooLarge');
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return refuse(400, 'malformed');
  }
  const msg = parseSignedMessage(parsed);
  if (!msg) return refuse(400, 'malformed');
  const e = msg.envelope;
  if (e.to !== deps.selfSlug) return refuse(400, 'wrongRecipient');
  const sender = await getGroupPlatform(pool, e.from);
  if (!sender?.publicKeyPem) return refuse(401, 'unknownSender');
  if (!verifyEnvelope(msg, sender.publicKeyPem)) return refuse(401, 'badSignature');
  if (Math.abs(now.getTime() - Date.parse(e.issuedAt)) > MAX_CLOCK_SKEW_MS) return refuse(401, 'staleMessage');

  return inTransaction<IncomingResponse>(pool, async (tx) => {
    const fail = (r: IncomingResponse) => rollback<IncomingResponse>(r);
    const n = await tx.query(
      `INSERT INTO platform_transfer_nonces (nonce, from_platform, received_at) VALUES ($1, $2, $3) ON CONFLICT (nonce) DO NOTHING RETURNING nonce`,
      [e.nonce, e.from, now],
    );
    if (!n.rows.length) return fail(refuse(409, 'replay'));

    if (e.kind === 'transfer.package') {
      const data = e.data as PackageData;
      const out = await receivePackageWithinTx(tx, {
        transferId: e.transferId,
        from: e.from,
        data,
        packageSha256: canonicalSha256(data),
        selfSlug: deps.selfSlug,
        now,
      });
      if (out.result === 'refused') return fail(refuse(out.retryable ? 503 : 422, out.code));
      return { status: 200, body: { ok: true, result: out.result } };
    }

    // Статус и возврат — идемпотентны по факту (inbox).
    const event = e.kind === 'transfer.status' ? (e.data as StatusData).event : undefined;
    if (e.kind === 'transfer.status' && !validStatusData(e.data)) return fail(refuse(400, 'malformed'));
    if (e.kind === 'transfer.revoke' && typeof (e.data as RevokeData).basis !== 'string') return fail(refuse(400, 'malformed'));
    const key = dedupeKey(e.transferId, e.kind, event);
    const inbox = await tx.query(
      `INSERT INTO platform_transfer_inbox (dedupe_key, transfer_id, kind, from_platform, body_sha256, received_at)
       VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (dedupe_key) DO NOTHING RETURNING dedupe_key`,
      [key, e.transferId, e.kind, e.from, sha256Hex(JSON.stringify(e.data)), now],
    );
    if (!inbox.rows.length) return { status: 200, body: { ok: true, result: 'duplicate' } };

    if (e.kind === 'transfer.revoke') {
      const out = await receiveRevokeWithinTx(tx, {
        transferId: e.transferId,
        from: e.from,
        data: e.data as RevokeData,
        selfSlug: deps.selfSlug,
        now,
      });
      if (out.result === 'refused') return fail(refuse(422, out.code));
      return { status: 200, body: { ok: true, result: 'accepted', code: out.stage } };
    }
    const applied = await applyTargetStatusWithinTx(tx, {
      transferId: e.transferId,
      from: e.from,
      data: e.data as StatusData,
      now,
    });
    if (applied === 'wrongSender') return fail(refuse(422, 'senderMismatch'));
    if (applied === 'unknownTransfer') return fail(refuse(422, 'unknownTransfer'));
    return { status: 200, body: { ok: true, result: applied } };
  });
}

/** Уборка: nonce старше суток не нужны (окно времени — 5 минут). */
export async function pruneNonces(db: Queryable, now = new Date()): Promise<void> {
  await db.query(`DELETE FROM platform_transfer_nonces WHERE received_at < $1`, [new Date(now.getTime() - 86_400_000)]);
}
