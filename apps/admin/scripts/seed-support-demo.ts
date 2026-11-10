import { randomUUID } from 'node:crypto';
import type { PoolLike } from '@broker/money';
import {
  DEFAULT_SUPPORT_SETTINGS,
  addInternalNote,
  assignTicket,
  changeTicketStatus,
  operatorReply,
  postClientChatMessage,
  processInboundMail,
  rateTicket,
  recoverContactLeads,
  saveTemplate,
  type Actor,
  type SupportSettings,
} from '@broker/support';
import { readEnv } from '@broker/utils';
import { getPool } from '../lib/db';

/**
 * ДЕМО-НАБОР «Поддержки» поверх `seed:demo` (локальный просмотр и сцена §5
 * показа). НЕ миграция и не часть схемы. Создаёт оператора поддержки,
 * шаблоны ответов, обращения во всех состояниях и каналах (чат, письмо,
 * восстановленные с формы контактов), заметку, оценку, просроченный SLA.
 *
 * Fail-closed: отказ при NODE_ENV=production, без `seed:demo` (нет витринного
 * клиента) и при уже засеянной поддержке.
 *
 *   DATABASE_URL=… pnpm --filter @broker/admin seed:support-demo
 */

const HERO = '00000000-0000-4000-8000-0000000c0001';
const SUPPORT_OP = { id: '00000000-0000-4000-8000-00000000a005', login: 'o.belova', name: 'Ольга Белова' };
const ADMIN = '00000000-0000-4000-8000-00000000a001';
const OPERATOR = '00000000-0000-4000-8000-00000000a002';
const H = 3_600_000;
const ago = (hours: number) => new Date(Date.now() - hours * H);

