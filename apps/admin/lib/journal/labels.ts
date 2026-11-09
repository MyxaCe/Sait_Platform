import type { StatusTone } from '@broker/ui';

/**
 * Человекочитаемые подписи действий журнала + тон точки в ленте (та же
 * семантика цвета, что у статус-бейджей, концепция §5). Один словарь для
 * дашборда, карточки клиента и (в фазе 2) раздела «Журнал». Неизвестное
 * действие показывается как есть — машинным кодом, без догадок.
 */
export const ACTION_LABELS: Record<string, { label: string; tone: StatusTone }> = {
  'client.block': { label: 'Клиент заблокирован', tone: 'negative' },
  'client.unblock': { label: 'Клиент разблокирован', tone: 'positive' },
  'client.sessions_revoked': { label: 'Сессии клиента погашены', tone: 'warning' },
  'client.document.viewed': { label: 'Просмотр документа KYC', tone: 'neutral' },
  'client.verification.verified': { label: 'KYC подтверждён', tone: 'positive' },
  'client.verification.rejected': { label: 'KYC отклонён', tone: 'negative' },
  'client.verification.resubmit_requested': { label: 'Запрошена переподача KYC', tone: 'info' },
  'client.aml_checked': { label: 'AML: совпадений нет', tone: 'positive' },
  'client.aml_escalated': { label: 'AML: эскалация', tone: 'negative' },
  'client.aml_escalation_cleared': { label: 'AML: эскалация снята', tone: 'positive' },
  'client.money.frozen': { label: 'Счёт заморожен', tone: 'negative' },
  'client.money.unfrozen': { label: 'Заморозка снята', tone: 'positive' },
  'client.money.withdraw_banned': { label: 'Вывод запрещён', tone: 'negative' },
  'client.money.withdraw_unbanned': { label: 'Запрет вывода снят', tone: 'positive' },
  'client.money.deposit_kyc_changed': { label: 'Изменено правило ввода (KYC)', tone: 'info' },
  'client.money.withdraw_kyc_changed': { label: 'Изменено правило вывода (KYC)', tone: 'info' },
  'crypto.deposit.claimed': { label: 'Депозит заявлен', tone: 'info' },
  'crypto.deposit.credited': { label: 'Депозит зачислен', tone: 'positive' },
  'crypto.deposit.rejected': { label: 'Депозит отклонён', tone: 'negative' },
  'crypto.deposit.unidentified': { label: 'Неопознанное поступление', tone: 'warning' },
  'crypto.deposit.bound': { label: 'Поступление привязано к клиенту', tone: 'positive' },
  'crypto.withdrawal.requested': { label: 'Заявка на вывод', tone: 'warning' },
  'crypto.withdrawal.debited': { label: 'Вывод: средства списаны', tone: 'info' },
  'crypto.withdrawal.needs_review': { label: 'Вывод на ручной проверке', tone: 'warning' },
  'crypto.withdrawal.approved': { label: 'Вывод одобрен', tone: 'info' },
  'crypto.withdrawal.sent': { label: 'Вывод отправлен', tone: 'info' },
  'crypto.withdrawal.settled': { label: 'Вывод исполнен', tone: 'positive' },
  'crypto.withdrawal.settled_manually': { label: 'Вывод отмечен исполненным', tone: 'positive' },
  'crypto.withdrawal.rejected': { label: 'Вывод отклонён', tone: 'negative' },
  'crypto.withdrawal.cancelled': { label: 'Вывод отменён', tone: 'neutral' },
  'crypto.withdrawal.refused': { label: 'Терминал отказал в списании', tone: 'negative' },
  'leverage.client_portfolio_set': { label: 'Назначен портфель плеча', tone: 'info' },
  'leverage.override_set': { label: 'Индивидуальное плечо', tone: 'warning' },
  'leverage.override_cleared': { label: 'Индивидуальное плечо снято', tone: 'neutral' },
  'leverage.portfolio_changed': { label: 'Изменён портфель плеча', tone: 'info' },
  'leverage.class_override_set': { label: 'Плечо по классу активов', tone: 'warning' },
  'leverage.class_override_cleared': { label: 'Плечо по классу снято', tone: 'neutral' },
  'platform.money_settings.updated': { label: 'Изменены денежные настройки', tone: 'warning' },
  'operator.bootstrap': { label: 'Создан первый администратор', tone: 'info' },
  'operator.created': { label: 'Создан оператор', tone: 'info' },
  'operator.disabled': { label: 'Оператор отключён', tone: 'negative' },
  'operator.role_changed': { label: 'Изменена роль оператора', tone: 'warning' },
  'operator.totp_enrolled': { label: 'Оператор включил 2FA', tone: 'positive' },
  'operator.login': { label: 'Вход оператора', tone: 'neutral' },
  'journal.exported': { label: 'Экспорт журнала', tone: 'neutral' },
  'money.command.initiated': { label: 'Денежная команда создана', tone: 'warning' },
  'money.command.second_approved': { label: 'Второе подтверждение', tone: 'positive' },
  'money.command.signed': { label: 'Команда подписана', tone: 'info' },
  'money.command.break_glass': { label: 'Break-glass', tone: 'negative' },
};

export function actionLabel(action: string): { label: string; tone: StatusTone } {
  return ACTION_LABELS[action] ?? { label: action, tone: 'neutral' };
}
