import type { StatusTone } from '@broker/ui';

/**
 * Человекочитаемые подписи действий журнала + тон точки в ленте (та же
 * семантика цвета, что у статус-бейджей, концепция §5). Один словарь для
 * дашборда, карточки клиента и раздела «Журнал». Неизвестное действие
 * показывается как есть — машинным кодом, без догадок.
 *
 * Каждому коду — группа (`group`): по ней раздел «Журнал» строит фильтр типа
 * действия (optgroup), а оператор видит, к какой области относится запись.
 * Новый код действия = одна строка здесь (тест `labels.test.ts` сверяет, что
 * у всех кодов, которые пишет код приложения, есть подпись).
 */

export type ActionGroup =
  | 'kyc'
  | 'aml'
  | 'access'
  | 'client_money'
  | 'deposit'
  | 'withdrawal'
  | 'leverage'
  | 'money_command'
  | 'operators'
  | 'platform'
  // ── Поддержка и auth-письма (ветка demo-support) ──
  | 'support'
  | 'client_auth';

/** Группы — в порядке вывода в фильтре. */
export const ACTION_GROUPS: { key: ActionGroup; label: string }[] = [
  { key: 'kyc', label: 'Верификация (KYC)' },
  { key: 'aml', label: 'AML-скрининг' },
  { key: 'access', label: 'Доступ клиента: блокировки и сессии' },
  { key: 'client_money', label: 'Денежные ограничения клиента' },
  { key: 'deposit', label: 'Пополнения USDT' },
  { key: 'withdrawal', label: 'Выводы USDT' },
  { key: 'leverage', label: 'Плечо и портфели' },
  { key: 'money_command', label: 'Денежные команды' },
  { key: 'operators', label: 'Операторы и вход' },
  { key: 'platform', label: 'Платформа и журнал' },
  // ── Поддержка и auth-письма (ветка demo-support) ──
  { key: 'support', label: 'Поддержка: обращения клиентов' },
  { key: 'client_auth', label: 'Вход клиента: сброс пароля и email' },
];

export interface ActionMeta {
  label: string;
  tone: StatusTone;
  group: ActionGroup;
}

