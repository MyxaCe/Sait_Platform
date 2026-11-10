import type { StatusTone } from '@broker/ui';

/**
 * Подписи зоны «Акции и партнёры» (без БД — годятся и для клиентских
 * компонентов). Числа акций здесь не живут — только слова.
 */

export const PROMO_ERRORS: Record<string, string> = {
  forbidden: 'Недостаточно прав для этого действия.',
  missingReason: 'Нужно указать основание.',
  invalidSlug: 'Код акции: латиница в нижнем регистре, цифры и дефис, 2–63 символа.',
  slugTaken: 'Акция с таким кодом уже есть.',
  invalidTitle: 'Укажите название акции (до 200 символов).',
  invalidRules: 'Правила акции заполнены неверно',
  invalidTexts: 'Тексты для клиента заполнены неверно',
  invalidPeriod: 'Период указан неверно: конец должен быть позже начала (у конкурса оба обязательны).',
  invalidBudget: 'Бюджет — сумма в USDT, не меньше нуля.',
  budgetBelowSpent: 'Бюджет нельзя сделать меньше уже одобренных начислений.',
  invalidCountries: 'Страны — коды ISO из двух латинских букв через запятую (например CY, DE).',
  notFound: 'Не найдено — обновите страницу.',
  notEditable: 'Изменять можно только черновик или акцию на паузе.',
  noChange: 'Изменений нет — нечего записывать.',
  wrongTransition: 'Такой переход статуса недоступен.',
  referralAlreadyActive: 'Уже идёт другая реферальная акция — сначала поставьте её на паузу или завершите.',
  wrongState: 'Начисление уже в другом состоянии — обновите страницу.',
  budgetExceeded: 'Бюджет акции исчерпан — начисление не одобрено, деньги не двигались.',
  promotionMissing: 'Акция начисления не найдена.',
  invalidPeriodValue: 'Период — месяц в формате ГГГГ-ММ.',
  periodOpen: 'Месяц ещё не закончился — начислять за него рано.',
  platformDisabled: 'Акции выключены в настройках платформы.',
  wrongType: 'Действие не подходит для этого типа.',
  badRules: 'Правила акции испорчены — исправьте их в форме изменения.',
  notFinished: 'Конкурс ещё не закончился.',
  alreadyFinal: 'Итоги уже подведены.',
  refereeNotFound: 'Клиент не найден.',
  referrerNotFound: 'Реферер не найден: укажите точный email, UID или id.',
  selfReferral: 'Клиент не может быть реферером сам себе.',
  clientNotFound: 'Клиент не найден: укажите точный email, UID или id.',
  invalidName: 'Укажите имя партнёра.',
  invalidModel: 'Параметры модели: CPA — сумма больше нуля, revshare — доля 0,01–100 %.',
  alreadyPartner: 'Этот клиент уже партнёр.',
  invalidWindow: 'Срок атрибуции — целое число дней от 1 до 365.',
  invalidFees: 'Ставки — целые базисные пункты от 0 до 500.',
  invalidAmount: 'Сумма в USDT, не больше двух знаков после запятой.',
  terminalUnavailable: 'Терминал не ответил — ничего не изменено. Повторите позже (повтор безопасен).',
  terminalRefused: 'Терминал отказал',
  noPortfolio: 'Портфель не найден.',
};

export function promoErrorText(error: string, detail?: string): string {
  const base = PROMO_ERRORS[error] ?? 'Действие не выполнено.';
  return detail ? `${base}: ${detail}` : base;
}

export const TYPE_LABELS: Record<string, string> = {
  deposit_bonus: 'Бонус на депозит',
  cashback: 'Кешбэк',
  contest: 'Конкурс на демо',
  referral: 'Пригласи друга',
};

