import type { StatusKey } from '@broker/ui';
import type { Channel, SupportFailure, TicketStatus } from '@broker/support';

/** Подписи раздела «Поддержка» (концепция: статусы — через словарь StatusBadge). */

export const STATUS_KEY: Record<TicketStatus, StatusKey> = {
  new: 'support_new',
  open: 'support_open',
  waiting_client: 'support_waiting_client',
  waiting_internal: 'support_waiting_internal',
  resolved: 'support_resolved',
  closed: 'support_closed',
  spam: 'support_spam',
};

export const STATUS_ACTION: Partial<Record<TicketStatus, string>> = {
  open: 'Вернуть в работу',
  waiting_client: 'Ждём клиента',
  waiting_internal: 'Эскалировать (финансы/комплаенс)',
  resolved: 'Отметить решённым',
  closed: 'Закрыть',
  spam: 'Спам…',
};

export const CHANNEL_LABEL: Record<Channel, string> = {
  chat: 'Чат кабинета',
  email: 'Почта',
  web_form: 'Форма сайта',
};

export const CHANNEL_SHORT: Record<Channel, string> = { chat: 'Чат', email: 'Почта', web_form: 'Форма' };

export const QUEUE_FILTER_LABEL = {
  awaiting: 'Ждут ответа',
  mine: 'Мои',
  unassigned: 'Не назначены',
  waiting: 'Ждём клиента / эскалация',
  resolved: 'Решённые',
  closed: 'Закрытые',
  spam: 'Спам',
  all: 'Все',
} as const;

const ERRORS: Record<SupportFailure | 'invalid' | 'duplicate' | 'unauthorized' | 'templateMentionsGroupPlatform', string> = {
  notFound: 'Обращение не найдено.',
  forbidden: 'Недостаточно прав для этого действия.',
  invalidTransition: 'Такой переход статуса недопустим. Обновите страницу — статус мог измениться.',
  emptyBody: 'Пустое сообщение не отправляется.',
  reasonRequired: 'Укажите основание — оно пишется в неизменяемый журнал.',
  channelDisabled: 'Канал выключен в настройках поддержки.',
  emailChannelDisabled: 'Почтовый канал выключен в настройках — ответ письмом не отправить.',
  rateLimited: 'Слишком часто. Подождите минуту.',
  invalidAssignee: 'Этому оператору назначить нельзя (отключён или нет роли).',
  invalidClient: 'Клиент не найден.',
  invalidEmail: 'Некорректный email.',
  alreadyRated: 'Оценка уже поставлена.',
  invalidScore: 'Оценка — от 1 до 5.',
  invalid: 'Проверьте поля формы.',
  duplicate: 'Шаблон с таким ключом и языком уже есть.',
  unauthorized: 'Сессия истекла — войдите заново.',
  // ── Перевод на другую платформу группы (ветка client-transfer) ──
  templateMentionsGroupPlatform:
    'Шаблон упоминает другую платформу группы. Предлагать перевод нельзя — только по заявлению клиента; шаблоны для этого не используются.',
};

export function supportErrorText(code: string | undefined): string {
  return (code && ERRORS[code as keyof typeof ERRORS]) || `Не удалось: ${code ?? 'неизвестная ошибка'}.`;
}

export const SETTINGS_ERROR_TEXT: Record<string, string> = {
  invalidTimezone: 'Неизвестный часовой пояс (нужен IANA, напр. Europe/Moscow).',
  invalidHours: 'Часы: открытие раньше закрытия, формат ЧЧ:ММ.',
  noWorkingDays: 'Нужен хотя бы один рабочий день (или «круглосуточно»).',
  invalidDate: 'Праздник — в формате ГГГГ-ММ-ДД.',
  invalidSla: 'SLA — от 1 до 10 080 минут.',
  invalidNumber: 'Число вне допустимого диапазона.',
  invalidCategory: 'Ключ категории — латиница/цифры/дефис, без повторов.',
  required: 'Поле не может быть пустым.',
};
