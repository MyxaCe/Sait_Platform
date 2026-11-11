/**
 * Правка учётных данных клиента (функция 3, решения владельца 10.11) — общие
 * правила и форматы. Client-safe: без `pg` и `node:*` (используется формами).
 *
 * Модель владельца: правку проводит сам менеджер клиента (или admin), без
 * второго утверждающего. Обязательны основание и чек-лист проверки личности;
 * номер тикета поддержки — поле, не блокирующее действие. Журнал хранит
 * значения до/после ТОЛЬКО маскированно: он неизменяем, стереть из него
 * персональные данные нельзя.
 */

/** Коды журнала правки учётных данных (подписи — блок в `lib/journal/labels.ts`). */
export const CREDENTIAL_ACTIONS = {
  emailChanged: 'client.credentials.email_changed',
  resetLinkSent: 'client.credentials.password_reset_link_sent',
  tempPasswordIssued: 'client.credentials.temp_password_issued',
  withdrawalAddressChanged: 'client.credentials.withdrawal_address_changed',
  holdSet: 'client.credentials.withdraw_hold_set',
  holdAutoSet: 'client.credentials.withdraw_hold_auto_set',
  holdLifted: 'client.credentials.withdraw_hold_lifted',
  /** Клиент сменил временный пароль при входе (пишет кабинет от system:cabinet). */
  tempPasswordReplaced: 'client.credentials.temp_password_replaced',
  settingsUpdated: 'platform.credential_settings.updated',
} as const;

/** Префикс всех правок — фильтр журнала «правки учётных данных». */
export const CREDENTIAL_ACTION_PREFIX = 'client.credentials.';

/**
 * Что считается «правкой» для счётчика необычной активности: действия,
 * повышающие риск захвата счёта. Заморозка вывода риск снижает — не считается.
 */
export const RISKY_CREDENTIAL_ACTIONS: readonly string[] = [
  CREDENTIAL_ACTIONS.emailChanged,
  CREDENTIAL_ACTIONS.resetLinkSent,
  CREDENTIAL_ACTIONS.tempPasswordIssued,
  CREDENTIAL_ACTIONS.withdrawalAddressChanged,
  CREDENTIAL_ACTIONS.holdLifted,
];

/** Заявки на вывод, в которых можно исправить адрес: ещё не отправлены в сеть. */
export const EDITABLE_WITHDRAWAL_STATUSES = ['requested', 'approved'] as const;

export function isEditableWithdrawal(w: { status: string; payoutTxHash: string | null }): boolean {
  return (EDITABLE_WITHDRAWAL_STATUSES as readonly string[]).includes(w.status) && !w.payoutTxHash;
}

/* ─── Маскирование ───────────────────────────────────────────────────── */

/** `anna.k@gmail.com` → `a***@g***.com`. Пустое/кривое — `***`. */
export function maskEmail(email: string | null | undefined): string {
  const v = String(email ?? '').trim();
  const at = v.lastIndexOf('@');
  if (at <= 0 || at === v.length - 1) return '***';
  const local = v.slice(0, at);
  const domain = v.slice(at + 1);
  const dot = domain.lastIndexOf('.');
  const tld = dot > 0 ? domain.slice(dot + 1) : '';
  return `${local[0]}***@${domain[0]}***${tld ? `.${tld}` : ''}`;
}

/** Адрес TRON → `TXXXX…XXXX` (первые 5 и последние 4 символа). */
export function maskAddress(address: string | null | undefined): string {
  const v = String(address ?? '').trim();
  if (v.length <= 9) return v ? `${v[0]}…` : '***';
  return `${v.slice(0, 5)}…${v.slice(-4)}`;
}

/* ─── Настройки и чек-лист ───────────────────────────────────────────── */

export interface ChecklistItem {
  id: string;
  label: string;
  /** Обязательный пункт: без его отметки правка не проводится. */
  required: boolean;
}

export interface CredentialSettings {
  checklist: ChecklistItem[];
  /** Минимум отмеченных пунктов (обязательные входят в счёт). */
  minChecked: number;
  autoHoldEnabled: boolean;
  autoHoldHours: number;
  /** Алерт: больше N правок одним оператором за сутки. */
  alertPerOperatorDay: number;
  tempPasswordHours: number;
}

export const DEFAULT_CREDENTIAL_SETTINGS: CredentialSettings = {
  checklist: [
    { id: 'video_call', label: 'Видеозвонок: лицо сверено с селфи и документом KYC', required: false },
    { id: 'document_match', label: 'Документ клиента совпадает с данными KYC (тип, номер, срок)', required: false },
    { id: 'account_questions', label: 'Ответы о счёте: сумма и дата последнего депозита, дата регистрации', required: false },
    { id: 'known_channel', label: 'Обращение с известного канала (прежний email, телефон, страна входа)', required: false },
  ],
  minChecked: 1,
  autoHoldEnabled: true,
  autoHoldHours: 24,
  alertPerOperatorDay: 5,
  tempPasswordHours: 24,
};

export const CHECKLIST_MAX_ITEMS = 12;
export const CHECKLIST_LABEL_MAX = 200;