export const ACTION_LABELS: Record<string, ActionMeta> = {
  // Верификация
  'client.verification.verified': { label: 'KYC подтверждён', tone: 'positive', group: 'kyc' },
  'client.verification.rejected': { label: 'KYC отклонён', tone: 'negative', group: 'kyc' },
  'client.verification.resubmit_requested': {
    label: 'Запрошена переподача KYC',
    tone: 'info',
    group: 'kyc',
  },
  'client.document.viewed': { label: 'Просмотр документа KYC', tone: 'neutral', group: 'kyc' },
  // Ранний формат записей решения KYC (до ADM-03) — могут встретиться в старых журналах.
  'client.verify': { label: 'KYC подтверждён (ранняя запись)', tone: 'positive', group: 'kyc' },
  'client.reject': { label: 'KYC отклонён (ранняя запись)', tone: 'negative', group: 'kyc' },

  // AML
  'client.aml_checked': { label: 'AML: совпадений нет', tone: 'positive', group: 'aml' },
  'client.aml_escalated': { label: 'AML: эскалация', tone: 'negative', group: 'aml' },
  'client.aml_escalation_cleared': {
    label: 'AML: эскалация снята',
    tone: 'positive',
    group: 'aml',
  },

  // Доступ клиента
  'client.block': { label: 'Клиент заблокирован', tone: 'negative', group: 'access' },
  'client.unblock': { label: 'Клиент разблокирован', tone: 'positive', group: 'access' },
  'client.sessions_revoked': {
    label: 'Сессии клиента погашены',
    tone: 'warning',
    group: 'access',
  },

  // Денежные ограничения клиента
  'client.money.frozen': { label: 'Счёт заморожен', tone: 'negative', group: 'client_money' },
  'client.money.unfrozen': { label: 'Заморозка снята', tone: 'positive', group: 'client_money' },
  'client.money.withdraw_banned': {
    label: 'Вывод запрещён',
    tone: 'negative',
    group: 'client_money',
  },
  'client.money.withdraw_unbanned': {
    label: 'Запрет вывода снят',
    tone: 'positive',
    group: 'client_money',
  },
  'client.money.deposit_kyc_changed': {
    label: 'Изменено правило пополнения (KYC)',
    tone: 'info',
    group: 'client_money',
  },
  'client.money.withdraw_kyc_changed': {
    label: 'Изменено правило вывода (KYC)',
    tone: 'info',
    group: 'client_money',
  },

  // Пополнения
  'crypto.deposit.claimed': { label: 'Пополнение заявлено', tone: 'info', group: 'deposit' },
  'crypto.deposit.credited': { label: 'Пополнение зачислено', tone: 'positive', group: 'deposit' },
  'crypto.deposit.rejected': { label: 'Пополнение отклонено', tone: 'negative', group: 'deposit' },
  'crypto.deposit.unidentified': {
    label: 'Неопознанное поступление',
    tone: 'warning',
    group: 'deposit',
  },
  'crypto.deposit.bound': {
    label: 'Поступление привязано к клиенту',
    tone: 'positive',
    group: 'deposit',
  },

  // Выводы
  'crypto.withdrawal.requested': { label: 'Заявка на вывод', tone: 'warning', group: 'withdrawal' },
  'crypto.withdrawal.debited': {
    label: 'Вывод: средства списаны со счёта',
    tone: 'info',
    group: 'withdrawal',
  },
  'crypto.withdrawal.needs_review': {
    label: 'Вывод на ручной проверке',
    tone: 'warning',
    group: 'withdrawal',
  },
  'crypto.withdrawal.approved': { label: 'Вывод одобрен', tone: 'info', group: 'withdrawal' },
  'crypto.withdrawal.sent': { label: 'Вывод отправлен в сеть', tone: 'info', group: 'withdrawal' },
  'crypto.withdrawal.settled': { label: 'Вывод исполнен', tone: 'positive', group: 'withdrawal' },
  'crypto.withdrawal.settled_manually': {
    label: 'Вывод отмечен исполненным вручную',
    tone: 'positive',
    group: 'withdrawal',
  },
  'crypto.withdrawal.rejected': { label: 'Вывод отклонён', tone: 'negative', group: 'withdrawal' },
  'crypto.withdrawal.cancelled': { label: 'Вывод отменён', tone: 'neutral', group: 'withdrawal' },
  'crypto.withdrawal.refused': {
    label: 'Терминал отказал в списании',
    tone: 'negative',
    group: 'withdrawal',
  },

  // Плечо
  'leverage.client_portfolio_set': {
    label: 'Клиенту назначен портфель',
    tone: 'info',
    group: 'leverage',
  },
  'leverage.override_set': {
    label: 'Клиенту выдано индивидуальное плечо',
    tone: 'warning',
    group: 'leverage',
  },
  'leverage.override_cleared': {
    label: 'Индивидуальное плечо снято',
    tone: 'neutral',
    group: 'leverage',
  },
  'leverage.portfolio_changed': {
    label: 'Изменено плечо портфеля',
    tone: 'warning',
    group: 'leverage',
  },
  'leverage.class_override_set': {
    label: 'Задана планка плеча по классу',
    tone: 'warning',
    group: 'leverage',
  },
  'leverage.class_override_cleared': {
    label: 'Планка плеча по классу снята',
    tone: 'neutral',
    group: 'leverage',
  },

  // Денежные команды (dual control)
  'money.command.initiated': {
    label: 'Денежная команда создана',
    tone: 'warning',
    group: 'money_command',
  },
  'money.command.second_approved': {
    label: 'Второе подтверждение команды',
    tone: 'positive',
    group: 'money_command',
  },
  'money.command.signed': { label: 'Команда подписана', tone: 'info', group: 'money_command' },
  'money.command.bootstrap_self_approval': {
    label: 'Самоподтверждение в режиме запуска',
    tone: 'warning',
    group: 'money_command',
  },
  'money.command.break_glass': {
    label: 'Аварийное исполнение (break-glass)',
    tone: 'negative',
    group: 'money_command',
  },
  'money.command.break_glass_reviewed': {
    label: 'Аварийное исполнение разобрано',
    tone: 'info',
    group: 'money_command',
  },

  // Операторы
  'operator.bootstrap': {
    label: 'Создан первый администратор',
    tone: 'info',
    group: 'operators',
  },
  'operator.created': { label: 'Заведён оператор', tone: 'info', group: 'operators' },
  'operator.disabled': { label: 'Оператор отключён', tone: 'negative', group: 'operators' },
  'operator.role_changed': {
    label: 'Изменена роль оператора',
    tone: 'warning',
    group: 'operators',
  },
  'operator.totp_enrolled': {
    label: 'Оператор включил 2FA',
    tone: 'positive',
    group: 'operators',
  },
  'operator.login': { label: 'Вход оператора', tone: 'neutral', group: 'operators' },

  // Платформа
  'platform.money_settings.updated': {
    label: 'Изменены денежные настройки платформы',
    tone: 'warning',
    group: 'platform',
  },
  'journal.exported': { label: 'Выгрузка журнала', tone: 'neutral', group: 'platform' },

  // ── Поддержка (ветка demo-support, 10.11). Текст ответов в журнал не пишется — sha256. ──
  'support.ticket.assigned': { label: 'Обращение назначено', tone: 'info', group: 'support' },
  'support.ticket.status_changed': { label: 'Статус обращения изменён', tone: 'info', group: 'support' },
  'support.ticket.marked_spam': { label: 'Обращение помечено как спам', tone: 'warning', group: 'support' },
  'support.ticket.linked_client': { label: 'Обращение привязано к клиенту', tone: 'info', group: 'support' },
  'support.ticket.auto_closed': { label: 'Обращение закрыто автоматически', tone: 'neutral', group: 'support' },
  'support.reply.sent': { label: 'Ответ клиенту отправлен', tone: 'positive', group: 'support' },
  'support.note.added': { label: 'Внутренняя заметка к обращению', tone: 'neutral', group: 'support' },
  'support.client_context.viewed': { label: 'Просмотр контекста клиента (поддержка)', tone: 'neutral', group: 'support' },
  'support.attachment.viewed': { label: 'Просмотр вложения обращения', tone: 'neutral', group: 'support' },
  'support.settings.updated': { label: 'Изменены настройки поддержки', tone: 'warning', group: 'support' },
  'support.template.saved': { label: 'Шаблон ответа сохранён', tone: 'info', group: 'support' },
  'support.template.deactivated': { label: 'Шаблон ответа выключен', tone: 'neutral', group: 'support' },
  'support.blocklist.added': { label: 'Отправитель добавлен в блок-лист', tone: 'warning', group: 'support' },
  'support.leads.recovered': { label: 'Восстановлены обращения с формы контактов', tone: 'info', group: 'support' },

  // ── Вход клиента: auth-письма (ветка demo-support) ──
  'auth.password_reset.requested': { label: 'Запрошен сброс пароля', tone: 'neutral', group: 'client_auth' },
  'auth.password_reset.completed': { label: 'Пароль сброшен, сессии погашены', tone: 'warning', group: 'client_auth' },
  'auth.email_verify.sent': { label: 'Отправлено письмо подтверждения email', tone: 'neutral', group: 'client_auth' },
  'auth.email_verify.confirmed': { label: 'Email подтверждён', tone: 'positive', group: 'client_auth' },
};

