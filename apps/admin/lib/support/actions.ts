'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import {
  addInternalNote,
  assignTicket,
  changeTicketStatus,
  linkTicketToClient,
  loadSupportSettings,
  operatorReply,
  requeueMail,
  saveSupportSettings,
  saveTemplate,
  TEXT_KEYS,
  TICKET_STATUSES,
  WEEKDAYS,
  type SupportSettings,
  type TicketStatus,
} from '@broker/support';
import { LOGIN_PATH } from '../auth/constants';
import { getPool } from '../db';
import { supportActor, supportPool } from './runtime';
// ── Перевод на другую платформу группы (ветка client-transfer): шаблон не может предлагать перевод ──
import { listGroupPlatforms, mentionsOtherPlatform } from '@broker/transfer';

/**
 * Server actions раздела «Поддержка». Личность — из сессии (Р-451), права —
 * в `@broker/support` (fail-closed). Результат — состояние формы для Callout
 * над формой (концепция §6.6: тосты на периметре не используем).
 */

export interface SupportActionState {
  ok?: boolean;
  error?: string;
  /** Ошибки полей настроек: путь поля → код. */
  fields?: Record<string, string>;
  /** Счётчик успешных отправок — форма по нему очищается. */
  seq?: number;
}

async function actorOrLogin() {
  const actor = await supportActor();
  if (!actor) redirect(LOGIN_PATH);
  return actor;
}

const str = (fd: FormData, k: string) => String(fd.get(k) ?? '');

function done(ticketRef: string, prev: SupportActionState): SupportActionState {
  revalidatePath('/support');
  revalidatePath(`/support/${ticketRef}`);
  return { ok: true, seq: (prev.seq ?? 0) + 1 };
}

export async function replyAction(prev: SupportActionState, fd: FormData): Promise<SupportActionState> {
  const actor = await actorOrLogin();
  const ticketId = str(fd, 'ticketId');
  const mode = str(fd, 'mode');
  const body = str(fd, 'body');
  const templateKey = str(fd, 'templateKey') || null;
  if (mode === 'note') {
    const r = await addInternalNote(supportPool(), actor, { ticketId, body });
    return r.ok ? done(str(fd, 'ticketNumber'), prev) : { error: r.reason, seq: prev.seq };
  }
  const settings = await loadSupportSettings(getPool());
  const r = await operatorReply(supportPool(), settings, actor, { ticketId, body, templateKey });
  return r.ok ? done(str(fd, 'ticketNumber'), prev) : { error: r.reason, seq: prev.seq };
}

export async function assignAction(prev: SupportActionState, fd: FormData): Promise<SupportActionState> {
  const actor = await actorOrLogin();
  const assignee = str(fd, 'assigneeId');
  const r = await assignTicket(supportPool(), actor, {
    ticketId: str(fd, 'ticketId'),
    assigneeId: assignee === 'me' ? actor.operatorId : assignee || null,
  });
  return r.ok ? done(str(fd, 'ticketNumber'), prev) : { error: r.reason };
}

export async function statusAction(prev: SupportActionState, fd: FormData): Promise<SupportActionState> {
  const actor = await actorOrLogin();
  const to = str(fd, 'to') as TicketStatus;
  if (!TICKET_STATUSES.includes(to)) return { error: 'invalidTransition' };
  const r = await changeTicketStatus(supportPool(), actor, {
    ticketId: str(fd, 'ticketId'),
    to,
    reason: str(fd, 'reason'),
    blockSender: fd.get('blockSender') === 'on',
  });
  return r.ok ? done(str(fd, 'ticketNumber'), prev) : { error: r.reason };
}

export async function linkClientAction(prev: SupportActionState, fd: FormData): Promise<SupportActionState> {
  const actor = await actorOrLogin();
  const r = await linkTicketToClient(supportPool(), actor, {
    ticketId: str(fd, 'ticketId'),
    userId: str(fd, 'userId'),
    reason: str(fd, 'reason'),
  });
  return r.ok ? done(str(fd, 'ticketNumber'), prev) : { error: r.reason };
}

export async function requeueMailAction(prev: SupportActionState, fd: FormData): Promise<SupportActionState> {
  await actorOrLogin();
  const ok = await requeueMail(getPool(), str(fd, 'outboundId'));
  return ok ? done(str(fd, 'ticketNumber'), prev) : { error: 'invalidTransition' };
}

/* ─── Настройки (admin) ─────────────────────────────────────────────── */

