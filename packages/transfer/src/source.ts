import { inTransaction, rollback, type PoolLike, type Queryable } from '@broker/money';
import {
  TRANSFER_ACTIONS,
  TRANSFER_SYSTEM_OPERATOR,
  iso,
  journal,
  setMoneyFlagsWithinTx,
  type TransferTerminalPort,
} from './common';
import { canonicalSha256 } from './envelope';
import { CONSENT_TEXT_SHA256, CONSENT_TEXT_VERSION, verifyTicketEvidence, type EvidenceError } from './evidence';
import { enqueueMessage, type PackageData, type RevokeData, type StatusData } from './messages';
import { MANAGER_DAILY_TRANSFER_LIMIT, checkDirection, type DirectionBlocker, type DirectionHint } from './policy';
import { getGroupPlatform } from './registry';

/**
 * Источник: перевод проводит МЕНЕДЖЕР клиента сам (решение владельца 10.11 —
 * одобрения admin нет). Барьеры, которые держит система:
 *  1. отдельная кнопка и отдельная страница (не форма в общей панели);
 *  2. только закреплённый менеджер этого клиента (флаг is_client_manager +
 *     client_managers.manager_id = оператор). Admin перевод НЕ проводит — он
 *     контролирует постфактум и может «Вернуть перевод»;
 *  3. обязательное доказательство инициативы — тикет, первое сообщение
 *     которого от клиента; согласие — сообщение клиента в нём;
 *  4. жёсткие запреты направления по профилям юрисдикций;
 *  5. анти-массовость: не больше N переводов у менеджера за сутки.
 * Всё — одной транзакцией с журналом и постановкой пакета в очередь.
 */

export type TransferStatus =
  | 'sent'
  | 'delivered'
  | 'invited'
  | 'registered'
  | 'kyc_passed'
  | 'source_closed'
  | 'refused'
  | 'expired'
  | 'revoked';

export const LIVE_STATUSES: readonly TransferStatus[] = ['sent', 'delivered', 'invited', 'registered', 'kyc_passed', 'source_closed'];
const ORDER: TransferStatus[] = ['sent', 'delivered', 'invited', 'registered', 'kyc_passed', 'source_closed'];

export type CreateTransferError =
  | 'missingReason'
  | 'consentNotConfirmed'
  | 'notClientManager'
  | 'noClient'
  | 'clientBlocked'
  | 'liveTransferExists'
  | 'dailyLimit'
  | 'directionForbidden'
  | EvidenceError;

export type CreateTransferResult =
  | { ok: true; transferId: string; number: string; hints: DirectionHint[]; journalSeq: number }
  | { ok: false; reason: Exclude<CreateTransferError, 'directionForbidden'> }
  | { ok: false; reason: 'directionForbidden'; blockers: DirectionBlocker[] };

