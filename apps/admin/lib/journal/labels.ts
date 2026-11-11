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
  | 'promo'
  | 'referral'
  | 'contest'
  | 'cashback'
  | 'ib'
  | 'platform'
  // ── Поддержка и auth-письма (ветка demo-support) ──
  | 'support'
  | 'client_auth'
  // ── Менеджеры клиентов (ветка admin-managers) ──
  | 'managers'
  // ── Учётные данные клиента (ветка admin-credentials) ──
  | 'credentials'
  // ── Переводы клиентов между платформами группы (ветка client-transfer) ──
  | 'transfers';

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
  { key: 'promo', label: 'Акции и бонусы' },
  { key: 'referral', label: 'Рефералы' },
  { key: 'contest', label: 'Конкурсы' },
  { key: 'cashback', label: 'Кешбэк' },
  { key: 'ib', label: 'IB-партнёры' },
  { key: 'platform', label: 'Платформа и журнал' },
  // ── Поддержка и auth-письма (ветка demo-support) ──
  { key: 'support', label: 'Поддержка: обращения клиентов' },
  { key: 'client_auth', label: 'Вход клиента: сброс пароля и email' },
  // ── Менеджеры клиентов (ветка admin-managers) ──
  { key: 'managers', label: 'Менеджеры клиентов' },
  // ── Учётные данные клиента (ветка admin-credentials) ──
  { key: 'credentials', label: 'Учётные данные клиента: email, пароль, адрес вывода' },
  // ── Переводы клиентов между платформами группы (ветка client-transfer) ──
  { key: 'transfers', label: 'Переводы клиентов между платформами' },
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

  'leverage.portfolio_fees_changed': { label: 'Изменён тариф портфеля (наценка/комиссия)', tone: 'warning', group: 'leverage' },

  // Акции
  'promo.created': { label: 'Создана акция', tone: 'info', group: 'promo' },
  'promo.updated': { label: 'Изменены условия акции', tone: 'warning', group: 'promo' },
  'promo.activated': { label: 'Акция запущена', tone: 'positive', group: 'promo' },
  'promo.paused': { label: 'Акция на паузе', tone: 'warning', group: 'promo' },
  'promo.ended': { label: 'Акция завершена', tone: 'neutral', group: 'promo' },
  'promo.enrolled': { label: 'Клиент вступил в акцию', tone: 'info', group: 'promo' },
  'promo.participation_expired': { label: 'Участие в акции истекло', tone: 'neutral', group: 'promo' },
  'promo.queue_synced': { label: 'Пересчитана очередь начислений', tone: 'neutral', group: 'promo' },

  // Бонусы акций
  'promo.reward.queued': { label: 'Бонус: к начислению', tone: 'warning', group: 'promo' },
  'promo.reward.approved': { label: 'Бонус одобрен', tone: 'info', group: 'promo' },
  'promo.reward.credited': { label: 'Бонус зачислен', tone: 'positive', group: 'promo' },
  'promo.reward.needs_review': { label: 'Бонус: терминал отказал', tone: 'warning', group: 'promo' },
  'promo.reward.rejected': { label: 'Бонус отклонён', tone: 'negative', group: 'promo' },

  // Рефералы
  'referral.attributed': { label: 'Клиент привязан к рефереру', tone: 'info', group: 'referral' },
  'referral.attribution_rejected': { label: 'Самореферал отсечён', tone: 'negative', group: 'referral' },
  'referral.attribution.reassigned': { label: 'Реферер переназначен', tone: 'warning', group: 'referral' },
  'referral.attribution.revoked': { label: 'Атрибуция снята', tone: 'neutral', group: 'referral' },
  'referral.reward.queued': { label: 'Реферальная награда: к начислению', tone: 'warning', group: 'referral' },
  'referral.reward.approved': { label: 'Реферальная награда одобрена', tone: 'info', group: 'referral' },
  'referral.reward.credited': { label: 'Реферальная награда зачислена', tone: 'positive', group: 'referral' },
  'referral.reward.needs_review': { label: 'Реферальная награда: терминал отказал', tone: 'warning', group: 'referral' },
  'referral.reward.rejected': { label: 'Реферальная награда отклонена', tone: 'negative', group: 'referral' },

  // Кешбэк
  'cashback.period_accrued': { label: 'Кешбэк за период рассчитан', tone: 'info', group: 'cashback' },
  'cashback.reward.queued': { label: 'Кешбэк: к начислению', tone: 'warning', group: 'cashback' },
  'cashback.reward.approved': { label: 'Кешбэк одобрен', tone: 'info', group: 'cashback' },
  'cashback.reward.credited': { label: 'Кешбэк зачислен', tone: 'positive', group: 'cashback' },
  'cashback.reward.needs_review': { label: 'Кешбэк: терминал отказал', tone: 'warning', group: 'cashback' },
  'cashback.reward.rejected': { label: 'Кешбэк отклонён', tone: 'negative', group: 'cashback' },

  // Конкурсы
  'contest.joined': { label: 'Клиент вступил в конкурс', tone: 'info', group: 'contest' },
  'contest.join_failed': { label: 'Вступление в конкурс не удалось', tone: 'neutral', group: 'contest' },
  'contest.finalized': { label: 'Итоги конкурса подведены', tone: 'positive', group: 'contest' },
  'contest.prize.queued': { label: 'Приз конкурса: к начислению', tone: 'warning', group: 'contest' },
  'contest.prize.approved': { label: 'Приз конкурса одобрен', tone: 'info', group: 'contest' },
  'contest.prize.credited': { label: 'Приз конкурса зачислен', tone: 'positive', group: 'contest' },
  'contest.prize.needs_review': { label: 'Приз конкурса: терминал отказал', tone: 'warning', group: 'contest' },
  'contest.prize.rejected': { label: 'Приз конкурса отклонён', tone: 'negative', group: 'contest' },

  // IB-партнёры
  'ib.partner.created': { label: 'Заведён IB-партнёр', tone: 'info', group: 'ib' },
  'ib.partner.updated': { label: 'Изменены условия IB-партнёра', tone: 'warning', group: 'ib' },
  'ib.revshare_accrued': { label: 'Рассчитана доля IB за период', tone: 'info', group: 'ib' },
  'ib.payout.queued': { label: 'IB-выплата: к начислению', tone: 'warning', group: 'ib' },
  'ib.payout.approved': { label: 'IB-выплата одобрена', tone: 'info', group: 'ib' },
  'ib.payout.credited': { label: 'IB-выплата зачислена', tone: 'positive', group: 'ib' },
  'ib.payout.needs_review': { label: 'IB-выплата: терминал отказал', tone: 'warning', group: 'ib' },
  'ib.payout.rejected': { label: 'IB-выплата отклонена', tone: 'negative', group: 'ib' },

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
  'platform.promo_settings.updated': {
    label: 'Изменены настройки акций платформы',
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

  // ── Менеджеры клиентов (ветка admin-managers, 10.11). Payload: basis, managerId/Name,
  //    previousManagerId/Name, при массовом назначении — bulk + batchSize. ──
  'client.manager_assigned': { label: 'Клиенту назначен менеджер', tone: 'info', group: 'managers' },
  'client.manager_unassigned': { label: 'Менеджер клиента снят', tone: 'neutral', group: 'managers' },
  'operator.client_manager_granted': { label: 'Оператор стал менеджером клиентов', tone: 'info', group: 'managers' },
  'operator.client_manager_revoked': { label: 'Снят флаг «менеджер клиентов»', tone: 'neutral', group: 'managers' },

  // ── Учётные данные клиента (ветка admin-credentials, 10.11). Правку проводит менеджер
  //    клиента или admin. Payload: basis, ticket, checklist (снимок пунктов и отметок),
  //    actorAs; до/после — ТОЛЬКО маскированно (email a***@d***.com, адрес TXXXX…XXXX). ──
  'client.credentials.email_changed': { label: 'Email клиента изменён', tone: 'warning', group: 'credentials' },
  'client.credentials.password_reset_link_sent': {
    label: 'Ссылка сброса пароля отправлена клиенту',
    tone: 'info',
    group: 'credentials',
  },
  'client.credentials.temp_password_issued': {
    label: 'Выдан временный пароль, сессии погашены',
    tone: 'warning',
    group: 'credentials',
  },
  'client.credentials.temp_password_replaced': {
    label: 'Клиент сменил временный пароль',
    tone: 'positive',
    group: 'credentials',
  },
  'client.credentials.withdrawal_address_changed': {
    label: 'Адрес в заявке на вывод исправлен',
    tone: 'warning',
    group: 'credentials',
  },
  'client.credentials.withdraw_hold_set': { label: 'Вывод заморожен менеджером', tone: 'negative', group: 'credentials' },
  'client.credentials.withdraw_hold_auto_set': {
    label: 'Автозаморозка вывода после правки данных',
    tone: 'negative',
    group: 'credentials',
  },
  'client.credentials.withdraw_hold_lifted': { label: 'Заморозка вывода снята', tone: 'positive', group: 'credentials' },
  'platform.credential_settings.updated': {
    label: 'Изменены настройки безопасности учётных данных',
    tone: 'info',
    group: 'platform',
  },
  // ── Переводы клиентов между платформами группы (ветка client-transfer, 10.11). Коды —
  //    TRANSFER_ACTIONS в @broker/transfer. Общий номер перевода (payload.number) связывает
  //    записи источника и цели. ──
  // источник
  'client.transfer.sent': { label: 'Перевод на другую платформу проведён менеджером', tone: 'warning', group: 'transfers' },
  'client.transfer.delivered': { label: 'Перевод: пакет принят платформой-целью', tone: 'info', group: 'transfers' },
  'client.transfer.refused': { label: 'Перевод: платформа-цель отказала', tone: 'negative', group: 'transfers' },
  'client.transfer.target_invited': { label: 'Перевод: цель отправила приглашение', tone: 'info', group: 'transfers' },
  'client.transfer.target_registered': { label: 'Перевод: клиент зарегистрировался в цели', tone: 'info', group: 'transfers' },
  'client.transfer.target_kyc_passed': { label: 'Перевод: клиент прошёл KYC в цели', tone: 'positive', group: 'transfers' },
  'client.transfer.target_expired': { label: 'Перевод: приглашение истекло', tone: 'neutral', group: 'transfers' },
  'client.transfer.source_closed': { label: 'Счёт закрыт по переводу', tone: 'warning', group: 'transfers' },
  'client.transfer.revoked': { label: 'Перевод возвращён администратором', tone: 'negative', group: 'transfers' },
  'client.transfer.revoke_applied': { label: 'Перевод: цель подтвердила возврат', tone: 'info', group: 'transfers' },
  'client.transfer.source_restored': { label: 'Перевод: клиент восстановлен (торговля разморожена)', tone: 'positive', group: 'transfers' },
  'client.transfer.delivery_retried': { label: 'Перевод: доставка запущена повторно', tone: 'neutral', group: 'transfers' },
  'client.transfer.reviewed': { label: 'Переводы просмотрены администратором', tone: 'neutral', group: 'transfers' },
  // цель
  'client.transfer.received': { label: 'Входящий перевод принят', tone: 'info', group: 'transfers' },
  'client.transfer.invite_queued': { label: 'Входящий перевод: письмо-приглашение в очереди', tone: 'neutral', group: 'transfers' },
  'client.transfer.invited': { label: 'Входящий перевод: приглашение отправлено', tone: 'info', group: 'transfers' },
  'client.transfer.registered': { label: 'Клиент зарегистрировался по приглашению перевода', tone: 'positive', group: 'transfers' },
  'client.transfer.kyc_passed': { label: 'Входящий перевод: KYC пройден', tone: 'positive', group: 'transfers' },
  'client.transfer.expired': { label: 'Входящий перевод: приглашение истекло', tone: 'neutral', group: 'transfers' },
  'client.transfer.invite_revoked': { label: 'Входящий перевод отозван — приглашение недействительно', tone: 'negative', group: 'transfers' },
  'client.transfer.revoked_by_group': { label: 'Перевод отозван группой — счёт заморожен', tone: 'negative', group: 'transfers' },
  'client.transfer.refund_task_done': { label: 'Средства по отозванному переводу возвращены', tone: 'positive', group: 'transfers' },
  // канал и реестр
  'platform.transfer_channel.refused': { label: 'Межплатформенное сообщение отвергнуто получателем', tone: 'negative', group: 'transfers' },
  'platform.group_registry.upserted': { label: 'Изменён реестр платформ группы', tone: 'warning', group: 'transfers' },
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
  promotion: 'Акция',
  ib_partner: 'IB-партнёр',
  platform: 'Платформа',
  journal: 'Журнал',
  // ── Поддержка (ветка demo-support) ──
  support_ticket: 'Обращение',
  support_template: 'Шаблон ответа',
  // ── Переводы клиентов (ветка client-transfer) ──
  platform_transfer: 'Перевод между платформами',
};

export function subjectKindLabel(kind: string): string {
  return SUBJECT_KIND_LABELS[kind] ?? kind;
}

/** Субъекты с постоянным машинным id (не из справочников) — их имя. */
export const STATIC_SUBJECT_NAMES: Record<string, string> = {
  'platform:money_settings': 'Денежные настройки',
  'platform:promo_settings': 'Настройки акций',
  'platform:promo_queue': 'Очередь начислений',
  // ── Поддержка (ветка demo-support) ──
  'platform:support:settings': 'Настройки поддержки',
  'platform:support:leads': 'Обращения с формы контактов',
  // ── Учётные данные клиента (ветка admin-credentials) ──
  'platform:credential_settings': 'Безопасность учётных данных',
  // ── Переводы клиентов (ветка client-transfer) ──
  'platform:transfers': 'Переводы клиентов',
};

/**
 * Основание из payload — его видно без раскрытия. Исторически ключ бывает
 * `basis` (новые записи) или `reason` (провижининг, плечо).
 */
export function basisOf(payload: Record<string, unknown>): string | null {
  const b = payload.basis ?? payload.reason;
  return typeof b === 'string' && b.trim().length > 0 ? b : null;
}
