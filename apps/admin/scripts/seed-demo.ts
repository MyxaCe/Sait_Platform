import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { computeEntryHash } from '@broker/money';
import { readEnv } from '@broker/utils';
import { getPool } from '../lib/db';

/**
 * ДЕМО-НАБОР для локального просмотра центра управления (редизайн, фаза 1).
 * НЕ миграция и НЕ часть схемы: ~15 клиентов в разных состояниях KYC/AML,
 * блокировки, денежные флаги, депозиты/выводы во всех статусах, проекции
 * демо/реального счёта, журнал с ВАЛИДНОЙ хеш-цепочкой (задним числом).
 *
 * Fail-closed: отказывает при NODE_ENV=production и при непустой таблице
 * operators/users (чтобы не смешать с чьими-то данными). Запуск — только на
 * пустую локальную базу с применёнными миграциями:
 *
 *   DATABASE_URL=postgres://… pnpm --filter @broker/admin seed:demo
 *
 * Печатает id операторов и витринного клиента — их берёт скриншотер
 * (`tools/screens`).
 */

const DAY = 86_400_000;
const NOW = Date.now();
const ago = (days: number, hours = 0): Date => new Date(NOW - days * DAY - hours * 3_600_000);
const hex64 = (): string => randomBytes(32).toString('hex');
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const tron = (): string => 'T' + Array.from(randomBytes(33), (b) => B58[b % B58.length]).join('');

type Kyc = 'unverified' | 'pending' | 'verified' | 'rejected' | 'resubmit_requested';
type Aml = 'unscreened' | 'clear' | 'escalated';

interface ClientSpec {
  name: string;
  email: string;
  locale: 'ru' | 'en';
  regDays: number;
  kyc: Kyc;
  aml: Aml;
  blocked?: string;
  frozen?: boolean;
  withdrawBanned?: boolean;
  realCents?: number;
  demoCents?: number;
  vip?: number;
}

const OPS = {
  admin: {
    id: '00000000-0000-4000-8000-00000000a001',
    login: 'i.kovaleva',
    name: 'Ирина Ковалёва',
    role: 'admin',
  },
  operator: {
    id: '00000000-0000-4000-8000-00000000a002',
    login: 'd.sokolov',
    name: 'Дмитрий Соколов',
    role: 'operator',
  },
  finance: {
    id: '00000000-0000-4000-8000-00000000a003',
    login: 'm.orlova',
    name: 'Мария Орлова',
    role: 'finance_operator',
  },
} as const;

