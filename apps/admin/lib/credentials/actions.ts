'use server';

import bcrypt from 'bcryptjs';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { readEnv } from '@broker/utils';
import type { LinkBuilder } from '@broker/support';
import { getOperatorSession } from '../auth/current';
import { LOGIN_PATH } from '../auth/constants';
import { moneyPool } from '../crypto/runtime';
import { fmtDateTime as fmt } from '../ui/format';
import {
  changeClientEmail,
  fixWithdrawalAddress,
  issueTemporaryPassword,
  liftWithdrawHold,
  readCredentialSettings,
  sendPasswordResetLink,
  setWithdrawHold,
  updateCredentialSettings,
} from './core';
import { checklistFromText } from './policy';

/**
 * Server actions вкладки «Учётные данные» (функция 3). Роль-гейт — двойной:
 * здесь отсекаются роли, которым правка недоступна в принципе (support и т.п.
 * до карточки не доходят, матрица `sections.ts`), а флаг менеджера и
 * закрепление клиента ядро перепроверяет в базе внутри транзакции
 * (`core.ts → authorize`). Автор — только из сессии (Р-451).
 */

export interface CredentialActionState {
  error?: string;
  detail?: string;
  ok?: boolean;
}

/** Ответ «временный пароль»: пароль — только в этом ответе, один раз. */
export interface TempPasswordState extends CredentialActionState {
  password?: string;
  expiresAt?: string;
  sessionsRevoked?: number;
  autoHoldUntil?: string | null;
}

async function requireOperator() {
  const operator = await getOperatorSession();
  if (!operator) redirect(LOGIN_PATH);
  return operator;
}

/**
 * Ссылка в письме — ТОЛЬКО от адреса кабинета из окружения (как в кабинете,
 * защита от reset-link poisoning). Не задан → письма не ставятся (fail-closed).
 */
function linkBuilder(): LinkBuilder | null {
  const base = readEnv(process.env.CABINET_PUBLIC_URL) ?? readEnv(process.env.NEXT_PUBLIC_CABINET_URL);
  if (!base) return null;
  const root = base.replace(/\/+$/, '');
  return (path, token, locale) => `${root}${locale === 'en' ? '/en' : ''}${path}?token=${encodeURIComponent(token)}`;
}

const str = (fd: FormData, k: string) => String(fd.get(k) ?? '').trim();

function base(fd: FormData, actorId: string) {
  return {
    actorId,
    userId: str(fd, 'userId'),
    basis: str(fd, 'reason'),
    ticket: str(fd, 'ticket') || null,
    checks: fd.getAll('check').map((v) => String(v)),
  };
}

function done(userId: string) {
  revalidatePath(`/clients/${userId}`);
  revalidatePath('/');
}

async function guarded<T extends CredentialActionState>(fn: () => Promise<T>): Promise<T | CredentialActionState> {
  try {
    return await fn();
  } catch (error) {
    console.error('[credentials] действие не выполнено:', (error as Error).message);
    return { error: 'journalUnavailable' };
  }
}

export async function changeEmailAction(_prev: CredentialActionState, fd: FormData): Promise<CredentialActionState> {
  const op = await requireOperator();
  return guarded(async () => {
    const input = { ...base(fd, op.operatorId), newEmail: str(fd, 'newEmail') };
    const r = await changeClientEmail(input, { pool: moneyPool(), link: linkBuilder() });
    if (!r.ok) return { error: r.reason };
    done(input.userId);
    return { ok: true, detail: r.autoHoldUntil ? `вывод заморожен до ${fmt(r.autoHoldUntil)}` : undefined };
  });
}

export async function sendResetLinkAction(_prev: CredentialActionState, fd: FormData): Promise<CredentialActionState> {
  const op = await requireOperator();
  return guarded(async () => {
    const input = base(fd, op.operatorId);
    const r = await sendPasswordResetLink(input, { pool: moneyPool(), link: linkBuilder() });
    if (!r.ok) return { error: r.reason };
    done(input.userId);
    return { ok: true, detail: `письмо на ${r.sentTo}` };
  });
}