export async function createTransfer(
  pool: PoolLike,
  input: {
    operatorId: string;
    userId: string;
    targetSlug: string;
    ticketId: string;
    consentMessageId: string;
    consentConfirmed: boolean;
    basis: string;
    selfSlug: string;
    now?: Date;
  },
): Promise<CreateTransferResult> {
  const basis = input.basis.trim();
  if (!basis) return { ok: false, reason: 'missingReason' };
  if (!input.consentConfirmed) return { ok: false, reason: 'consentNotConfirmed' };
  const now = input.now ?? new Date();

  return inTransaction<CreateTransferResult>(pool, async (tx) => {
    const fail = (r: CreateTransferResult) => rollback<CreateTransferResult>(r);
    // Клиент и его состояние; строка клиента — под замком (гонка двух переводов).
    const u = await tx.query(
      `SELECT u.id, u.full_name, u.email, u.country, u.locale,
              COALESCE(b.blocked, false) AS blocked,
              v.state AS kyc_state, v.updated_at AS kyc_at
         FROM users u
         LEFT JOIN client_blocks b ON b.user_id = u.id
         LEFT JOIN client_verification v ON v.user_id = u.id
        WHERE u.id = $1
          FOR UPDATE OF u`,
      [input.userId],
    );
    const user = u.rows[0];
    if (!user) return fail({ ok: false, reason: 'noClient' });

    // Только закреплённый менеджер этого клиента с действующим флагом.
    const m = await tx.query(
      `SELECT 1 FROM client_managers cm JOIN operators o ON o.id = cm.manager_id
        WHERE cm.user_id = $1 AND cm.manager_id = $2 AND o.is_client_manager AND o.disabled_at IS NULL`,
      [input.userId, input.operatorId],
    );
    if (!m.rows.length) return fail({ ok: false, reason: 'notClientManager' });
    if (user.blocked) return fail({ ok: false, reason: 'clientBlocked' });

    const live = await tx.query(
      `SELECT 1 FROM platform_transfers WHERE user_id = $1 AND status = ANY($2::text[])`,
      [input.userId, LIVE_STATUSES],
    );
    if (live.rows.length) return fail({ ok: false, reason: 'liveTransferExists' });

    const daily = await tx.query(
      `SELECT count(*)::int AS n FROM platform_transfers WHERE initiator_id = $1 AND created_at > $2`,
      [input.operatorId, new Date(now.getTime() - 86_400_000)],
    );
    if (Number(daily.rows[0]?.n ?? 0) >= MANAGER_DAILY_TRANSFER_LIMIT) return fail({ ok: false, reason: 'dailyLimit' });

    const [self, target] = await Promise.all([
      getGroupPlatform(tx, input.selfSlug),
      getGroupPlatform(tx, input.targetSlug),
    ]);
    const kycState = user.kyc_state ? String(user.kyc_state) : 'unverified';
    const direction = checkDirection({
      selfSlug: input.selfSlug,
      source: self,
      target,
      clientCountry: (user.country as string | null) ?? null,
      sourceKycState: kycState,
    });
    if (direction.blockers.length) return fail({ ok: false, reason: 'directionForbidden', blockers: direction.blockers });

    const ev = await verifyTicketEvidence(tx, {
      userId: input.userId,
      ticketId: input.ticketId,
      consentMessageId: input.consentMessageId,
      now,
    });
    if (!ev.ok) return fail({ ok: false, reason: ev.reason });

    const seqRow = await tx.query(`SELECT nextval('platform_transfer_number_seq') AS n`);
    const number = `TR-${input.selfSlug}-${seqRow.rows[0]!.n}`;
    const idRow = await tx.query(`SELECT gen_random_uuid() AS id`);
    const transferId = String(idRow.rows[0]!.id);

    const pkg: PackageData = {
      number,
      sourcePlatform: input.selfSlug,
      client: {
        fullName: String(user.full_name),
        email: String(user.email),
        country: (user.country as string | null) ?? null,
        locale: user.locale === 'en' ? 'en' : 'ru',
      },
      sourceKyc: { state: kycState, at: user.kyc_at ? iso(user.kyc_at) : null },
      evidence: { kind: 'support_ticket', sha256: ev.value.evidenceSha256 },
      consent: {
        at: ev.value.consentAt,
        textVersion: CONSENT_TEXT_VERSION,
        textSha256: CONSENT_TEXT_SHA256,
        messageSha256: ev.value.consentMessageSha256,
      },
      initiatedAt: now.toISOString(),
    };
    const packageSha256 = canonicalSha256(pkg);

    await tx.query(
      `INSERT INTO platform_transfers (id, number, user_id, source_platform, target_platform, status, initiator_id,
         evidence_ticket_id, evidence_message_id, evidence_sha256, consent_message_id, consent_text_version, consent_at,
         basis, jurisdiction_flags, package_sha256, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, 'sent', $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $16)`,
      [
        transferId,
        number,
        input.userId,
        input.selfSlug,
        input.targetSlug,
        input.operatorId,
        ev.value.ticketId,
        ev.value.firstMessageId,
        ev.value.evidenceSha256,
        ev.value.consentMessageId,
        CONSENT_TEXT_VERSION,
        ev.value.consentAt,
        basis,
        JSON.stringify(direction.hints),
        packageSha256,
        now,
      ],
    );
    await enqueueMessage(tx, { transferId, to: input.targetSlug, kind: 'transfer.package', data: pkg });
    const seq = await journal(tx, {
      operatorId: input.operatorId,
      action: TRANSFER_ACTIONS.sent,
      subjectKind: 'client',
      subjectId: input.userId,
      payload: {
        basis,
        transferId,
        number,
        target: input.targetSlug,
        ticketNumber: ev.value.ticketNumber,
        evidenceSha256: ev.value.evidenceSha256,
        consentMessageId: ev.value.consentMessageId,
        consentTextVersion: CONSENT_TEXT_VERSION,
        packageSha256,
        hints: direction.hints,
      },
    });
    await tx.query(`UPDATE platform_transfers SET last_journal_seq = $2 WHERE id = $1`, [transferId, seq]);
    return { ok: true, transferId, number, hints: direction.hints, journalSeq: seq };
  });
}