export function actionLabel(action: string): { label: string; tone: StatusTone } {
  const meta = ACTION_LABELS[action];
  return meta ? { label: meta.label, tone: meta.tone } : { label: action, tone: 'neutral' };
}

/** Группа действия; неизвестный код — `null` (в фильтре уходит в «Прочее»). */
export function actionGroup(action: string): ActionGroup | null {
  return ACTION_LABELS[action]?.group ?? null;
}

/** Род субъекта записи — по-русски (фильтр и колонка «Субъект»). */
export const SUBJECT_KIND_LABELS: Record<string, string> = {
  client: 'Клиент',
  operator: 'Оператор',
  crypto_deposit: 'Поступление USDT',
  leverage_portfolio: 'Портфель плеча',
  money_command: 'Денежная команда',
  platform: 'Платформа',
  journal: 'Журнал',
  // ── Поддержка (ветка demo-support) ──
  support_ticket: 'Обращение',
  support_template: 'Шаблон ответа',
};

export function subjectKindLabel(kind: string): string {
  return SUBJECT_KIND_LABELS[kind] ?? kind;
}

/** Субъекты с постоянным машинным id (не из справочников) — их имя. */
export const STATIC_SUBJECT_NAMES: Record<string, string> = {
  'platform:money_settings': 'Денежные настройки',
  // ── Поддержка (ветка demo-support) ──
  'platform:support:settings': 'Настройки поддержки',
  'platform:support:leads': 'Обращения с формы контактов',
};

/**
 * Основание из payload — его видно без раскрытия. Исторически ключ бывает
 * `basis` (новые записи) или `reason` (провижининг, плечо).
 */
export function basisOf(payload: Record<string, unknown>): string | null {
  const b = payload.basis ?? payload.reason;
  return typeof b === 'string' && b.trim().length > 0 ? b : null;
}