export async function issueTempPasswordAction(_prev: TempPasswordState, fd: FormData): Promise<TempPasswordState> {
  const op = await requireOperator();
  return guarded(async () => {
    const input = base(fd, op.operatorId);
    // Тот же алгоритм и цена, что у кабинета (`apps/cabinet/lib/auth/password.ts`).
    const r = await issueTemporaryPassword(input, { pool: moneyPool(), hash: (p) => bcrypt.hash(p, 12) });
    if (!r.ok) return { error: r.reason };
    done(input.userId);
    return {
      ok: true,
      password: r.password,
      expiresAt: r.expiresAt,
      sessionsRevoked: r.sessionsRevoked,
      autoHoldUntil: r.autoHoldUntil,
    };
  });
}

export async function fixWithdrawalAddressAction(_prev: CredentialActionState, fd: FormData): Promise<CredentialActionState> {
  const op = await requireOperator();
  return guarded(async () => {
    const input = { ...base(fd, op.operatorId), withdrawalId: str(fd, 'withdrawalId'), newAddress: str(fd, 'newAddress') };
    const r = await fixWithdrawalAddress(input, { pool: moneyPool() });
    if (!r.ok) return { error: r.reason };
    done(input.userId);
    revalidatePath('/money');
    return { ok: true, detail: `${r.before} → ${r.after}` };
  });
}

/** Поле срока: `datetime-local` (UTC-наивная строка трактуется как время сервера) или пусто = бессрочно. */
function untilOf(fd: FormData): Date | null | 'invalid' {
  if (str(fd, 'mode') === 'indefinite') return null;
  const hours = Number(str(fd, 'hours'));
  if (str(fd, 'mode') === 'hours') {
    return Number.isFinite(hours) && hours > 0 ? new Date(Date.now() + hours * 3_600_000) : 'invalid';
  }
  const raw = str(fd, 'until');
  if (!raw) return 'invalid';
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? 'invalid' : d;
}

export async function setHoldAction(_prev: CredentialActionState, fd: FormData): Promise<CredentialActionState> {
  const op = await requireOperator();
  return guarded(async () => {
    const until = untilOf(fd);
    if (until === 'invalid') return { error: 'invalidUntil' };
    const userId = str(fd, 'userId');
    const r = await setWithdrawHold(
      { actorId: op.operatorId, userId, basis: str(fd, 'reason'), ticket: str(fd, 'ticket') || null, until },
      { pool: moneyPool() },
    );
    if (!r.ok) return { error: r.reason };
    done(userId);
    return { ok: true, detail: r.until ? `до ${fmt(r.until)}` : 'бессрочно' };
  });
}

export async function liftHoldAction(_prev: CredentialActionState, fd: FormData): Promise<CredentialActionState> {
  const op = await requireOperator();
  return guarded(async () => {
    const userId = str(fd, 'userId');
    const r = await liftWithdrawHold(
      { actorId: op.operatorId, userId, basis: str(fd, 'reason'), ticket: str(fd, 'ticket') || null },
      { pool: moneyPool() },
    );
    if (!r.ok) return { error: r.reason };
    done(userId);
    return { ok: true };
  });
}

/** Настройки платформы → «Безопасность учётных данных» (только admin). */
export async function updateCredentialSettingsAction(_prev: CredentialActionState, fd: FormData): Promise<CredentialActionState> {
  const op = await requireOperator();
  if (op.role !== 'admin') return { error: 'forbidden' };
  return guarded(async () => {
    const current = await readCredentialSettings(moneyPool());
    const int = (k: string) => {
      const v = Number(str(fd, k));
      return Number.isInteger(v) ? v : NaN;
    };
    const r = await updateCredentialSettings(
      {
        actorId: op.operatorId,
        basis: str(fd, 'reason'),
        next: {
          checklist: checklistFromText(String(fd.get('checklist') ?? ''), current.checklist),
          minChecked: int('minChecked'),
          autoHoldEnabled: fd.get('autoHoldEnabled') === 'on',
          autoHoldHours: int('autoHoldHours'),
          alertPerOperatorDay: int('alertPerOperatorDay'),
          tempPasswordHours: int('tempPasswordHours'),
        },
      },
      { pool: moneyPool() },
    );
    if (!r.ok) return { error: r.reason };
    revalidatePath('/settings');
    return { ok: true };
  });
}