/* ── Возврат перевода (admin, постфактум) ─────────────────────────────── */

export type RevokeResult =
  | { ok: true; stage: 'before_registration' | 'after_registration'; messageQueued: boolean; restorePending: boolean }
  | { ok: false; reason: 'missingReason' | 'notAdmin' | 'notFound' | 'notRevocable' };

/**
 * «Вернуть перевод» — admin с основанием. Поведение по стадии:
 *  - до регистрации клиента в цели: цель отзывает приглашение (ссылка
 *    недействительна) — подписанным сообщением `transfer.revoke`; если пакет
 *    ещё не доставлен, он снимается с очереди;
 *  - после регистрации: то же сообщение — цель замораживает счёт клиента,
 *    пишет ему письмо и, если он уже пополнил счёт, ставит задачу вернуть
 *    средства выводом. Деньги автоматически не двигаются.
 * В источнике клиент восстанавливается: если счёт закрывали по переводу и до
 * этого он не был заморожен — заморозка снимается (терминал — сразу или
 * повтором воркера).
 */
export async function revokeTransfer(
  pool: PoolLike,
  input: { operatorId: string; transferId: string; basis: string; now?: Date },
): Promise<RevokeResult> {
  const basis = input.basis.trim();
  if (!basis) return { ok: false, reason: 'missingReason' };
  const now = input.now ?? new Date();
  return inTransaction<RevokeResult>(pool, async (tx) => {
    const fail = (r: RevokeResult) => rollback<RevokeResult>(r);
    const op = await tx.query(`SELECT role FROM operators WHERE id = $1 AND disabled_at IS NULL`, [input.operatorId]);
    if (op.rows[0]?.role !== 'admin') return fail({ ok: false, reason: 'notAdmin' });
    const t = await tx.query(
      `SELECT id, number, user_id, target_platform, status, delivery_state, source_close_prev_frozen
         FROM platform_transfers WHERE id = $1 FOR UPDATE`,
      [input.transferId],
    );
    const tr = t.rows[0];
    if (!tr) return fail({ ok: false, reason: 'notFound' });
    const status = String(tr.status) as TransferStatus;
    if (!LIVE_STATUSES.includes(status)) return fail({ ok: false, reason: 'notRevocable' });
    const stage = ['registered', 'kyc_passed', 'source_closed'].includes(status) ? 'after_registration' : 'before_registration';

    // Пакет ещё в очереди и не уходил — снимаем; иначе цели нужен отзыв.
    const cancelled = await tx.query(
      `UPDATE platform_transfer_outbox SET state = 'cancelled', last_error = 'перевод возвращён до доставки'
        WHERE transfer_id = $1 AND kind = 'transfer.package' AND state IN ('queued', 'failed') AND attempts = 0
        RETURNING id`,
      [input.transferId],
    );
    let messageQueued = false;
    if (!cancelled.rows.length) {
      const data: RevokeData = { number: String(tr.number), basis, revokedAt: now.toISOString() };
      messageQueued =
        (await enqueueMessage(tx, { transferId: input.transferId, to: String(tr.target_platform), kind: 'transfer.revoke', data })) !==
        null;
      // Пакет в повторах (цель была недоступна) — новых попыток не нужно.
      await tx.query(
        `UPDATE platform_transfer_outbox SET state = 'cancelled' WHERE transfer_id = $1 AND kind = 'transfer.package' AND state IN ('queued', 'failed')`,
        [input.transferId],
      );
    }

    // Восстановление источника: закрытие по переводу снимается, если до него
    // счёт не был заморожен (чужую заморозку не трогаем).
    let restorePending = false;
    if (status === 'source_closed' && tr.source_close_prev_frozen === false) {
      await setMoneyFlagsWithinTx(tx, {
        userId: String(tr.user_id),
        operatorId: input.operatorId,
        basis: `Возврат перевода ${tr.number}: ${basis}`,
        transferId: input.transferId,
        frozen: false,
      });
      restorePending = true;
    }

    await tx.query(
      `UPDATE platform_transfers
          SET status = 'revoked', revoked_at = $2, revoked_by = $3, revoke_basis = $4, revoke_stage = $5,
              delivery_state = CASE WHEN $6::boolean THEN 'cancelled' ELSE delivery_state END,
              restore_state = CASE WHEN $7::boolean THEN 'pending' ELSE restore_state END,
              admin_seen_at = COALESCE(admin_seen_at, $2), admin_seen_by = COALESCE(admin_seen_by, $3),
              updated_at = $2
        WHERE id = $1`,
      [input.transferId, now, input.operatorId, basis, stage, cancelled.rows.length > 0, restorePending],
    );
    const seq = await journal(tx, {
      operatorId: input.operatorId,
      action: TRANSFER_ACTIONS.revoked,
      subjectKind: 'client',
      subjectId: String(tr.user_id),
      payload: {
        basis,
        transferId: input.transferId,
        number: String(tr.number),
        target: String(tr.target_platform),
        stage,
        previousStatus: status,
        packageWithdrawn: cancelled.rows.length > 0,
        restorePending,
      },
    });
    await tx.query(`UPDATE platform_transfers SET last_journal_seq = $2 WHERE id = $1`, [input.transferId, seq]);
    return { ok: true, stage, messageQueued, restorePending };
  });
}

