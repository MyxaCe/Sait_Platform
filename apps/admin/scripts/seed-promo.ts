import { randomUUID } from 'node:crypto';
import type { MoneyMoveOutcome, PoolLike } from '@broker/money';
import {
  accrueCashback,
  accrueIbRevshare,
  approveReward,
  createIbPartner,
  createPromotion,
  ensureReferralCode,
  finalizeContest,
  periodOf,
  rejectReward,
  setPromotionStatus,
  syncIbCpa,
  syncPromotionQueue,
  type PromotionInput,
} from '@broker/promo';
import { getPool } from '../lib/db';

/**
 * ДЕМО-НАБОР зоны «Акции и партнёры» (dev-only, НЕ миграция). Запускается
 * ПОСЛЕ `seed:demo` на ту же базу:
 *
 *   DATABASE_URL=postgres://… pnpm --filter @broker/admin seed:promo
 *
 * Fail-closed: отказывает при NODE_ENV=production, без клиентов seed:demo и
 * при непустой `promotions`. Всё, что пишет журнал, идёт через функции
 * `@broker/promo` (та же транзакция, валидная хеш-цепочка). Деньги НЕ
 * двигаются: решения по очереди принимаются против ЗАГЛУШКИ терминала
 * (ниже), настоящий терминал не вызывается.
 */

const DAY = 86_400_000;
const NOW = Date.now();
const ago = (days: number, minutes = 0) => new Date(NOW - days * DAY - minutes * 60_000);
const ADMIN = '00000000-0000-4000-8000-00000000a001';
const FINANCE = '00000000-0000-4000-8000-00000000a003';

/** Заглушка терминала: исход задаётся явно. Только для сида. */
function stubTerminal(outcome: 'ok' | 'refused' | 'unavailable') {
  let seq = 9_000;
  return {
    async deposit(): Promise<MoneyMoveOutcome> {
      if (outcome === 'refused') return { state: 'refused', code: 'account_quarantined', status: 423 };
      if (outcome === 'unavailable') return { state: 'unavailable', reason: 'network' };
      seq += 1;
      return { state: 'ok', balanceMinor: null, seq, replay: false };
    },
  };
}

