import { readAccountTypeTerms, type AccountTypeTerms, type PoolLike, type Queryable } from '@broker/money';
import {
  getClientPromotions,
  getContestLeaderboard,
  getMyPartner,
  getMyReferral,
  listContests,
  type ClientPromotionsView,
  type ContestLeaderboard,
  type ContestSummary,
  type MyPartnerView,
  type MyReferralView,
} from '@broker/promo';
import { envOr } from '@broker/utils';
import { getPool } from './db';

/**
 * Данные экранов «Акции», «Пригласи друга», «Конкурс», «Условия счетов».
 * Только серверный модуль. Всё — из `@broker/promo`/`@broker/money` (тексты,
 * числа, сроки задаёт админка), здесь лишь доступ к базе и размеченный
 * исход: сбой чтения — `unavailable`, экран объясняет, а не падает
 * (пусто ≠ сломалось).
 */

export type Loaded<T> = { state: 'ok'; data: T } | { state: 'unavailable' };

async function load<T>(what: string, fn: () => Promise<T>): Promise<Loaded<T>> {
  try {
    return { state: 'ok', data: await fn() };
  } catch (error) {
    console.error(`[promo] ${what}: не прочитано`, error);
    return { state: 'unavailable' };
  }
}

const db = () => getPool() as unknown as Queryable;
const pool = () => getPool() as unknown as PoolLike;

export function loadClientPromotions(userId: string, locale: string): Promise<Loaded<ClientPromotionsView>> {
  return load('акции', () => getClientPromotions(db(), userId, { locale }));
}

/**
 * База реферальной ссылки: `REFERRAL_LINK_BASE` (если ссылка должна вести
 * не на главную сайта), иначе публичный адрес сайта — его middleware
 * ставит first-click cookie и ведёт на регистрацию кабинета.
 */
export function referralLinkBase(locale: string): string | null {
  const explicit = envOr(process.env.REFERRAL_LINK_BASE, '');
  const site = explicit || envOr(process.env.NEXT_PUBLIC_SITE_URL, '');
  if (!site) return null;
  const base = site.replace(/\/$/, '');
  return locale === 'en' && !explicit ? `${base}/en` : `${base}/`;
}

export interface ReferralScreen {
  referral: MyReferralView;
  partner: MyPartnerView | null;
}

export function loadMyReferral(userId: string, locale: string): Promise<Loaded<ReferralScreen>> {
  return load('рефералы', async () => {
    const referral = await getMyReferral(pool(), userId, { locale, linkBase: referralLinkBase(locale) });
    const partner = referral.isPartner ? await getMyPartner(db(), userId) : null;
    return { referral, partner };
  });
}

export function loadContests(userId: string, locale: string): Promise<Loaded<ContestSummary[]>> {
  return load('конкурсы', () => listContests(db(), { locale, userId }));
}

export function loadLeaderboard(promotionId: string, userId: string, locale: string): Promise<Loaded<ContestLeaderboard | null>> {
  return load('лидерборд', () => getContestLeaderboard(db(), promotionId, { locale, userId, limit: 50 }));
}

export interface AccountTermsScreen {
  types: AccountTypeTerms[];
  /** Тип счёта клиента (портфель); нет строки — тип по умолчанию. `null` — не определён. */
  myKey: string | null;
}

export function loadAccountTerms(userId: string): Promise<Loaded<AccountTermsScreen>> {
  return load('условия счетов', async () => {
    const [types, mine] = await Promise.all([
      readAccountTypeTerms(db()),
      db().query(`SELECT portfolio_key FROM client_leverage WHERE user_id::text = $1`, [userId]),
    ]);
    const explicit = (mine.rows[0]?.portfolio_key as string | undefined) ?? null;
    const myKey = explicit ?? types.find((t) => t.isDefault)?.key ?? null;
    return { types, myKey };
  });
}