/* ── Закрытие счёта в источнике (менеджер/admin, с основанием) ────────── */

export type CloseResult =
  | { ok: true }
  | { ok: false; reason: 'fundsOrPositions'; balanceMinor: number; equityMinor: number; openPositions: number }
  | { ok: false; reason: 'pendingMoney'; withdrawals: number; deposits: number }
  | {
      ok: false;
      reason:
        | 'missingReason'
        | 'notFound'
        | 'notAllowed'
        | 'notReady'
        | 'balanceUnknown'
        | 'terminalUnavailable'
        | 'terminalRefused';
    };

/**
 * «Закрыть счёт по переводу»: клиент зарегистрировался в цели, баланс
 * реального счёта в источнике нулевой → торговля замораживается (флаг
 * заморозки + терминал), вход в кабинет остаётся. Это закрытие по запросу
 * клиента; деньги не двигаются.
 */
export async function closeSourceAccount(
  pool: PoolLike,
  terminal: TransferTerminalPort,
  input: { operatorId: string; role: string; transferId: string; basis: string; now?: Date },
): Promise<CloseResult> {
  const basis = input.basis.trim();
  if (!basis) return { ok: false, reason: 'missingReason' };
  const now = input.now ?? new Date();
  const t = await pool.query(`SELECT id, number, user_id, status FROM platform_transfers WHERE id = $1`, [input.transferId]);
  const tr = t.rows[0];
  if (!tr) return { ok: false, reason: 'notFound' };
  const userId = String(tr.user_id);
  if (input.role !== 'admin') {
    const m = await pool.query(`SELECT 1 FROM client_managers WHERE user_id = $1 AND manager_id = $2`, [userId, input.operatorId]);
    if (!m.rows.length) return { ok: false, reason: 'notAllowed' };
  }
  if (!['registered', 'kyc_passed'].includes(String(tr.status))) return { ok: false, reason: 'notReady' };
  // Деньги и позиции — fail-closed: закрыть можно только пустой счёт без
  // открытых позиций и без незавершённых заявок ввода/вывода на сайте.
  const pending = await pool.query(
    `SELECT (SELECT count(*)::int FROM crypto_withdrawals
              WHERE user_id = $1 AND status NOT IN ('settled', 'rejected', 'cancelled')) AS w,
            (SELECT count(*)::int FROM crypto_deposits WHERE user_id = $1 AND status = 'claimed') AS d`,
    [userId],
  );
  const pw = Number(pending.rows[0]?.w ?? 0);
  const pd = Number(pending.rows[0]?.d ?? 0);
  if (pw > 0 || pd > 0) return { ok: false, reason: 'pendingMoney', withdrawals: pw, deposits: pd };
  const acc = await terminal.realAccountState(userId);
  if (acc === 'unavailable') return { ok: false, reason: 'balanceUnknown' };
  if (acc !== null) {
    if (acc.balanceMinor === null || acc.equityMinor === null || acc.openPositions === null) {
      return { ok: false, reason: 'balanceUnknown' };
    }
    if (acc.balanceMinor > 0 || acc.equityMinor > 0 || acc.openPositions > 0) {
      return {
        ok: false,
        reason: 'fundsOrPositions',
        balanceMinor: acc.balanceMinor,
        equityMinor: acc.equityMinor,
        openPositions: acc.openPositions,
      };
    }
  }
  const frozen = await terminal.setTradingFrozen(userId, true, `Счёт закрыт по переводу ${tr.number}: ${basis}`);
  if (frozen === 'unavailable') return { ok: false, reason: 'terminalUnavailable' };
  if (frozen === 'refused') return { ok: false, reason: 'terminalRefused' };

  return inTransaction<CloseResult>(pool, async (tx) => {
    const cur = await tx.query(`SELECT status FROM platform_transfers WHERE id = $1 FOR UPDATE`, [input.transferId]);
    if (!['registered', 'kyc_passed'].includes(String(cur.rows[0]?.status))) {
      return rollback<CloseResult>({ ok: false, reason: 'notReady' });
    }
    const flags = await setMoneyFlagsWithinTx(tx, {
      userId,
      operatorId: input.operatorId,
      basis: `Счёт закрыт по переводу ${tr.number}: ${basis}`,
      transferId: input.transferId,
      frozen: true,
    });
    await tx.query(
      `UPDATE platform_transfers
          SET status = 'source_closed', source_closed_at = $2, source_closed_by = $3, source_close_basis = $4,
              source_close_prev_frozen = $5, updated_at = $2
        WHERE id = $1`,
      [input.transferId, now, input.operatorId, basis, flags.before.frozen],
    );
    const seq = await journal(tx, {
      operatorId: input.operatorId,
      action: TRANSFER_ACTIONS.sourceClosed,
      subjectKind: 'client',
      subjectId: userId,
      payload: { basis, transferId: input.transferId, number: String(tr.number), previousFrozen: flags.before.frozen },
    });
    await tx.query(`UPDATE platform_transfers SET last_journal_seq = $2 WHERE id = $1`, [input.transferId, seq]);
    return { ok: true };
  });
}