const int = (fd: FormData, k: string) => {
  const v = str(fd, k).trim();
  return /^\d+$/.test(v) ? Number(v) : NaN;
};

/** Форма → настройки (строгая проверка — в пакете, `validateSettings`). */
export async function formToSettings(fd: FormData, base: SupportSettings): Promise<SupportSettings> {
  const week = { ...base.hours.week };
  for (const d of WEEKDAYS) {
    week[d] = fd.get(`hours.week.${d}.on`) === 'on' ? { open: str(fd, `hours.week.${d}.open`), close: str(fd, `hours.week.${d}.close`) } : null;
  }
  const categories = str(fd, 'categories')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const [key = '', ru = '', en = ''] = l.split('|').map((x) => x.trim());
      return { key, label: { ru: ru || key, en: en || ru || key } };
    });
  const texts = { ru: { ...base.texts.ru }, en: { ...base.texts.en } };
  for (const loc of ['ru', 'en'] as const) for (const k of TEXT_KEYS) texts[loc][k] = str(fd, `texts.${loc}.${k}`).replace(/\r\n/g, '\n');
  return {
    channels: {
      chat: fd.get('channels.chat') === 'on',
      webForm: fd.get('channels.webForm') === 'on',
      email: fd.get('channels.email') === 'on',
    },
    hours: {
      timezone: str(fd, 'hours.timezone').trim(),
      alwaysOpen: fd.get('hours.alwaysOpen') === 'on',
      week,
      holidays: str(fd, 'hours.holidays')
        .split(/[\s,]+/)
        .map((x) => x.trim())
        .filter(Boolean),
    },
    sla: {
      chatFirstResponseMinutes: int(fd, 'sla.chatFirstResponseMinutes'),
      emailFirstResponseMinutes: int(fd, 'sla.emailFirstResponseMinutes'),
      webFormFirstResponseMinutes: int(fd, 'sla.webFormFirstResponseMinutes'),
    },
    autoReply: { enabled: fd.get('autoReply.enabled') === 'on' },
    autoCloseDays: int(fd, 'autoCloseDays'),
    attachments: { maxBytes: Math.round(Number(str(fd, 'attachments.maxMb').replace(',', '.')) * 1024 * 1024) },
    limits: {
      chatMessagesPerMinute: int(fd, 'limits.chatMessagesPerMinute'),
      emailsPerSenderPerHour: int(fd, 'limits.emailsPerSenderPerHour'),
    },
    mail: { fromName: str(fd, 'mail.fromName').trim() },
    categories,
    texts,
  };
}

export async function saveSettingsAction(_prev: SupportActionState, fd: FormData): Promise<SupportActionState> {
  const actor = await actorOrLogin();
  const base = await loadSupportSettings(getPool());
  const next = await formToSettings(fd, base);
  const r = await saveSupportSettings(supportPool(), actor, next, str(fd, 'reason'));
  if (!r.ok) {
    const fields: Record<string, string> = {};
    for (const e of r.errors ?? []) fields[e.field] ??= e.code;
    return { error: r.reason, fields };
  }
  revalidatePath('/support', 'layout');
  return { ok: true };
}

/* ─── Шаблоны (admin) ───────────────────────────────────────────────── */

export async function saveTemplateAction(_prev: SupportActionState, fd: FormData): Promise<SupportActionState> {
  const actor = await actorOrLogin();
  // ── Перевод (ветка client-transfer): шаблоны — инструмент массовых ответов; упоминание
  //    другой платформы группы в шаблоне = предложение перевода, а перевод — только по
  //    инициативе клиента (решение юристов 10.11). Реестра нет (миграция не применена) — не мешаем. ──
  const platforms = await listGroupPlatforms(getPool()).catch(() => []);
  if (mentionsOtherPlatform(`${str(fd, 'title')}
${str(fd, 'body')}`, platforms, process.env.SITE_SLUG?.trim() ?? '')) {
    return { error: 'templateMentionsGroupPlatform' };
  }
  const r = await saveTemplate(supportPool(), actor, {
    id: str(fd, 'id') || null,
    key: str(fd, 'key').trim(),
    locale: str(fd, 'locale') === 'en' ? 'en' : 'ru',
    title: str(fd, 'title'),
    body: str(fd, 'body'),
    category: str(fd, 'category') || null,
    active: fd.get('active') === 'on',
  });
  if (!r.ok) return { error: r.reason };
  revalidatePath('/support/templates');
  return { ok: true };
}