/** Чек-лист из JSONB: мусор отбрасывается, id уникальны. */
export function parseChecklist(raw: unknown): ChecklistItem[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: ChecklistItem[] = [];
  for (const x of raw) {
    if (!x || typeof x !== 'object') continue;
    const o = x as Record<string, unknown>;
    const id = typeof o.id === 'string' ? o.id.trim() : '';
    const label = typeof o.label === 'string' ? o.label.trim() : '';
    if (!id || !label || seen.has(id) || !/^[a-z0-9_-]{1,40}$/.test(id)) continue;
    seen.add(id);
    out.push({ id, label: label.slice(0, CHECKLIST_LABEL_MAX), required: o.required === true });
    if (out.length >= CHECKLIST_MAX_ITEMS) break;
  }
  return out;
}

/**
 * Чек-лист из текста формы настроек: пункт на строку, `*` в начале —
 * обязательный. id стабилен для уже существующих формулировок (отметки в
 * журнале остаются сопоставимыми), новым пунктам — `item_N`.
 */
export function checklistFromText(text: string, previous: ChecklistItem[]): ChecklistItem[] {
  const byLabel = new Map(previous.map((i) => [i.label, i.id]));
  const used = new Set<string>();
  const out: ChecklistItem[] = [];
  let n = 1;
  for (const line of text.split(/\r?\n/)) {
    let label = line.trim();
    if (!label) continue;
    const required = label.startsWith('*');
    if (required) label = label.slice(1).trim();
    if (!label) continue;
    label = label.slice(0, CHECKLIST_LABEL_MAX);
    let id = byLabel.get(label);
    if (!id || used.has(id)) {
      do id = `item_${n++}`;
      while (used.has(id) || previous.some((p) => p.id === id && p.label !== label));
    }
    used.add(id);
    out.push({ id, label, required });
    if (out.length >= CHECKLIST_MAX_ITEMS) break;
  }
  return out;
}

export function checklistToText(items: ChecklistItem[]): string {
  return items.map((i) => `${i.required ? '* ' : ''}${i.label}`).join('\n');
}

export type ChecklistVerdict =
  | { ok: true; marks: { id: string; label: string; checked: boolean }[] }
  | { ok: false; reason: 'checklistRequired' | 'checklistIncomplete' };

/**
 * Отметки менеджера против настроек. В журнал уходит снимок ВСЕХ пунктов с
 * формулировкой на момент правки (настройки потом могут измениться).
 */
export function evaluateChecklist(settings: CredentialSettings, checkedIds: readonly string[]): ChecklistVerdict {
  const checked = new Set(checkedIds);
  const marks = settings.checklist.map((i) => ({ id: i.id, label: i.label, checked: checked.has(i.id) }));
  if (settings.checklist.some((i) => i.required && !checked.has(i.id))) return { ok: false, reason: 'checklistIncomplete' };
  const need = Math.min(settings.minChecked, settings.checklist.length);
  if (marks.filter((m) => m.checked).length < need) return { ok: false, reason: 'checklistRequired' };
  return { ok: true, marks };
}

/** Номер тикета поддержки: необязателен; `#1234` → `1234`; длина ограничена. */
export function normalizeTicket(raw: string | null | undefined): string | null {
  const v = String(raw ?? '').trim().replace(/^#/, '').slice(0, 64);
  return v ? v : null;
}

/** Сообщения форм (ошибки действий) — один словарь на все формы вкладки. */
export const CREDENTIAL_ERRORS: Record<string, string> = {
  forbidden: 'Недостаточно прав: править учётные данные может менеджер этого клиента или администратор.',
  noClient: 'Клиент не найден.',
  missingReason: 'Нужно указать основание.',
  checklistRequired: 'Отметьте пункты проверки личности — сколько требуют настройки платформы.',
  checklistIncomplete: 'Не отмечены обязательные пункты проверки личности.',
  invalidEmail: 'Это не похоже на email.',
  sameEmail: 'Новый email совпадает с текущим.',
  emailTaken: 'Этот email уже занят другим клиентом.',
  linkUnavailable: 'Не задан адрес кабинета (CABINET_PUBLIC_URL) — письмо со ссылкой отправить нельзя.',
  rateLimited: 'Слишком много писем сброса за час на этот адрес — попробуйте позже.',
  invalidAddress: 'Адрес TRON неверен: 34 символа, начинается с T, контрольная сумма должна сходиться.',
  contractAddress: 'Это адрес контракта USDT, а не кошелёк: средства, отправленные на него, сгорят.',
  sameAddress: 'Новый адрес совпадает с текущим.',
  noWithdrawal: 'Заявка на вывод не найдена у этого клиента.',
  withdrawalNotEditable: 'Адрес можно исправить только в заявке «подана» или «одобрена», пока нет хэша отправки.',
  invalidUntil: 'Срок заморозки должен быть в будущем (не дальше года).',
  bannedByFinance: 'У клиента уже действует «Запрет вывода» из денежных флагов — его снимают финансы во вкладке «Деньги».',
  noHold: 'Действующей заморозки вывода нет.',
  notCredentialsHold: 'Этот запрет вывода поставлен в денежных флагах — снять его можно только там (финансы, администратор).',
  invalidSettings: 'Настройки не сохранены: проверьте значения.',
  noChange: 'Изменений нет.',
  journalUnavailable: 'Журнал недоступен — действие не выполнено и не записано.',
};

export function credentialErrorText(error: string, detail?: string): string {
  const base = CREDENTIAL_ERRORS[error] ?? 'Действие не выполнено.';
  return detail ? `${base}: ${detail}` : base;
}