/** Воркер: снять заморозку торговли в терминале у возвращённых переводов. */
export async function applyPendingRestores(pool: PoolLike, terminal: TransferTerminalPort): Promise<number> {
  const r = await pool.query(
    `SELECT id, number, user_id FROM platform_transfers WHERE restore_state = 'pending' ORDER BY revoked_at LIMIT 20`,
  );
  let done = 0;
  for (const row of r.rows) {
    const out = await terminal.setTradingFrozen(String(row.user_id), false, `Возврат перевода ${row.number}`);
    if (out !== 'ok') continue;
    await inTransaction(pool, async (tx) => {
      await tx.query(`UPDATE platform_transfers SET restore_state = 'done', updated_at = now() WHERE id = $1`, [row.id]);
      await journal(tx, {
        operatorId: TRANSFER_SYSTEM_OPERATOR,
        action: TRANSFER_ACTIONS.restored,
        subjectKind: 'client',
        subjectId: String(row.user_id),
        payload: { transferId: String(row.id), number: String(row.number), terminal: 'unfrozen' },
      });
    });
    done++;
  }
  return done;
}

/* ── Исходы доставки и статусы от цели ────────────────────────────────── */

export async function markPackageDeliveredWithinTx(tx: Queryable, transferId: string, at: Date): Promise<void> {
  const r = await tx.query(
    `UPDATE platform_transfers SET status = CASE WHEN status = 'sent' THEN 'delivered' ELSE status END,
            delivery_state = 'delivered', delivered_at = $2, delivery_error = NULL, updated_at = $2
      WHERE id = $1 AND delivery_state = 'pending' RETURNING user_id, number, target_platform`,
    [transferId, at],
  );
  const row = r.rows[0];
  if (!row) return;
  await journal(tx, {
    operatorId: TRANSFER_SYSTEM_OPERATOR,
    action: TRANSFER_ACTIONS.delivered,
    subjectKind: 'client',
    subjectId: String(row.user_id),
    payload: { transferId, number: String(row.number), target: String(row.target_platform) },
  });
}