async function main(): Promise<number> {
  if (process.env.NODE_ENV === 'production') {
    console.error('seed:promo отказывает при NODE_ENV=production');
    return 1;
  }
  const pool = getPool();
  const P = pool as unknown as PoolLike;
  try {
    const promos = await pool.query(`SELECT count(*)::int AS n FROM promotions`);
    if (Number(promos.rows[0]?.n) > 0) {
      console.error('seed:promo: promotions не пуста — набор уже засеян или база чужая');
      return 1;
    }
    const users = await pool.query(`SELECT id::text AS id, email FROM users`);
    const byEmail = new Map(users.rows.map((r) => [String(r.email), String(r.id)]));
    const u = (email: string) => {
      const id = byEmail.get(email);
      if (!id) throw new Error(`нет клиента ${email} — сначала seed:demo`);
      return id;
    };
    const HERO = u('a.morozov@northbay.capital');
    const ELENA = u('elena.fischer@fischer-holding.de');
    const SERGEY = u('volkov.s@mail.example');
    const OLGA = u('olga.lebedeva@example.org');
    const NATALIA = u('n.kuznetsova@example.com');
    const IGOR = u('igor.smirnov@example.net');
    const AISHA = u('aisha.rahman@example.ae');
    const PAVEL = u('p.novikov@example.ru');
    const LUKAS = u('lukas.weber@example.at');
    const TATIANA = u('t.popova@example.ru');
    const CHEN = u('chen.wei@example.sg');
    const ANNA = u('anna.belova@example.ru');
    const MARCO = u('m.bianchi@bianchi-trade.it');

    // ── Отпечатки: у seed:demo все сессии на двух IP — развести (иначе «общий IP» у всех).
    await pool.query(
      `WITH n AS (SELECT id, row_number() OVER (ORDER BY user_id, created_at) AS k FROM sessions)
       UPDATE sessions s SET ip = '198.51.100.' || (n.k % 250 + 1) FROM n WHERE n.id = s.id AND s.ip IS NOT NULL AND s.ip <> '127.0.0.1'`,
    );
    const countries: [string, string, string, string][] = [
      [HERO, 'CY', 'CY', '203.0.113.10'],
      [ELENA, 'DE', 'DE', '203.0.113.11'],
      [SERGEY, 'CY', 'CY', '203.0.113.12'],
      [OLGA, 'CY', 'CY', '203.0.113.13'],
      [NATALIA, 'CY', 'RU', '203.0.113.14'],
      [IGOR, 'CY', 'CY', '203.0.113.15'],
      [AISHA, 'AE', 'AE', '203.0.113.16'],
      [CHEN, 'SG', 'SG', '203.0.113.17'],
      [ANNA, 'CY', 'CY', '203.0.113.10'], // тот же IP регистрации, что у Морозова — самореферал
    ];
    for (const [id, c, ipc, ip] of countries) {
      await pool.query(`UPDATE users SET country = $2, registration_ip_country = $3, registration_ip = $4 WHERE id = $1`, [id, c, ipc, ip]);
    }

    // ── Тарифы портфелей (в демо — прямо в базе; в жизни — форма «Риск и плечо → Портфели»).
    await pool.query(`UPDATE leverage_portfolios SET markup_bps = 15, commission_bps = 0, instruments = 'Криптовалютные пары Binance (спот-котировки)', description = 'Для старта: без комиссии, стоимость — в спреде.' WHERE key = 'standard'`);
    await pool.query(`UPDATE leverage_portfolios SET markup_bps = 5, commission_bps = 4, instruments = 'Криптовалютные пары Binance (спот-котировки)', description = 'Для активной торговли: меньше наценка, небольшая комиссия.' WHERE key = 'pro'`);
    await pool.query(`UPDATE leverage_portfolios SET markup_bps = 0, commission_bps = 3, instruments = 'Криптовалютные пары Binance (спот-котировки)', description = 'Для крупных объёмов: чистый спред, только комиссия.' WHERE key = 'enc_prime'`);

    // ── Акции (решения владельца 10.11 — числа здесь как ВВОД админки, не код платформы).
    const reason = 'Решение владельца 10.11 (демо-набор)';
    async function promo(input: PromotionInput, activate = true): Promise<string> {
      const r = await createPromotion(P, { operatorId: ADMIN, reason, promotion: input });
      if (!r.ok) throw new Error(`promo ${input.slug}: ${r.reason} ${(r.issues ?? []).join('; ')}`);
      if (activate) {
        const a = await setPromotionStatus(P, { operatorId: ADMIN, reason: 'Запуск для показа', id: r.id, to: 'active' });
        if (!a.ok) throw new Error(`activate ${input.slug}: ${a.reason}`);
      }
      return r.id;
    }
    const common = { cmsPromoId: null, countriesAllow: [], countriesDeny: ['GB', 'AU'] };
    const WELCOME = await promo({
      ...common,
      slug: 'welcome-first-deposit',
      type: 'deposit_bonus',
      title: 'Бонус 30% на первый депозит',
      cmsPromoId: 'welcome30',
      rules: {
        percentBps: 3000, capMinor: 30_000, minDepositMinor: 50_000, firstDepositOnly: true, kycRequired: true,
        turnoverMultiplier: 30, minHoldSeconds: 120, windowDays: 30, forfeitOnWithdrawal: true,
      },
      texts: {
        ru: {
          title: '+30% к первому депозиту',
          summary: 'Пополните счёт от 500 USDT и получите 30% (до 300 USDT) деньгами на счёт после выполнения условий.',
          terms: 'Оборот 30× бонуса нотионалом в течение 30 дней со дня участия, сделки от 120 секунд, KYC обязателен. Вывод до выплаты аннулирует участие. Начисление — после проверки.',
        },
        en: { title: '+30% on your first deposit', summary: 'Deposit 500 USDT or more and get 30% (up to 300 USDT) in cash after conditions are met.', terms: '' },
      },
      startsAt: null,
      endsAt: new Date(NOW + 50 * DAY).toISOString(),
      budgetMinor: 200_000,
    });
    const REFERRAL = await promo({
      ...common,
      slug: 'invite-friend',
      type: 'referral',
      title: 'Пригласи друга — 25 + 25 USDT',
      rules: {
        referrerRewardMinor: 2_500, refereeRewardMinor: 2_500, kycRequired: true, minDepositMinor: 10_000,
        turnoverNotionalMinor: 1_000_000, minHoldSeconds: 120, windowDays: 30, maxPaidReferralsPerMonth: 10, forfeitOnWithdrawal: true,
      },
      texts: {
        ru: { title: '25 USDT вам и другу', summary: 'Друг проходит KYC, пополняет от 100 USDT и торгует на 10 000 USDT за 30 дней — обоим по 25 USDT.', terms: 'До 10 оплачиваемых друзей в месяц. Начисление — после проверки.' },
      },
      startsAt: null,
      endsAt: null,
      budgetMinor: 100_000,
    });
    const CASHBACK = await promo({
      ...common,
      slug: 'cashback-15',
      type: 'cashback',
      title: 'Кешбэк 15% от комиссий',
      rules: { percentBps: 1500, minPayoutMinor: 100, capPerPeriodMinor: 0, kycRequired: true },
      texts: { ru: { title: 'Кешбэк 15%', summary: 'Возвращаем 15% уплаченных наценки и комиссии — ежемесячно, деньгами на счёт.', terms: '' } },
      startsAt: null,
      endsAt: null,
      budgetMinor: 50_000,
    });
    const CUP = await promo({
      ...common,
      slug: 'demo-cup-november',
      type: 'contest',
      title: 'Кубок демо-трейдеров · ноябрь',
      rules: {
        startBalanceMinor: 1_000_000, minTrades: 3, prizeRequiresKyc: true, disqualifyOnReset: false,
        prizes: [ { place: 1, amountMinor: 50_000 }, { place: 2, amountMinor: 30_000 }, { place: 3, amountMinor: 20_000 } ],
      },
      texts: { ru: { title: 'Кубок демо-трейдеров', summary: 'Две недели торговли на демо со стартом 10 000 USD. Тройка лучших по доходности получает реальные USDT.', terms: 'Не меньше 3 закрытых сделок. Приз — после KYC.' } },
      startsAt: ago(5).toISOString(),
      endsAt: new Date(NOW + 9 * DAY).toISOString(),
      budgetMinor: 100_000,
    });
    const OCT = await promo({
      ...common,
      slug: 'demo-cup-october',
      type: 'contest',
      title: 'Кубок демо-трейдеров · октябрь',
      rules: {
        startBalanceMinor: 1_000_000, minTrades: 3, prizeRequiresKyc: true, disqualifyOnReset: false,
        prizes: [ { place: 1, amountMinor: 50_000 }, { place: 2, amountMinor: 30_000 }, { place: 3, amountMinor: 20_000 } ],
      },
      texts: { ru: { title: 'Кубок демо-трейдеров · октябрь', summary: '', terms: '' } },
      startsAt: ago(40).toISOString(),
      endsAt: ago(10).toISOString(),
      budgetMinor: 100_000,
    });
    await promo(
      {
        ...common,
        slug: 'spring-reload',
        type: 'deposit_bonus',
        title: 'Бонус на повторное пополнение (черновик)',
        rules: {
          percentBps: 1000, capMinor: 10_000, minDepositMinor: 20_000, firstDepositOnly: false, kycRequired: true,
          turnoverMultiplier: 20, minHoldSeconds: 120, windowDays: 14, forfeitOnWithdrawal: true,
        },
        texts: {},
        startsAt: null,
        endsAt: null,
        budgetMinor: 50_000,
      },
      false,
    );

    // ── Сделки реального счёта (с наценкой/комиссией — поля terminal demo-fees).
    let ev = 0;
    async function realTrip(user: string, startDaysAgo: number, holdSec: number, qty: number, price: number, fees = { c: 0, m: 0 }) {
      const open = ago(startDaysAgo);
      const close = new Date(open.getTime() + holdSec * 1000);
      for (const [side, at, pnl, c, m] of [
        ['buy', open, null, 0, 0],
        ['sell', close, Math.round(qty * price * 0.4), fees.c, fees.m],
      ] as const) {
        ev += 1;
        await pool.query(
          `INSERT INTO real_trades (id, user_id, event_id, trade_id, symbol, side, volume, price, realized_pnl_cents, executed_at, commission_minor, markup_minor, market_price)
           VALUES ($1,$2,$3,$4,'BTCUSDT',$5,$6,$7,$8,$9,$10,$11,$7)`,
          [randomUUID(), user, `promo-ev-${ev}`, `PT${ev}`, side, qty, price, pnl, at, side === 'sell' ? c : null, side === 'sell' ? m : null],
        );
      }
    }

    // Бонус на депозит: участия задним числом + сделки после вступления.
    const enroll = async (promotion: string, user: string, daysAgo: number) =>
      pool.query(
        `INSERT INTO promo_participations (promotion_id, user_id, status, enrolled_at) VALUES ($1,$2,'enrolled',$3)`,
        [promotion, user, ago(daysAgo)],
      );
    await enroll(WELCOME, HERO, 12);
    await enroll(WELCOME, SERGEY, 9);
    await enroll(WELCOME, OLGA, 6);
    await enroll(WELCOME, NATALIA, 4);
    await enroll(WELCOME, IGOR, 2);
    for (let k = 0; k < 4; k++) await realTrip(HERO, 11 - k, 600, 0.05, 68_000, { c: 140, m: 510 });
    for (let k = 0; k < 3; k++) await realTrip(SERGEY, 8 - k, 900, 0.05, 68_000, { c: 140, m: 510 });
    for (let k = 0; k < 12; k++) await realTrip(OLGA, 5 - k * 0.2, 30, 0.05, 68_000, { c: 140, m: 510 }); // короткие — не в зачёт
    await realTrip(NATALIA, 3, 400, 0.02, 68_000, { c: 55, m: 205 });
    // Лукас Вебер — участник «в процессе» (кабинет: прогресс по условиям): KYC пройден,
    // первый депозит после вступления, оборот выполнен частично, вывода нет.
    await enroll(WELCOME, LUKAS, 6);
    await pool.query(`UPDATE client_verification SET state = 'verified' WHERE user_id = $1`, [LUKAS]);
    await pool.query(
      `INSERT INTO crypto_deposits (user_id, tx_hash, status, from_address, to_address, amount_raw, amount_minor, block_time, credited_at, claimed_at, updated_at)
       VALUES ($1, md5(random()::text) || md5(random()::text), 'credited', 'TLw8kWeber3mNp4kLc2Vb9Hs3Df6Gj5Rt', 'TXyQ8cG6rWwP3b1hT9cTn2mE5sTq4xYb7K', 1000000000, 100000, $2, $2, $2, $2)`,
      [LUKAS, ago(5)],
    );
    await realTrip(LUKAS, 4, 600, 0.025, 68_000, { c: 70, m: 255 });

    // Общий кошелёк-отправитель: депозит Ольги — с кошелька Волкова.
    const sw = await pool.query(`SELECT from_address FROM crypto_deposits WHERE user_id = $1 AND from_address IS NOT NULL LIMIT 1`, [SERGEY]);
    await pool.query(
      `UPDATE crypto_deposits SET from_address = $2 WHERE id = (SELECT id FROM crypto_deposits WHERE user_id = $1 AND status = 'credited' LIMIT 1)`,
      [OLGA, sw.rows[0]?.from_address],
    );

    // ── Рефералы: Морозов привёл Кузнецову и Смирнова (депозит Смирнова — с кошелька Морозова: самореферал-сигнал);
    // Белова с тем же IP — отсечена при регистрации.
    const heroCode = await ensureReferralCode(P, HERO);
    await ensureReferralCode(P, SERGEY);
    const attrib = async (referee: string, referrer: string | null, daysAgo: number, extra: { status?: string; reason?: string; ib?: string | null; code?: string | null; promo?: string | null } = {}) =>
      pool.query(
        `INSERT INTO referral_attributions (referee_user_id, referrer_user_id, ib_partner_id, code, promo_slug, source, status, reject_reason, first_click_at, attributed_at, ip)
         VALUES ($1,$2,$3,$4,$5,'cookie',$6,$7,$8,$9,(SELECT registration_ip FROM users WHERE id = $1))`,
        [referee, referrer, extra.ib ?? null, extra.code ?? null, extra.promo ?? null, extra.status ?? 'active', extra.reason ?? null, ago(daysAgo + 1), ago(daysAgo)],
      );
    await attrib(NATALIA, HERO, 10, { code: heroCode });
    await attrib(IGOR, HERO, 3, { code: heroCode, promo: 'welcome-first-deposit' });
    await attrib(ANNA, HERO, 1, { code: heroCode, status: 'rejected', reason: 'same_ip' });
    await attrib(PAVEL, null, 2, { promo: 'welcome-first-deposit' });
    const heroWallet = await pool.query(`SELECT from_address FROM crypto_deposits WHERE user_id = $1 AND from_address IS NOT NULL LIMIT 1`, [HERO]);
    await pool.query(
      `INSERT INTO crypto_deposits (user_id, tx_hash, status, from_address, to_address, amount_raw, amount_minor, block_time, credited_at, claimed_at, updated_at)
       VALUES ($1, md5(random()::text) || md5(random()::text), 'credited', $2, 'TXyQ8cG6rWwP3b1hT9cTn2mE5sTq4xYb7K', 6000000000, 60000, $3, $3, $3, $3)`,
      [IGOR, heroWallet.rows[0]?.from_address, ago(1.8)],
    );
    // Смирнов прошёл KYC (для показа), пополнил с кошелька Морозова и проторговал.
    await pool.query(`UPDATE client_verification SET state = 'verified' WHERE user_id = $1`, [IGOR]);
    for (const d of [1.5, 1.0]) await realTrip(IGOR, d, 300, 0.08, 68_000, { c: 220, m: 815 });

    // ── IB-партнёры: Fischer — CPA, Волков — revshare.
    const ibCpa = await createIbPartner(P, {
      operatorId: ADMIN,
      reason: 'Договор IB №14/11, условия согласованы',
      partner: {
        client: 'elena.fischer@fischer-holding.de', displayName: 'Fischer Capital Partners', model: 'cpa', cpaAmountMinor: 7_500,
        cpaRules: { kycRequired: true, minDepositMinor: 10_000, turnoverNotionalMinor: 500_000, minHoldSeconds: 120, windowDays: 30 },
        revshareBps: null, status: 'active',
      },
    });
    const ibRev = await createIbPartner(P, {
      operatorId: ADMIN,
      reason: 'Договор IB №15/11 — доля дохода',
      partner: { client: 'volkov.s@mail.example', displayName: 'Volkov Trading Club', model: 'revshare', cpaAmountMinor: null, cpaRules: {}, revshareBps: 2500, status: 'active' },
    });
    if (!ibCpa.ok || !ibRev.ok) throw new Error('ib partner');
    await attrib(CHEN, ELENA, 6, { ib: ibCpa.id, code: (await ensureReferralCode(P, ELENA)) });
    await attrib(AISHA, ELENA, 15, { ib: ibCpa.id, code: (await ensureReferralCode(P, ELENA)) });
    await attrib(MARCO, SERGEY, 50, { ib: ibRev.id, code: (await ensureReferralCode(P, SERGEY)) });
    // Aisha выполняет CPA-условия: депозит + оборот (KYC у неё на проверке → верифицируем для показа).
    await pool.query(`UPDATE client_verification SET state = 'verified' WHERE user_id = $1`, [AISHA]);
    await pool.query(
      `INSERT INTO crypto_deposits (user_id, tx_hash, status, from_address, to_address, amount_raw, amount_minor, block_time, credited_at, claimed_at, updated_at)
       VALUES ($1, md5(random()::text) || md5(random()::text), 'credited', 'TQ1aisha8x7mNp4kLc2Vb9Hs3Df6Gj5Rt2', 'TXyQ8cG6rWwP3b1hT9cTn2mE5sTq4xYb7K', 1500000000, 150000, $2, $2, $2, $2)`,
      [AISHA, ago(13)],
    );
    for (let k = 0; k < 2; k++) await realTrip(AISHA, 12 - k, 900, 0.05, 68_000, { c: 140, m: 510 });

    // ── Кешбэк: участники с прошлого месяца, сделки с комиссией и наценкой в прошлом месяце.
    const prev = periodOf(new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() - 1, 15)));
    const prevMid = (Date.now() - Date.parse(`${prev}-15T12:00:00Z`)) / DAY;
    await enroll(CASHBACK, HERO, prevMid + 10);
    await enroll(CASHBACK, ELENA, prevMid + 8);
    await enroll(CASHBACK, SERGEY, prevMid + 5);
    for (let k = 0; k < 6; k++) await realTrip(HERO, prevMid - k, 1200, 0.2, 67_000, { c: 540, m: 2_010 });
    for (let k = 0; k < 4; k++) await realTrip(ELENA, prevMid - k, 1800, 0.3, 67_000, { c: 800, m: 3_015 });
    await realTrip(SERGEY, prevMid, 600, 0.01, 67_000); // без полей комиссии — кешбэк 0
    // Revshare: клиент партнёра Волкова торговал в прошлом месяце.
    for (let k = 0; k < 3; k++) await realTrip(MARCO, prevMid - k, 900, 0.5, 67_000, { c: 1_340, m: 5_025 });

    // ── Конкурсы: участники, база после сброса демо, закрытые демо-сделки в окне.
    async function contest(promotion: string, entries: [string, string, number, number[]][], windowStartDaysAgo: number) {
      for (const [user, status, baseline, pnls] of entries) {
        await pool.query(
          `INSERT INTO contest_entries (promotion_id, user_id, status, joined_at, baseline_minor, baseline_at)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [promotion, user, status, ago(windowStartDaysAgo + 0.5), status === 'active' ? baseline : null, status === 'active' ? ago(windowStartDaysAgo) : null],
        );
        for (const [k, pnl] of pnls.entries()) {
          ev += 1;
          await pool.query(
            `INSERT INTO demo_trades (id, user_id, event_id, trade_id, symbol, side, volume, price, realized_pnl_cents, executed_at)
             VALUES ($1,$2,$3,$4,'ETHUSDT','sell',1.5,3450,$5,$6)`,
            [randomUUID(), user, `promo-demo-${ev}`, `PD${ev}`, pnl, ago(windowStartDaysAgo - 0.5 - k * 0.6)],
          );
        }
      }
    }
    await contest(CUP, [
      [HERO, 'active', 1_000_000, [42_000, -8_500, 31_200, 12_400]],
      [IGOR, 'active', 1_000_000, [118_000, -22_000, 9_000]],
      [PAVEL, 'active', 1_000_000, [15_500, 4_200, -1_100, 6_000, 2_300]],
      [LUKAS, 'active', 1_000_000, [-35_000, -12_000, 8_000]],
      [TATIANA, 'active', 1_000_000, [250_000]],
      [CHEN, 'pending_reset', 1_000_000, []],
    ], 4);
    await contest(OCT, [
      [ELENA, 'active', 1_000_000, [64_000, 21_000, -5_000, 9_000]],
      [SERGEY, 'active', 1_000_000, [38_000, 12_000, 4_000]],
      [IGOR, 'active', 1_000_000, [140_000, -10_000, 7_000]],
      [NATALIA, 'active', 1_000_000, [-20_000, 6_000, 1_000]],
    ], 35);

    // ── Движок: пересчёт очереди, итоги октября, кешбэк и revshare за прошлый месяц.
    const s1 = await syncPromotionQueue(P, WELCOME);
    const s2 = await syncPromotionQueue(P, REFERRAL);
    const s3 = await syncIbCpa(P);
    const fin = await finalizeContest(P, { promotionId: OCT, operatorId: ADMIN, reason: 'Период завершён, лидерборд проверен' });
    const cb = await accrueCashback(P, { promotionId: CASHBACK, period: prev, operatorId: ADMIN, reason: 'Ежемесячный кешбэк' });
    const rs = await accrueIbRevshare(P, { partnerId: ibRev.id, period: prev, operatorId: ADMIN, reason: 'Ежемесячный расчёт по договору' });

    // ── Решения по очереди (против заглушки терминала): зачислено / отказ терминала / исход неизвестен / отклонено.
    const pick = async (kind: string, extra = '') =>
      (await pool.query(`SELECT id::text AS id FROM promo_rewards WHERE kind = $1 AND status = 'pending' ${extra} ORDER BY created_at LIMIT 1`, [kind])).rows[0]?.id as string | undefined;
    const login = 'm.orlova';
    const c1 = await pick('cashback');
    if (c1) await approveReward(P, stubTerminal('ok'), { rewardId: c1, operatorId: FINANCE, operatorLogin: login, reason: 'Кешбэк по выписке комиссий, связей нет' });
    const c2 = await pick('contest');
    if (c2) await approveReward(P, stubTerminal('ok'), { rewardId: c2, operatorId: FINANCE, operatorLogin: login, reason: '1-е место, KYC подтверждён' });
    const c3 = await pick('contest');
    if (c3) await approveReward(P, stubTerminal('refused'), { rewardId: c3, operatorId: FINANCE, operatorLogin: login, reason: '2-е место, KYC подтверждён' });
    const c4 = await pick('ib');
    if (c4) await approveReward(P, stubTerminal('unavailable'), { rewardId: c4, operatorId: ADMIN, operatorLogin: 'i.kovaleva', reason: 'CPA по договору №14/11' });
    const c5 = await pick('cashback');
    if (c5) await rejectReward(P, { rewardId: c5, operatorId: FINANCE, reason: 'Сделки клиента — встречные с другим счётом, требуется разбор' });

    const summary = await pool.query(`SELECT status, count(*)::int AS n FROM promo_rewards GROUP BY status ORDER BY status`);
    console.info(
      JSON.stringify(
        {
          promotions: { WELCOME, REFERRAL, CASHBACK, CUP, OCT },
          sync: { welcome: s1, referral: s2, ibCpa: s3 },
          finalize: fin,
          cashback: cb,
          revshare: rs,
          rewards: summary.rows,
          heroCode,
        },
        null,
        2,
      ),
    );
    return 0;
  } finally {
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