/** Витринный клиент (самая насыщенная карточка) — первый в списке. */
const CLIENTS: ClientSpec[] = [
  {
    name: 'Алексей Морозов',
    email: 'a.morozov@northbay.capital',
    locale: 'ru',
    regDays: 74,
    kyc: 'verified',
    aml: 'clear',
    realCents: 4_825_013,
    demoCents: 10_412_550,
    vip: 2,
  },
  {
    name: 'Elena Fischer',
    email: 'elena.fischer@fischer-holding.de',
    locale: 'en',
    regDays: 61,
    kyc: 'verified',
    aml: 'clear',
    realCents: 12_960_000,
    demoCents: 9_870_300,
    vip: 3,
  },
  {
    name: 'Сергей Волков',
    email: 'volkov.s@mail.example',
    locale: 'ru',
    regDays: 55,
    kyc: 'verified',
    aml: 'clear',
    realCents: 315_075,
    demoCents: 10_000_000,
    frozen: true,
  },
  {
    name: 'Ольга Лебедева',
    email: 'olga.lebedeva@example.org',
    locale: 'ru',
    regDays: 49,
    kyc: 'verified',
    aml: 'clear',
    realCents: 88_420,
    demoCents: 9_412_000,
    withdrawBanned: true,
  },
  {
    name: 'Marco Bianchi',
    email: 'm.bianchi@bianchi-trade.it',
    locale: 'en',
    regDays: 43,
    kyc: 'verified',
    aml: 'escalated',
    realCents: 2_450_000,
    demoCents: 10_150_000,
    blocked: 'Совпадение в санкционном списке (EU) — до решения комплаенса',
  },
  {
    name: 'Наталья Кузнецова',
    email: 'n.kuznetsova@example.com',
    locale: 'ru',
    regDays: 38,
    kyc: 'verified',
    aml: 'clear',
    realCents: 640_500,
    demoCents: 10_000_000,
  },
  {
    name: 'Игорь Смирнов',
    email: 'igor.smirnov@example.net',
    locale: 'ru',
    regDays: 12,
    kyc: 'pending',
    aml: 'unscreened',
    demoCents: 10_000_000,
  },
  {
    name: 'Aisha Rahman',
    email: 'aisha.rahman@example.ae',
    locale: 'en',
    regDays: 9,
    kyc: 'pending',
    aml: 'unscreened',
    demoCents: 9_975_400,
  },
  {
    name: 'Павел Новиков',
    email: 'p.novikov@example.ru',
    locale: 'ru',
    regDays: 6,
    kyc: 'pending',
    aml: 'unscreened',
    demoCents: 10_000_000,
  },
  {
    name: 'Lukas Weber',
    email: 'lukas.weber@example.at',
    locale: 'en',
    regDays: 3,
    kyc: 'pending',
    aml: 'escalated',
    demoCents: 10_000_000,
  },
  {
    name: 'Татьяна Попова',
    email: 't.popova@example.ru',
    locale: 'ru',
    regDays: 21,
    kyc: 'resubmit_requested',
    aml: 'unscreened',
    demoCents: 10_230_000,
  },
  {
    name: 'Chen Wei',
    email: 'chen.wei@example.sg',
    locale: 'en',
    regDays: 17,
    kyc: 'resubmit_requested',
    aml: 'unscreened',
    demoCents: 10_000_000,
  },
  {
    name: 'Дмитрий Козлов',
    email: 'kozlov.d@example.ru',
    locale: 'ru',
    regDays: 33,
    kyc: 'rejected',
    aml: 'escalated',
    blocked: 'Подложный документ, удостоверяющий личность',
    demoCents: 10_000_000,
  },
  {
    name: 'Анна Белова',
    email: 'anna.belova@example.ru',
    locale: 'ru',
    regDays: 2,
    kyc: 'unverified',
    aml: 'unscreened',
  },
  {
    name: 'James O’Connor',
    email: 'j.oconnor@example.ie',
    locale: 'en',
    regDays: 1,
    kyc: 'unverified',
    aml: 'unscreened',
  },
];

const SYMBOLS: Array<[string, number]> = [
  ['BTCUSDT', 68_420.5],
  ['ETHUSDT', 3_512.4],
  ['EURUSD', 1.0842],
  ['XAUUSD', 2_384.2],
  ['SOLUSDT', 162.35],
  ['GBPUSD', 1.2715],
  ['US500', 5_312.8],
  ['USDJPY', 154.62],
];

