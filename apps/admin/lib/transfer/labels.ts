import type { StatusTone } from '@broker/ui';

/** Подписи перевода между платформами группы (статусы, подсказки, ошибки). */

export const TRANSFER_STATUS: Record<string, { label: string; tone: StatusTone }> = {
  sent: { label: 'Отправлен, ждёт доставки', tone: 'info' },
  delivered: { label: 'Принят целью', tone: 'info' },
  invited: { label: 'Приглашение отправлено', tone: 'info' },
  registered: { label: 'Клиент зарегистрировался', tone: 'info' },
  kyc_passed: { label: 'KYC в цели пройден', tone: 'positive' },
  source_closed: { label: 'Счёт здесь закрыт', tone: 'positive' },
  refused: { label: 'Цель отказала', tone: 'negative' },
  expired: { label: 'Приглашение истекло', tone: 'neutral' },
  revoked: { label: 'Возвращён', tone: 'negative' },
};

export const INBOUND_STATUS: Record<string, { label: string; tone: StatusTone }> = {
  received: { label: 'Принят, письмо в очереди', tone: 'info' },
  invited: { label: 'Приглашение отправлено', tone: 'info' },
  registered: { label: 'Зарегистрировался', tone: 'info' },
  kyc_passed: { label: 'KYC пройден', tone: 'positive' },
  expired: { label: 'Истекло', tone: 'neutral' },
  revoked: { label: 'Отозван группой', tone: 'negative' },
};

export function transferStatus(s: string): { label: string; tone: StatusTone } {
  return TRANSFER_STATUS[s] ?? { label: s, tone: 'neutral' };
}
export function inboundStatus(s: string): { label: string; tone: StatusTone } {
  return INBOUND_STATUS[s] ?? { label: s, tone: 'neutral' };
}

export const HINT_TEXT: Record<string, string> = {
  euResidentNonEuTarget:
    'Клиент — резидент ЕС/ЕЭЗ, у цели нет лицензии ЕС: допустима только исключительная инициатива клиента (reverse solicitation). Заявление должно быть однозначным.',
  leverageHigher: 'Плечо для розницы в цели выше, чем здесь.',
  bonusesInTarget: 'В цели разрешены бонусы, здесь — нет.',
  sourceKycNotVerified: 'KYC клиента здесь не подтверждён (в цели он всё равно проходит KYC заново).',
  countryUnknownSoft: 'Страна клиента не указана — запрет по стране не проверен.',
};

export const BLOCKER_TEXT: Record<string, string> = {
  targetUnknown: 'платформы нет в реестре группы',
  targetIsSelf: 'это эта же платформа',
  targetNotAccepting: 'цель не принимает переводы',
  targetNoChannel: 'у цели в реестре нет внутреннего адреса или ключа подписи',
  countryForbidden: 'страна клиента запрещена в цели',
  countryNotServed: 'цель не обслуживает страну клиента',
  countryUnknown: 'страна клиента не указана, а цель обслуживает закрытый список стран',
};

export const DELIVERY_CODE_TEXT: Record<string, string> = {
  badSignature: 'цель не приняла подпись (ключ в её реестре не совпадает с нашим)',
  unknownSender: 'нас нет в реестре цели (или нет нашего ключа)',
  staleMessage: 'расхождение часов больше 5 минут',
  countryForbidden: 'цель запрещает страну клиента',
  countryNotServed: 'цель не обслуживает страну клиента',
  countryUnknown: 'цель требует страну клиента',
  targetNotAccepting: 'цель не принимает переводы',
  selfNotRegistered: 'цель не прописала себя в своём реестре',
  revoked: 'перевод уже отозван',
  conflictingPackage: 'у цели другой пакет с этим номером',
  wrongRecipient: 'неверный получатель',
};

export function deliveryCodeText(code: string | null | undefined): string | null {
  if (!code) return null;
  return DELIVERY_CODE_TEXT[code] ?? code;
}