export async function markPackageRefusedWithinTx(tx: Queryable, transferId: string, code: string, at: Date): Promise<void> {
  const r = await tx.query(
    `UPDATE platform_transfers SET status = 'refused', delivery_state = 'refused', delivery_error = $3, updated_at = $2
      WHERE id = $1 AND status IN ('sent', 'delivered') RETURNING user_id, number, target_platform`,
    [transferId, at, code],
  );
  const row = r.rows[0];
  if (!row) return;
  await journal(tx, {
    operatorId: TRANSFER_SYSTEM_OPERATOR,
    action: TRANSFER_ACTIONS.refused,
    subjectKind: 'client',
    subjectId: String(row.user_id),
    payload: { transferId, number: String(row.number), target: String(row.target_platform), code },
  });
}

export async function noteDeliveryErrorWithinTx(tx: Queryable, transferId: string, error: string): Promise<void> {
  await tx.query(`UPDATE platform_transfers SET delivery_error = $2, updated_at = now() WHERE id = $1 AND delivery_state = 'pending'`, [
    transferId,
    error.slice(0, 300),
  ]);
}

const EVENT_STATUS: Partial<Record<StatusData['event'], TransferStatus>> = {
  invited: 'invited',
  registered: 'registered',
  kyc_passed: 'kyc_passed',
};

/**
 * Статус от цели (`transfer.status`). Отправитель обязан быть целью ЭТОГО
 * перевода. Статус двигается только вперёд; у возвращённого перевода
 * принимается лишь подтверждение возврата (`revoke_applied`).
 */