interface J {
  at: Date;
  op: string;
  action: string;
  kind: string;
  subject: string;
  payload: Record<string, unknown>;
}

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
  const existing = await pool.query(
    `SELECT (SELECT count(*) FROM operators WHERE login NOT LIKE 'system:%')::int AS o, (SELECT count(*) FROM users)::int AS u`,
  );
  const ex = existing.rows[0] as { o: number; u: number };
  if (ex.o > 0 || ex.u > 0) {
    console.error(
      'Сид отказан: база не пустая (operators/users). Только на чистую локальную базу.',
    );
    return 2;
  }

  const c = await pool.connect();
  const journal: J[] = [];
  const j = (
    at: Date,
    op: string,
    action: string,
    kind: string,
    subject: string,
    payload: Record<string, unknown> = {},
  ) => journal.push({ at, op, action, kind, subject, payload });

  try {
    await c.query('BEGIN');

    for (const o of Object.values(OPS)) {
      await c.query(
        `INSERT INTO operators (id, login, display_name, role, created_at, totp_secret, totp_enrolled_at)
         VALUES ($1,$2,$3,$4,$5,'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP',$5)`,
        [o.id, o.login, o.name, o.role, ago(90)],
      );
      j(
        ago(90),
        OPS.admin.id,
        o.role === 'admin' ? 'operator.bootstrap' : 'operator.created',
        'operator',
        o.id,
        { login: o.login, role: o.role },
      );
      j(ago(90, -1), o.id, 'operator.totp_enrolled', 'operator', o.id, {});
    }

    const ids: string[] = [];
    for (const [i, s] of CLIENTS.entries()) {
      const id = i === 0 ? '00000000-0000-4000-8000-0000000c0001' : randomUUID();
      ids.push(id);
      const reg = ago(s.regDays, 3);
      await c.query(
        `INSERT INTO users (id, email, password_hash, full_name, locale, email_verified_at, created_at, last_login_at, vip_level)
         VALUES ($1,$2,'x',$3,$4,$5,$6,$7,$8)`,
        [
          id,
          s.email,
          s.name,
          s.locale,
          s.kyc === 'unverified' && i % 2 ? null : new Date(reg.getTime() + 600_000),
          reg,
          ago(Math.min(s.regDays, i % 5), 2 + i),
          s.vip ?? 0,
        ],
      );

      // KYC + документы
      if (s.kyc !== 'unverified') {
        const kinds = [
          'identity',
          'selfie_liveness',
          'address_proof',
          ...(s.realCents && s.realCents > 1_000_000 ? ['source_of_funds'] : []),
        ];
        const ctypes: Record<string, string> = {
          identity: 'image/jpeg',
          selfie_liveness: 'video/mp4',
          address_proof: 'application/pdf',
          source_of_funds: 'application/pdf',
        };
        for (const k of kinds) {
          await c.query(
            `INSERT INTO kyc_documents (user_id, doc_kind, storage_key, content_type, submitted_at) VALUES ($1,$2,$3,$4,$5)`,
            [id, k, `kyc/${id}/${k}.${ctypes[k]!.split('/')[1]}`, ctypes[k], ago(s.regDays - 1)],
          );
        }
      }
      await c.query(
        `INSERT INTO client_verification (user_id, state, updated_at) VALUES ($1,$2,$3)`,
        [
          id,
          s.kyc,
          s.kyc === 'pending'
            ? ago(Math.max(s.regDays - 1, 0), 5 + i)
            : ago(Math.max(s.regDays - 2, 0)),
        ],
      );
      const kycAt = ago(Math.max(s.regDays - 2, 0), 1);
      if (s.kyc === 'verified') {
        j(
          new Date(kycAt.getTime() - 3_600_000),
          OPS.operator.id,
          'client.document.viewed',
          'client',
          id,
          { docKind: 'identity' },
        );
        j(kycAt, OPS.operator.id, 'client.verification.verified', 'client', id, {
          basis: 'Документы соответствуют, лицо совпадает с селфи',
          from: 'pending',
          to: 'verified',
        });
      }
      if (s.kyc === 'rejected')
        j(kycAt, OPS.operator.id, 'client.verification.rejected', 'client', id, {
          basis: 'Паспорт не проходит проверку подлинности',
          from: 'pending',
          to: 'rejected',
        });
      if (s.kyc === 'resubmit_requested')
        j(kycAt, OPS.operator.id, 'client.verification.resubmit_requested', 'client', id, {
          basis: 'Нечитаемый скан подтверждения адреса',
          from: 'pending',
          to: 'resubmit_requested',
        });

      // AML
      if (s.aml !== 'unscreened') {
        const amlAt = ago(Math.max(s.regDays - 3, 0), 2);
        await c.query(
          `INSERT INTO client_aml_screening (user_id, status, lists_checked, reason, screened_by, screened_at, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$6)`,
          [
            id,
            s.aml,
            ['ofsi', 'ofac', 'eu'],
            s.aml === 'clear' ? 'Совпадений нет' : 'Частичное совпадение ФИО и даты рождения',
            OPS.operator.id,
            amlAt,
          ],
        );
        j(
          amlAt,
          OPS.operator.id,
          s.aml === 'clear' ? 'client.aml_checked' : 'client.aml_escalated',
          'client',
          id,
          {
            basis:
              s.aml === 'clear' ? 'Совпадений нет' : 'Частичное совпадение ФИО и даты рождения',
            lists: ['ofsi', 'ofac', 'eu'],
          },
        );
      }

      // Блокировка
      if (s.blocked) {
        const at = ago(Math.max(s.regDays - 5, 1));
        await c.query(
          `INSERT INTO client_blocks (user_id, blocked, reason, blocked_by, updated_at) VALUES ($1,true,$2,$3,$4)`,
          [id, s.blocked, OPS.admin.id, at],
        );
        j(at, OPS.admin.id, 'client.block', 'client', id, { basis: s.blocked, sessionsRevoked: 2 });
      }

      // Денежные флаги
      if (s.frozen || s.withdrawBanned) {
        const at = ago(4, i);
        await c.query(
          `INSERT INTO client_money_flags (user_id, frozen, withdraw_banned, updated_at, updated_by) VALUES ($1,$2,$3,$4,$5)`,
          [id, !!s.frozen, !!s.withdrawBanned, at, OPS.finance.id],
        );
        j(
          at,
          OPS.finance.id,
          s.frozen ? 'client.money.frozen' : 'client.money.withdraw_banned',
          'client',
          id,
          {
            basis: s.frozen
              ? 'Запрос банка-корреспондента по источнику средств'
              : 'Смена кошелька вывода без подтверждения',
          },
        );
      }

      // Демо-счёт
      if (s.demoCents) {
        await c.query(
          `INSERT INTO demo_accounts (user_id, balance_cents, currency, created_at, account_seq) VALUES ($1,$2,'USD',$3,$4)`,
          [id, s.demoCents, ago(s.regDays - 1), 10 + i],
        );
      }

      // Реальный счёт + депозиты/выводы
      if (s.realCents) {
        await c.query(
          `INSERT INTO real_accounts (user_id, account_uuid, balance_cents, currency, account_seq, created_at) VALUES ($1,$2,$3,'USDT',$4,$5)`,
          [id, randomUUID(), s.realCents, 40 + i, ago(s.regDays - 3)],
        );
        const deps =
          i === 0
            ? [2_500_000, 1_500_000, 1_200_000, 50_000]
            : i === 1 || i === 5
              ? [Math.round(s.realCents * 0.8), Math.round(s.realCents * 0.3)]
              : [Math.round(s.realCents * 1.1)];
        const depDays = i === 0 ? [70, 30, 9, 0.3] : [s.regDays - 3, 3 + i / 10];
        for (const [k, amt] of deps.entries()) {
          const at = ago(depDays[k] ?? s.regDays - 3, k);
          const status = i === 0 && k === 3 ? 'claimed' : 'credited';
          const tx = hex64();
          await c.query(
            `INSERT INTO crypto_deposits (user_id, tx_hash, status, from_address, to_address, amount_raw, amount_minor, block_time, credited_at, claimed_at, updated_at, resolved_by)
             VALUES ($1,$2,$3,$4,'TXyQ8cG6rWwP3b1hT9cTn2mE5sTq4xYb7K',$5,$6,$7,$8,$7,$7,NULL)`,
            [
              id,
              tx,
              status,
              tron(),
              amt * 10_000,
              status === 'credited' ? amt : null,
              at,
              status === 'credited' ? new Date(at.getTime() + 180_000) : null,
            ],
          );
          if (status === 'credited')
            j(
              new Date(at.getTime() + 180_000),
              OPS.finance.id,
              'crypto.deposit.credited',
              'client',
              id,
              { txHash: tx, amountMinor: amt, currency: 'USDT' },
            );
        }
        if (i === 0) {
          // Отклонённый депозит (не тот токен).
          await c.query(
            `INSERT INTO crypto_deposits (user_id, tx_hash, status, from_address, to_address, reject_reason, claimed_at, updated_at)
             VALUES ($1,$2,'rejected',$3,'TXyQ8cG6rWwP3b1hT9cTn2mE5sTq4xYb7K','wrong_token',$4,$4)`,
            [id, hex64(), tron(), ago(30)],
          );
        }
        const wds: Array<[string, number, number]> =
          i === 0
            ? [
                ['settled', 600_000, 40],
                ['settled', 250_000, 4],
                ['rejected', 1_000_000, 15],
                ['needs_review', 1_800_000, 0.2],
              ]
            : i === 1
              ? [
                  ['requested', 3_000_000, 0.1],
                  ['sent', 500_000, 1],
                ]
              : i === 2
                ? [['requested', 120_000, 0.4]]
                : i === 3
                  ? [['cancelled', 50_000, 6]]
                  : i === 5
                    ? [
                        ['approved', 210_000, 0.05],
                        ['settled', 90_000, 10],
                      ]
                    : [];
        for (const [status, amt, d] of wds) {
          const at = ago(d);
          const hasHash = status === 'sent' || status === 'settled';
          await c.query(
            `INSERT INTO crypto_withdrawals (user_id, to_address, amount_minor, status, debit_state, payout_tx_hash, reject_reason, review_reason, decided_by, sent_at, settled_at, requested_at, updated_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$12)`,
            [
              id,
              tron(),
              amt,
              status,
              status === 'rejected' || status === 'cancelled'
                ? 'refused'
                : status === 'requested'
                  ? 'pending'
                  : 'debited',
              hasHash ? hex64() : null,
              status === 'rejected' ? 'Адрес получателя в списке высокого риска' : null,
              status === 'needs_review' ? 'Сумма выше порога ручной проверки' : null,
              ['approved', 'sent', 'settled', 'rejected'].includes(status) ? OPS.finance.id : null,
              hasHash ? new Date(at.getTime() + 3_600_000) : null,
              status === 'settled' ? new Date(at.getTime() + 4_000_000) : null,
              at,
            ],
          );
          if (status !== 'requested' && status !== 'needs_review' && status !== 'cancelled')
            j(
              new Date(at.getTime() + 1_800_000),
              OPS.finance.id,
              `crypto.withdrawal.${status === 'settled' ? 'sent' : status}`,
              'client',
              id,
              {
                amountMinor: amt,
                currency: 'USDT',
                basis:
                  status === 'rejected'
                    ? 'Адрес получателя в списке высокого риска'
                    : 'Проверено, лимиты соблюдены',
              },
            );
        }
      }

      // Позиции и сделки (реальный — у верифицированных с деньгами, демо — у всех с демо-счётом)
      for (const kind of ['real', 'demo'] as const) {
        if (kind === 'real' && !s.realCents) continue;
        if (kind === 'demo' && !s.demoCents) continue;
        const nPos = i === 0 ? (kind === 'real' ? 3 : 2) : i % 3;
        for (let p = 0; p < nPos; p++) {
          const [sym, px] = SYMBOLS[(i + p * 3) % SYMBOLS.length]!;
          await c.query(
            `INSERT INTO ${kind}_positions (id, user_id, symbol, side, volume, entry_price, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
            [
              randomUUID(),
              id,
              sym,
              p % 2 ? 'sell' : 'buy',
              px > 1000 ? 0.15 * (p + 1) : px > 100 ? 4 * (p + 1) : 25_000 * (p + 1),
              +(px * (1 + (p - 1) * 0.004)).toFixed(px > 10 ? 2 : 5),
              ago(0, p + 1),
            ],
          );
        }
        const nTr = i === 0 ? (kind === 'real' ? 14 : 8) : (i % 4) * 2;
        for (let t = 0; t < nTr; t++) {
          const [sym, px] = SYMBOLS[(i * 2 + t) % SYMBOLS.length]!;
          const pnl =
            t % 3 === 0
              ? null
              : Math.round((((t * 7919 + i * 104729) % 2000) - 750) * (kind === 'real' ? 13 : 41));
          await c.query(
            `INSERT INTO ${kind}_trades (id, user_id, event_id, trade_id, symbol, side, volume, price, realized_pnl_cents, executed_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
            [
              randomUUID(),
              id,
              `ev-${kind}-${i}-${t}`,
              `T${100_000 + i * 100 + t}`,
              sym,
              t % 2 ? 'sell' : 'buy',
              px > 1000 ? 0.1 : px > 100 ? 5 : 10_000,
              +(px * (1 + ((t % 5) - 2) * 0.003)).toFixed(px > 10 ? 2 : 5),
              pnl,
              ago(t * 1.7 + 0.3),
            ],
          );
        }
      }

      // Сессии
      for (let k = 0; k < (i === 0 ? 2 : i % 2); k++) {
        await c.query(
          `INSERT INTO sessions (id, user_id, token_hash, created_at, expires_at, ip, user_agent) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [
            randomUUID(),
            id,
            hex64(),
            ago(k + 0.2),
            new Date(NOW + 29 * DAY),
            k ? '91.204.118.42' : '185.73.12.9',
            k
              ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) Safari/604.1'
              : 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6) Chrome/131.0',
          ],
        );
      }
    }

    // Неопознанные поступления (без клиента)
    for (const amt of [73_500, 1_000_000]) {
      await c.query(
        `INSERT INTO crypto_deposits (tx_hash, status, from_address, to_address, amount_raw, amount_minor, block_time, claimed_at, updated_at)
         VALUES ($1,'unidentified',$2,'TXyQ8cG6rWwP3b1hT9cTn2mE5sTq4xYb7K',$3,$4,$5,$5,$5)`,
        [hex64(), tron(), amt * 10_000, amt, ago(amt > 100_000 ? 0.6 : 2.2)],
      );
    }

    // Витринный клиент: плечо, флаги KYC, действия админа
    const hero = ids[0]!;
    await c.query(
      `INSERT INTO client_leverage (user_id, portfolio_key, override_leverage, override_reason, override_by, override_at)
       VALUES ($1,'pro',NULL,NULL,NULL,NULL)`,
      [hero],
    );
    j(ago(60), OPS.admin.id, 'leverage.client_portfolio_set', 'client', hero, {
      basis: 'Профиль опытного трейдера, анкета пройдена',
      portfolio: 'pro',
    });
    j(ago(11, 4), OPS.operator.id, 'client.document.viewed', 'client', hero, {
      docKind: 'source_of_funds',
    });
    j(ago(3, 6), OPS.admin.id, 'client.sessions_revoked', 'client', hero, {
      basis: 'Клиент сообщил о входе с чужого устройства',
      revoked: 3,
    });
    j(ago(1, 2), OPS.finance.id, 'client.money.withdraw_kyc_changed', 'client', hero, {
      basis: 'Политика для VIP-2: вывод только после KYC',
      from: 'inherit',
      to: 'required',
    });
    await c.query(
      `INSERT INTO client_money_flags (user_id, withdraw_kyc, updated_at, updated_by) VALUES ($1,'required',$2,$3)`,
      [hero, ago(1, 2), OPS.finance.id],
    );
    j(ago(25), OPS.admin.id, 'platform.money_settings.updated', 'platform', 'money_settings', {
      basis: 'Минимум вывода 10 USDT',
      minWithdrawMinor: 1000,
    });

    // Журнал: хронологически, валидная хеш-цепочка.
    journal.sort((a, b) => a.at.getTime() - b.at.getTime());
    let prev: string | null = null;
    for (const e of journal) {
      const occurredAt = e.at.toISOString();
      const hash = computeEntryHash({
        prevHash: prev,
        occurredAt,
        operatorId: e.op,
        action: e.action,
        subjectKind: e.kind,
        subjectId: e.subject,
        payload: e.payload,
      });
      await c.query(
        `INSERT INTO admin_action_journal (occurred_at, operator_id, action, subject_kind, subject_id, payload, prev_hash, entry_hash)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [occurredAt, e.op, e.action, e.kind, e.subject, JSON.stringify(e.payload), prev, hash],
      );
      prev = hash;
    }

    // Сессия кабинета витринного клиента — для скриншотов кабинета.
    const cabinetToken = 'demo-cabinet-token-0001';
    await c.query(
      `INSERT INTO sessions (id, user_id, token_hash, created_at, expires_at, ip, user_agent) VALUES ($1,$2,$3,now(),$4,'127.0.0.1','screens')`,
      [
        randomUUID(),
        hero,
        createHash('sha256').update(cabinetToken, 'utf8').digest('hex'),
        new Date(NOW + 29 * DAY),
      ],
    );

    await c.query('COMMIT');
    console.info(
      JSON.stringify(
        {
          operators: OPS,
          heroClientId: hero,
          cabinetToken,
          clients: ids.length,
          journal: journal.length,
        },
        null,
        2,
      ),
    );
    return 0;
  } catch (error) {
    await c.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    c.release();
    await pool.end();
  }
}

main().then(
  (code) => process.exit(code),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