async function main(): Promise<number> {
  if (!readEnv(process.env.DATABASE_URL)) {
    console.error('Сид отказан: DATABASE_URL не задан.');
    return 2;
  }
  if (process.env.NODE_ENV === 'production') {
    console.error('Сид отказан: NODE_ENV=production — это демо-данные, не для прода.');
    return 2;
  }
  const pool = getPool();
  const db = pool as unknown as PoolLike;
  const hero = await pool.query(`SELECT id FROM users WHERE id = $1`, [HERO]);
  if (!hero.rows[0]) {
    console.error('Сид отказан: сначала seed:demo (нет витринного клиента).');
    return 2;
  }
  const done = await pool.query(`SELECT 1 FROM operators WHERE id = $1`, [SUPPORT_OP.id]);
  if (done.rows[0]) {
    console.error('Сид отказан: демо поддержки уже засеяно.');
    return 2;
  }

  await pool.query(
    `INSERT INTO operators (id, login, display_name, role, created_at, totp_secret, totp_enrolled_at)
     VALUES ($1, $2, $3, 'support_operator', now() - interval '30 days', 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP', now() - interval '30 days')`,
    [SUPPORT_OP.id, SUPPORT_OP.login, SUPPORT_OP.name],
  );

  // Часы по умолчанию (пн–пт 09–21 МСК); имя отправителя — бренд ячейки из
  // окружения (SITE_BRAND_NAME, тот же мост, что у кабинета), не строкой в коде:
  // контента и бренда в коде нет (web-cms-lastgood). Нет бренда — нейтрально.
  const brand = readEnv(process.env.SITE_BRAND_NAME);
  const S: SupportSettings = {
    ...DEFAULT_SUPPORT_SETTINGS,
    hours: { ...DEFAULT_SUPPORT_SETTINGS.hours, alwaysOpen: false },
    mail: { fromName: brand ? `${brand} · Поддержка` : DEFAULT_SUPPORT_SETTINGS.mail.fromName },
  };
  await pool.query(`UPDATE support_settings SET settings = $1 WHERE id = 1`, [JSON.stringify(S)]);

  const sup: Actor = { operatorId: SUPPORT_OP.id, role: 'support_operator', displayName: SUPPORT_OP.name };
  const adm: Actor = { operatorId: ADMIN, role: 'admin', displayName: 'Ирина Ковалёва' };
  const op: Actor = { operatorId: OPERATOR, role: 'operator', displayName: 'Дмитрий Соколов' };

  const templates: [string, string, string, string][] = [
    ['kyc.docs', 'Проверка документов', 'verification', 'Здравствуйте, {{client.firstName}}!\n\nВаши документы на проверке у комплаенса — обычно это занимает до 24 часов в рабочие дни. Как только решение будет принято, вы получите уведомление в кабинете, а вывод средств станет доступен.\n\n{{operator.name}}, служба поддержки'],
    ['withdrawal.status', 'Статус вывода', 'withdrawal', 'Здравствуйте, {{client.firstName}}!\n\nЗаявка на вывод принята и проходит проверку. Сроки — до 1 рабочего дня; статус виден в разделе «Кошелёк». Если понадобится что-то уточнить, мы напишем здесь же.\n\n{{operator.name}}'],
    ['access.reset', 'Восстановление доступа', 'account', 'Здравствуйте, {{client.firstName}}!\n\nЧтобы восстановить доступ, нажмите «Забыли пароль?» на странице входа — ссылка придёт на почту и действует 30 минут.\n\n{{operator.name}}'],
    ['general.thanks', 'Спасибо за обращение', 'other', 'Спасибо, {{client.firstName}}! Рады, что вопрос решён. Если появятся новые — пишите в любое время. Обращение #{{ticket.number}}.'],
  ];
  for (const [key, title, category, body] of templates) {
    await saveTemplate(db, adm, { key, locale: 'ru', title, body, category, active: true });
  }

  const users = await pool.query(`SELECT id, email, full_name FROM users ORDER BY created_at`);
  const byName = (part: string) => users.rows.find((u) => String(u.full_name).includes(part))?.id as string | undefined;

  // 1) Витринный клиент (сцена §5): вывод ограничен — пишет в чат.
  const hero1 = await postClientChatMessage(db, S, {
    userId: HERO,
    body: 'Здравствуйте! Хочу вывести 250 USDT, но вывод ограничен. Документы загрузил вчера. Что нужно сделать?',
    now: ago(0.6),
  });
  if (hero1.ok) {
    await postClientChatMessage(db, S, { userId: HERO, body: 'Скрин ошибки могу приложить, если нужно.', now: ago(0.55) });
  }

  // 2) Клиент ждёт с утра — SLA чата просрочен, не назначено.
  const volkov = byName('Волков');
  if (volkov) await postClientChatMessage(db, S, { userId: volkov, body: 'Не открывается терминал после смены пароля, пишет «сессия истекла».', now: ago(5) });

  // 3) Заморозка: эскалировано в финансы/комплаенс, заметка для своих.
  const bianchi = byName('Bianchi');
  if (bianchi) {
    const t = await postClientChatMessage(db, S, { userId: bianchi, body: 'Why is my account blocked? I need access to my funds.', now: ago(26) });
    if (t.ok) {
      await assignTicket(db, op, { ticketId: t.ticketId, assigneeId: OPERATOR });
      await addInternalNote(db, op, { ticketId: t.ticketId, body: 'Блок по AML-эскалации. Клиенту — только «на проверке у комплаенса», без деталей. Ждём решения Ирины.' });
      await changeTicketStatus(db, op, { ticketId: t.ticketId, to: 'waiting_internal', reason: 'Решение по блокировке — за комплаенсом' });
    }
  }

  // 4) Решено с оценкой 5.
  const kuz = byName('Кузнецова');
  if (kuz) {
    const t = await postClientChatMessage(db, S, { userId: kuz, body: 'Как пополнить счёт через USDT TRC20? Не вижу адреса.', now: ago(30) });
    if (t.ok) {
      await operatorReply(db, S, sup, {
        ticketId: t.ticketId,
        body: 'Здравствуйте, Наталья! Адрес для пополнения — в разделе «Кошелёк», вкладка «Пополнить». Отправляйте только USDT в сети TRON (TRC20).',
      });
      await postClientChatMessage(db, S, { userId: kuz, body: 'Нашла, спасибо! Пополнила.' });
      await changeTicketStatus(db, sup, { ticketId: t.ticketId, to: 'resolved' });
      await rateTicket(pool, { userId: kuz, ticketId: t.ticketId, score: 5, comment: 'Ответили за пару минут' });
    }
  }

  // 5) Ждём клиента: оператор ответил по шаблону.
  const lebedeva = byName('Лебедева');
  if (lebedeva) {
    const t = await postClientChatMessage(db, S, { userId: lebedeva, body: 'Сколько идёт проверка документов?', now: ago(3) });
    if (t.ok) {
      await operatorReply(db, S, sup, {
        ticketId: t.ticketId,
        templateKey: 'kyc.docs',
        body: 'Здравствуйте, Мария!\n\nВаши документы на проверке у комплаенса — обычно это занимает до 24 часов в рабочие дни.\n\nОльга Белова, служба поддержки',
      });
    }
  }

  // 6) Письмо гостя на ящик поддержки (канал email) + письмо клиента платформы.
  await processInboundMail(
    db,
    {
      messageId: `<${randomUUID()}@gmail.example>`,
      inReplyTo: null,
      references: [],
      from: { address: 'k.petrov@gmail.example', name: 'Кирилл Петров' },
      to: ['support@wholesalefy.com'],
      subject: 'Партнёрская программа для IB',
      text: 'Добрый день! Мы небольшой IB из Алматы, хотим подключиться к партнёрской программе. Какие условия по ребейтам?',
      date: ago(2),
      mailbox: 'INBOX',
    },
    { settings: S, ownAddresses: ['support@wholesalefy.com'], now: ago(2) },
  );
  const fischer = users.rows.find((u) => String(u.full_name).includes('Fischer'));
  if (fischer) {
    const v = await processInboundMail(
      db,
      {
        messageId: `<${randomUUID()}@fischer-holding.de>`,
        inReplyTo: null,
        references: [],
        from: { address: String(fischer.email), name: 'Elena Fischer' },
        to: ['support@wholesalefy.com'],
        subject: 'Account statement for October',
        text: 'Hello, could you please send me the account statement for October for our accountants? Thank you, Elena',
        date: ago(7),
        mailbox: 'INBOX',
      },
      { settings: S, ownAddresses: ['support@wholesalefy.com'], now: ago(7) },
    );
    if (v.verdict === 'accepted') {
      await operatorReply(db, S, sup, {
        ticketId: v.ticketId,
        body: 'Dear Elena,\n\nthe October statement is being prepared and will be sent to this address within one business day.',
      });
      // Письмо не ушло: почта не настроена / хостинг отверг — оператор видит «не доставлено».
      await pool.query(
        `UPDATE outbound_mail SET status = 'failed', attempts = 8, last_error = '421 4.7.0 Try again later (лимит отправки хостинга)'
          WHERE ticket_id = $1 AND purpose = 'support_reply'`,
        [v.ticketId],
      );
    }
  }

  // 7) Спам.
  const spam = await processInboundMail(
    db,
    {
      messageId: `<${randomUUID()}@promo.example>`,
      inReplyTo: null,
      references: [],
      from: { address: 'seo@promo.example', name: 'SEO Boost' },
      to: ['support@wholesalefy.com'],
      subject: 'Раскрутка сайта в ТОП-10',
      text: 'Предлагаем продвижение вашего сайта в ТОП-10 Яндекса за 7 дней.',
      date: ago(20),
      mailbox: 'INBOX',
    },
    { settings: S, ownAddresses: ['support@wholesalefy.com'], now: ago(20) },
  );
  if (spam.verdict === 'accepted') {
    await changeTicketStatus(db, sup, { ticketId: spam.ticketId, to: 'spam', reason: 'Рекламная рассылка', blockSender: true });
  }

  // 8) «Потерянные» обращения с формы контактов (как на стенде: лиды есть, тикетов не было).
  for (const [email, name, topic, message, hours] of [
    ['d.romanov@yandex.example', 'Денис Романов', 'Вывод средств', 'Подал заявку на вывод неделю назад через форму, ответа так и нет. Подскажите статус.', 150],
    ['a.ivanova@mail.example', 'Анна Иванова', 'Открытие счёта', 'Хочу открыть реальный счёт для юрлица. Какие документы нужны?', 96],
    ['john.doe@outlook.example', 'John Doe', 'Account', 'Do you accept clients from Kazakhstan? What are the trading hours for gold?', 60],
  ] as const) {
    await pool.query(
      `INSERT INTO leads (kind, email, locale, payload, created_at) VALUES ('contact', $1, $2, $3, $4)`,
      [email, /[а-я]/i.test(message) ? 'ru' : 'en', JSON.stringify({ kind: 'contact', name, email, topic, message }), ago(hours)],
    );
  }
  const rec = await recoverContactLeads(db, S);

  // Почтовый воркер ни разу не отмечался — состояние честное («не настроена»).
  await pool.query(
    `INSERT INTO support_mail_status (id, smtp_configured, imap_configured, missing_env, last_heartbeat_at)
     VALUES (1, false, false, ARRAY['SUPPORT_SMTP_HOST','SUPPORT_SMTP_PASSWORD','SUPPORT_IMAP_HOST','SUPPORT_IMAP_PASSWORD'], now())
     ON CONFLICT (id) DO NOTHING`,
  );

  const n = await pool.query(`SELECT count(*)::int AS n FROM support_tickets`);
  console.info(`Поддержка засеяна: обращений ${n.rows[0]!.n}, восстановлено с формы ${rec.recovered}.`);
  console.info(`Оператор поддержки: ${SUPPORT_OP.login} (${SUPPORT_OP.id})`);
  await pool.end();
  return 0;
}

main().then(
  (code) => process.exit(code),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