export const PROMO_STATUS: Record<string, { label: string; tone: StatusTone }> = {
  draft: { label: 'Черновик', tone: 'neutral' },
  active: { label: 'Идёт', tone: 'positive' },
  paused: { label: 'На паузе', tone: 'warning' },
  ended: { label: 'Завершена', tone: 'neutral' },
};

export const REWARD_STATUS: Record<string, { label: string; tone: StatusTone }> = {
  pending: { label: 'Ждёт решения', tone: 'warning' },
  approved: { label: 'Зачисляется', tone: 'info' },
  credited: { label: 'Зачислено', tone: 'positive' },
  needs_review: { label: 'Отказ терминала', tone: 'warning' },
  rejected: { label: 'Отклонено', tone: 'negative' },
};

export const REWARD_KIND: Record<string, string> = {
  promo: 'Бонус',
  referral: 'Реферал',
  cashback: 'Кешбэк',
  contest: 'Приз конкурса',
  ib: 'IB-выплата',
};

export const PARTICIPATION_STATUS: Record<string, { label: string; tone: StatusTone }> = {
  enrolled: { label: 'Выполняет', tone: 'info' },
  qualified: { label: 'Выполнил', tone: 'warning' },
  rewarded: { label: 'Начислено', tone: 'positive' },
  expired: { label: 'Истекло', tone: 'neutral' },
  rejected: { label: 'Отклонено', tone: 'negative' },
  not_eligible: { label: 'Не подходит', tone: 'neutral' },
};

export const CONDITION_LABELS: Record<string, string> = {
  deposit: 'Депозит',
  kyc: 'KYC',
  turnover: 'Оборот',
  no_withdrawal: 'Без вывода',
  window: 'Срок',
};

export const SIGNAL_LABELS: Record<string, string> = {
  shared_deposit_wallet: 'Общий кошелёк-отправитель',
  shared_withdraw_address: 'Общий адрес вывода',
  shared_ip: 'Общий IP',
  self_referral: 'Самореферал',
  country_mismatch: 'Страна ≠ страна IP',
  budget_insufficient: 'Не хватает бюджета',
};

/** Короткие подписи сигналов — для плотных таблиц. */
export const SIGNAL_SHORT: Record<string, string> = {
  shared_deposit_wallet: 'Общий кошелёк',
  shared_withdraw_address: 'Общий адрес вывода',
  shared_ip: 'Общий IP',
  self_referral: 'Самореферал',
  country_mismatch: 'Страна ≠ IP',
  budget_insufficient: 'Мало бюджета',
};

export const ATTRIBUTION_STATUS: Record<string, { label: string; tone: StatusTone }> = {
  active: { label: 'Действует', tone: 'positive' },
  rejected: { label: 'Отсечена', tone: 'negative' },
  revoked: { label: 'Снята', tone: 'neutral' },
};

export const ATTRIBUTION_SOURCE: Record<string, string> = {
  cookie: 'ссылка (cookie)',
  param: 'параметр регистрации',
  manual: 'вручную',
};

export const SELF_REFERRAL_REASON: Record<string, string> = {
  same_ip: 'общий IP с реферером',
  same_email: 'тот же email',
};

export const CONTEST_PHASE: Record<string, { label: string; tone: StatusTone }> = {
  draft: { label: 'Черновик', tone: 'neutral' },
  upcoming: { label: 'Скоро старт', tone: 'info' },
  running: { label: 'Идёт', tone: 'positive' },
  finished: { label: 'Ждёт итогов', tone: 'warning' },
  finalized: { label: 'Итоги подведены', tone: 'neutral' },
};

export const INELIGIBLE: Record<string, string> = {
  pending_reset: 'ждёт сброса демо',
  disqualified: 'дисквалифицирован',
  withdrawn: 'вышел',
  min_trades: 'мало сделок',
};

/** Базисные пункты → «30 %», «0,15 %». */
export function bpsText(bps: number): string {
  return `${(bps / 100).toLocaleString('ru-RU', { maximumFractionDigits: 2 })} %`;
}
