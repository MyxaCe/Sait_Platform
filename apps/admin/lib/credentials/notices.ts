/**
 * Тексты уведомлений клиенту о правке учётных данных менеджером
 * (`outbound_mail.purpose = 'credentials_notice'`). Уходят на ПРЕЖНИЙ канал:
 * если правку провёл не тот человек, настоящий клиент узнает об этом первым.
 *
 * Тексты пока в коде, а не в настройках поддержки: юридически значимую
 * формулировку ещё утверждают юристы (вопрос Ю10 в ADR); после — переезд в
 * `support_settings.texts` без смены механизма.
 */

type Locale = 'ru' | 'en';

export interface Notice {
  subject: string;
  body: string;
}

function hello(locale: Locale, firstName: string): string {
  if (locale === 'en') return firstName ? `Hello, ${firstName}!` : 'Hello!';
  return firstName ? `Здравствуйте, ${firstName}!` : 'Здравствуйте!';
}

function footer(locale: Locale, ticket: string | null): string {
  if (locale === 'en') {
    return [
      ticket ? `Support request: #${ticket}.` : null,
      'If it was not you, contact support right away by replying to this email.',
    ]
      .filter(Boolean)
      .join('\n');
  }
  return [
    ticket ? `Обращение в поддержку: №${ticket}.` : null,
    'Если это были не вы — сразу свяжитесь с поддержкой, ответив на это письмо.',
  ]
    .filter(Boolean)
    .join('\n');
}

/** На СТАРЫЙ email: «ваш email изменён менеджером». */
export function emailChangedNotice(input: {
  locale: string;
  firstName: string;
  newEmailMasked: string;
  ticket: string | null;
}): Notice {
  const l: Locale = input.locale === 'en' ? 'en' : 'ru';
  if (l === 'en') {
    return {
      subject: 'The email of your account has been changed',
      body: [
        hello(l, input.firstName),
        '',
        `Your account manager has changed the email of your account to ${input.newEmailMasked}.`,
        'From now on, account emails will be sent to the new address.',
        '',
        footer(l, input.ticket),
      ].join('\n'),
    };
  }
  return {
    subject: 'Email вашего аккаунта изменён',
    body: [
      hello(l, input.firstName),
      '',
      `Ваш менеджер изменил email аккаунта на ${input.newEmailMasked}.`,
      'Письма по аккаунту теперь будут приходить на новый адрес.',
      '',
      footer(l, input.ticket),
    ].join('\n'),
  };
}

/** На текущий email: «выдан временный пароль, все сессии завершены». */
export function tempPasswordNotice(input: { locale: string; firstName: string; ticket: string | null }): Notice {
  const l: Locale = input.locale === 'en' ? 'en' : 'ru';
  if (l === 'en') {
    return {
      subject: 'A temporary password has been issued for your account',
      body: [
        hello(l, input.firstName),
        '',
        'Your account manager has issued a temporary password for your account. All active sessions have been signed out.',
        'At the next sign-in you will be asked to set a new password.',
        '',
        footer(l, input.ticket),
      ].join('\n'),
    };
  }
  return {
    subject: 'Для вашего аккаунта выдан временный пароль',
    body: [
      hello(l, input.firstName),
      '',
      'Ваш менеджер выдал временный пароль для входа в аккаунт. Все активные сеансы завершены.',
      'При следующем входе система попросит задать новый пароль.',
      '',
      footer(l, input.ticket),
    ].join('\n'),
  };
}