export async function applyTargetStatusWithinTx(
  tx: Queryable,
  input: { transferId: string; from: string; data: StatusData; now: Date },
): Promise<'applied' | 'ignored' | 'unknownTransfer' | 'wrongSender'> {
  const t = await tx.query(
    `SELECT id, number, user_id, target_platform, status FROM platform_transfers WHERE id = $1 FOR UPDATE`,
    [input.transferId],
  );
  const tr = t.rows[0];
  if (!tr) return 'unknownTransfer';
  if (String(tr.target_platform) !== input.from) return 'wrongSender';
  const status = String(tr.status) as TransferStatus;
  const at = new Date(input.data.at);
  const userId = String(tr.user_id);
  const number = String(tr.number);
  const ev = input.data.event;

  if (ev === 'revoke_applied') {
    await tx.query(
      `UPDATE platform_transfers SET revoke_applied_at = $2, revoke_target_detail = $3, updated_at = $4 WHERE id = $1`,
      [input.transferId, at, JSON.stringify(input.data.detail ?? {}), input.now],
    );
    await journal(tx, {
      operatorId: TRANSFER_SYSTEM_OPERATOR,
      action: TRANSFER_ACTIONS.revokeApplied,
      subjectKind: 'client',
      subjectId: userId,
      payload: { transferId: input.transferId, number, target: input.from, detail: input.data.detail ?? {} },
    });
    return 'applied';
  }
  if (status === 'revoked' || status === 'refused') return 'ignored';

  const timeCol: Record<string, string> = {
    invited: 'target_invited_at',
    registered: 'target_registered_at',
    kyc_passed: 'target_kyc_passed_at',
  };
  if (ev === 'expired') {
    if (!['sent', 'delivered', 'invited'].includes(status)) return 'ignored';
    await tx.query(`UPDATE platform_transfers SET status = 'expired', updated_at = $2 WHERE id = $1`, [input.transferId, input.now]);
  } else {
    const next = EVENT_STATUS[ev]!;
    // Время фиксируем всегда (даже если события пришли не по порядку),
    // статус — только вперёд и не поверх «закрыт в источнике».
    const forward = ORDER.indexOf(next) > ORDER.indexOf(status) && status !== 'source_closed';
    await tx.query(
      `UPDATE platform_transfers SET ${timeCol[ev]} = COALESCE(${timeCol[ev]}, $2),
              status = CASE WHEN $3::boolean THEN $4 ELSE status END,
              delivery_state = CASE WHEN delivery_state = 'pending' THEN 'delivered' ELSE delivery_state END,
              updated_at = $5
        WHERE id = $1`,
      [input.transferId, at, forward, next, input.now],
    );
  }
  const action =
    ev === 'invited'
      ? TRANSFER_ACTIONS.targetInvited
      : ev === 'registered'
        ? TRANSFER_ACTIONS.targetRegistered
        : ev === 'kyc_passed'
          ? TRANSFER_ACTIONS.targetKycPassed
          : TRANSFER_ACTIONS.targetExpired;
  const seq = await journal(tx, {
    operatorId: TRANSFER_SYSTEM_OPERATOR,
    action,
    subjectKind: 'client',
    subjectId: userId,
    payload: { transferId: input.transferId, number, target: input.from, at: input.data.at },
  });
  await tx.query(`UPDATE platform_transfers SET last_journal_seq = $2 WHERE id = $1`, [input.transferId, seq]);
  return 'applied';
}

/** Ручной повтор доставки (admin/менеджер): сброс счётчика упавших сообщений перевода. */
export async function retryDelivery(pool: PoolLike, input: { operatorId: string; transferId: string }): Promise<number> {
  return inTransaction(pool, async (tx) => {
    const r = await tx.query(
      `UPDATE platform_transfer_outbox SET state = 'queued', attempts = 0, next_attempt_at = now(), last_error = NULL
        WHERE transfer_id = $1 AND state IN ('failed', 'queued') RETURNING id`,
      [input.transferId],
    );
    if (r.rows.length) {
      const t = await tx.query(`SELECT user_id, number FROM platform_transfers WHERE id = $1`, [input.transferId]);
      if (t.rows[0]) {
        await journal(tx, {
          operatorId: input.operatorId,
          action: TRANSFER_ACTIONS.deliveryRetried,
          subjectKind: 'client',
          subjectId: String(t.rows[0].user_id),
          payload: { transferId: input.transferId, number: String(t.rows[0].number), messages: r.rows.length },
        });
      }
    }
    return r.rows.length;
  });
}

/** Admin просмотрел переводы — уведомление гаснет (журнал: кто и сколько). */
export async function markTransfersSeen(pool: PoolLike, operatorId: string): Promise<number> {
  return inTransaction(pool, async (tx) => {
    const r = await tx.query(
      `UPDATE platform_transfers SET admin_seen_at = now(), admin_seen_by = $1 WHERE admin_seen_at IS NULL RETURNING id, number`,
      [operatorId],
    );
    const r2 = await tx.query(`UPDATE platform_transfers_inbound SET admin_seen_at = now() WHERE admin_seen_at IS NULL RETURNING transfer_id`);
    if (r.rows.length) {
      await journal(tx, {
        operatorId,
        action: TRANSFER_ACTIONS.seen,
        subjectKind: 'platform',
        subjectId: 'transfers',
        payload: { numbers: r.rows.map((x) => String(x.number)) },
      });
    }
    return r.rows.length + r2.rows.length;
  });
}