const ERRORS: Record<string, string> = {
  forbidden: 'Нет права на это действие.',
  missingReason: 'Укажите основание.',
  consentNotConfirmed: 'Отметьте, что согласие клиента на передачу данных есть в выбранном сообщении.',
  notClientManager: 'Перевод проводит только закреплённый менеджер этого клиента.',
  noClient: 'Клиент не найден.',
  clientBlocked: 'Клиент заблокирован — перевод невозможен.',
  liveTransferExists: 'У клиента уже есть незавершённый перевод.',
  dailyLimit: 'Лимит: не больше 5 переводов за сутки у одного менеджера. Перевод — индивидуальное заявление, не поток.',
  directionForbidden: 'Направление запрещено профилем юрисдикции',
  ticketNotFound: 'Тикет не найден.',
  ticketNotClients: 'Тикет не принадлежит этому клиенту.',
  ticketOpenedByOperator: 'Тикет открыт оператором — это не заявление клиента.',
  ticketAlreadyUsed: 'Этот тикет уже служит основанием другого перевода.',
  consentMessageInvalid: 'Согласие должно быть сообщением клиента в выбранном тикете.',
  missingTicket: 'Выберите тикет-заявление клиента.',
  missingTarget: 'Выберите платформу.',
  notAdmin: 'Вернуть перевод может только администратор.',
  notFound: 'Перевод не найден.',
  notRevocable: 'Перевод уже завершён отказом, истёк или возвращён.',
  notAllowed: 'Закрыть счёт может менеджер клиента или администратор.',
  notReady: 'Закрытие возможно, когда клиент зарегистрировался в цели.',
  fundsOrPositions: 'Нельзя закрыть: на реальном счёте есть средства или позиции. Сначала клиент выводит средства и закрывает позиции.',
  balanceUnknown: 'Нельзя закрыть: не удалось проверить баланс (терминал недоступен или ответ без чисел).',
  pendingMoney: 'Нельзя закрыть: у клиента есть незавершённые заявки на вывод или пополнение.',
  terminalUnavailable: 'Терминал недоступен — повторите позже.',
  terminalRefused: 'Терминал отказал в заморозке.',
  notOpen: 'Задача уже закрыта.',
  noChange: 'Изменений нет.',
  invalid: 'Проверьте поля',
  noSelf: 'SITE_SLUG процесса не задан — своя платформа неизвестна.',
  journalUnavailable: 'База недоступна — ничего не записано.',
};

const PLATFORM_FIELD: Record<string, string> = {
  invalidSlug: 'slug (латиница, цифры, дефис)',
  missingName: 'название',
  invalidCabinetUrl: 'адрес кабинета',
  invalidApiUrl: 'внутренний адрес API',
  invalidPublicKey: 'публичный ключ (Ed25519, PEM)',
  invalidCountries: 'страны (ISO-2 через запятую)',
  invalidLeverage: 'плечо (1–3000)',
};

export function transferErrorText(error: string, detail?: string): string {
  if (error === 'fundsOrPositions' && detail) {
    // detail = «balanceMinor,equityMinor,openPositions»
    const [bal, eq, pos] = detail.split(',').map(Number);
    const usdt = (Math.max(bal ?? 0, eq ?? 0) / 100).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return `Нельзя закрыть счёт. Сначала клиент выводит средства (${usdt} USDT) и закрывает позиции${pos ? ` (открыто: ${pos})` : ''}.`;
  }
  if (error === 'pendingMoney' && detail) {
    const [w, d] = detail.split(',').map(Number);
    return `Нельзя закрыть: незавершённых заявок на вывод — ${w}, пополнений, ждущих сети, — ${d}. Дождитесь их завершения.`;
  }
  if (error === 'directionForbidden' && detail) {
    return `${ERRORS.directionForbidden}: ${detail
      .split(',')
      .map((c) => BLOCKER_TEXT[c] ?? c)
      .join('; ')}.`;
  }
  if (error === 'invalid' && detail) {
    return `${ERRORS.invalid}: ${detail
      .split(',')
      .map((c) => PLATFORM_FIELD[c] ?? c)
      .join(', ')}.`;
  }
  return ERRORS[error] ?? `Ошибка: ${error}${detail ? ` (${detail})` : ''}`;
}
