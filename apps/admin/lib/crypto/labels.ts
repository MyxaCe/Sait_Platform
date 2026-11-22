export const MONEY_ERRORS: Record<string, string> = {
  forbidden: 'Недостаточно прав для этого действия.',
  missingReason: 'Нужно указать основание.',
  noClient: 'Клиент не найден.',
  clientNotFound: 'Клиент не найден: укажите точный email, UID или id.',
  noChange: 'Изменений нет — нечего записывать.',
  invalidMinimum: 'Минимум — сумма в USDT, не больше двух знаков после запятой.',
  invalidPercent: 'Процент — число от 0 до 100, не больше двух знаков после запятой.',
  invalidStopBps: 'Расстояние — целое число б.п. от 0 до 10 000.',
  terminalUnavailable:
    'Терминал не ответил — ничего не изменено. Повторите позже (повтор безопасен).',
  terminalRefused: 'Терминал отказал',
  notUnidentified: 'Поступление уже не неопознанное (его заявили или привязали).',
  belowMinimum: 'Сумма меньше одного цента — зачислять нечего.',
  notFound: 'Заявка не найдена.',
  wrongState: 'Заявка уже в другом состоянии — обновите страницу.',
  debitPending:
    'Списание по заявке ещё не подтверждено терминалом. Повторите, когда терминал ответит.',
  invalidHash: 'Хэш транзакции — 64 шестнадцатеричных символа.',
  hashUsed: 'Этот хэш уже использован (другой выплатой или депозитом).',
  invalidDecision: 'Неизвестное действие.',
  missingBasis: 'Нужно указать основание.',
  forbiddenRole: 'Денежные команды создают только администратор и финансовый оператор.',
  invalidAmount: 'Сумма — положительное число USDT, не больше двух знаков после запятой.',
  signingKeyMissing:
    'Ключ подписи денежных команд не настроен на сервере — команду нельзя подписать. Ничего не создано.',
  selfApprovalForbidden: 'Подтвердить собственную команду нельзя — нужен другой оператор с правом.',
  secondApprovalRequired: 'Команде нужно второе подтверждение другим оператором.',
  illegalState: 'Команда уже в другом состоянии — обновите страницу.',
  unsupportedType: 'Этот тип денежной команды не исполняется из админки.',
  creditUnavailable:
    'Терминал не ответил — зачисление не подтверждено. Команда сохранена: повторите из истории зачислений, повтор не зачислит дважды.',
};

export function moneyErrorText(error: string, detail?: string): string {
  const base = MONEY_ERRORS[error] ?? 'Действие не выполнено.';
  return detail ? `${base}: ${detail}` : base;
}

export const DEPOSIT_STATUS: Record<string, string> = {
  claimed: 'Ждёт сети',
  credited: 'Зачислен',
  rejected: 'Отклонён',
  unidentified: 'Неопознанный',
};

export const DEPOSIT_REJECT: Record<string, string> = {
  wrong_recipient: 'не тот получатель',
  wrong_token: 'не USDT TRC20',
  failed: 'транзакция неуспешна',
  not_found: 'нет в сети',
  below_minimum: 'меньше минимума',
};

export const WITHDRAWAL_STATUS: Record<string, string> = {
  requested: 'Подана',
  approved: 'Одобрена',
  sent: 'Отправлена',
  settled: 'Исполнена',
  needs_review: 'На проверке',
  rejected: 'Отклонена',
  cancelled: 'Отменена',
};

export const DEBIT_STATE: Record<string, string> = {
  pending: 'списание не подтверждено',
  debited: 'списано',
  refused: 'терминал отказал',
};

export const POLICY_REASON: Record<string, string> = {
  no_client: 'клиента нет',
  blocked: 'клиент заблокирован',
  frozen: 'счёт заморожен',
  withdraw_banned: 'запрет вывода',
  kyc_required: 'нужна верификация (KYC)',
};

export function centsText(cents: number | null): string {
  if (cents === null) return '—';
  return `${(cents / 100).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDT`;
}
