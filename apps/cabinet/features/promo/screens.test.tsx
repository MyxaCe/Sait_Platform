import { render, screen, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import type {
  ClientPromotionsView,
  ContestLeaderboard,
  ContestSummary,
  MyPartnerView,
  MyReferralView,
  ParticipationView,
} from '@broker/promo';
import type { AccountTypeTerms } from '@broker/money';
import messages from '@/messages/ru.json';
import { PromotionsModule } from '@/features/home/PromotionsModule';
import { AccountsScreen } from './AccountsScreen';
import { ContestScreen } from './ContestScreen';
import { PromotionsScreen } from './PromotionsScreen';
import { ReferralScreen } from './ReferralScreen';

/**
 * Экраны акций/рефералов/конкурса/условий счетов НЕ падают на пустых и
 * частичных данных и говорят, почему пусто (пусто ≠ сломалось). Деньги —
 * только денежным форматом; нет числа — «—», а не «0,00» (QA-05).
 */

vi.mock('@/lib/promo-actions', () => ({ enrollPromotionAction: () => undefined, joinContestAction: () => undefined }));
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
  usePathname: () => '/',
}));
vi.mock('react-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-dom')>();
  return { ...actual, useFormState: (_a: unknown, init: unknown) => [init, () => undefined], useFormStatus: () => ({ pending: false }) };
});

const NOW = new Date('2026-11-10T12:00:00Z');
const wrap = (ui: ReactNode) =>
  render(
    <NextIntlClientProvider locale="ru" messages={messages} timeZone="UTC">
      {ui}
    </NextIntlClientProvider>,
  );

const EMPTY: ClientPromotionsView = { enabled: true, disabledReason: null, available: [], participating: [], rewards: [] };

const inProgress: ParticipationView = {
  promotionId: '11111111-1111-4111-8111-111111111111',
  slug: 'welcome',
  type: 'deposit_bonus',
  texts: { title: 'Бонус к депозиту', summary: '', terms: 'Текст условий из админки' },
  rules: {
    type: 'deposit_bonus',
    percentBps: 3000,
    capMinor: 30_000,
    minDepositMinor: 50_000,
    firstDepositOnly: true,
    kycRequired: true,
    turnoverMultiplier: 30,
    minHoldSeconds: 120,
    windowDays: 30,
    forfeitOnWithdrawal: true,
  },
  status: 'enrolled',
  enrolledAt: '2026-11-04T00:00:00Z',
  state: 'in_progress',
  reason: null,
  conditions: [
    { key: 'deposit', met: true, current: 100_000, target: 50_000 },
    { key: 'kyc', met: true },
    { key: 'turnover', met: false, current: 340_000, target: 900_000 },
    { key: 'no_withdrawal', met: true },
    { key: 'window', met: true, current: 0, target: 0 },
  ],
  deadline: '2026-12-04T00:00:00Z',
  expectedRewardMinor: 30_000,
  cashback: null,
};

describe('«Акции»', () => {
  it('сбой чтения — объяснение, а не пустой экран', () => {
    wrap(<PromotionsScreen view={null} now={NOW} />);
    expect(screen.getByText(messages.promo.unavailableTitle)).toBeTruthy();
  });

  it('пусто — говорит, почему пусто; раздел начислений на месте', () => {
    wrap(<PromotionsScreen view={EMPTY} now={NOW} />);
    expect(screen.getByText(messages.promo.availableEmpty)).toBeTruthy();
    expect(screen.getByText(messages.promo.rewardsEmpty)).toBeTruthy();
  });

  it('акции в стране недоступны — честная причина, начисления клиента видны', () => {
    wrap(
      <PromotionsScreen
        view={{
          ...EMPTY,
          enabled: false,
          disabledReason: 'country_blocked',
          rewards: [
            {
              id: 'r1',
              kind: 'cashback',
              promotionId: null,
              promotionTitle: null,
              amountMinor: 2_490,
              currency: 'USDT',
              period: '2026-10',
              status: 'rejected',
              rejectReason: 'Встречные сделки',
              externalRef: 'x',
              createdAt: '2026-11-01T00:00:00Z',
              creditedAt: null,
            },
          ],
        }}
        now={NOW}
      />,
    );
    expect(screen.getByText(messages.promo.disabled.country_blocked.title)).toBeTruthy();
    expect(screen.queryByText(messages.promo.availableTitle)).toBeNull();
    expect(screen.getByText('Причина: Встречные сделки')).toBeTruthy();
    expect(screen.getByText(/24,90/)).toBeTruthy();
  });

  it('участие: прогресс по каждому условию, оборот прогресс-баром, срок и ожидаемая награда', () => {
    wrap(<PromotionsScreen view={{ ...EMPTY, participating: [inProgress] }} now={NOW} />);
    const card = screen.getByText('Бонус к депозиту').closest('article')!;
    const bar = within(card).getByRole('progressbar');
    expect(bar.getAttribute('aria-valuenow')).toBe('38');
    expect(card.querySelector('[data-condition="turnover"]')?.textContent).toContain('3 400,00 из 9 000,00 USDT');
    expect(within(card).getByText('Осталось 24 дня')).toBeTruthy();
    expect(card.textContent).toMatch(/Ожидаемая награда300,00/);
    expect(card.querySelector('[data-condition="no_withdrawal"]')?.getAttribute('data-met')).toBe('yes');
  });

  it('частичные данные: у оборота нет чисел — «—», а не «0,00» (QA-05); награда неизвестна — подпись', () => {
    const partial: ParticipationView = {
      ...inProgress,
      rules: null,
      conditions: [{ key: 'turnover', met: false }],
      deadline: null,
      expectedRewardMinor: null,
    };
    wrap(<PromotionsScreen view={{ ...EMPTY, participating: [partial] }} now={NOW} />);
    expect(screen.getByText('— из —')).toBeTruthy();
    expect(screen.queryByText(/0,00 из/)).toBeNull();
    expect(screen.getByText(messages.promo.expectedRewardPending)).toBeTruthy();
  });
});

describe('модуль акций на главной', () => {
  it('сбой — короткое честное сообщение; нечего показать — модуля нет', () => {
    const { container, unmount } = wrap(<PromotionsModule view={null} now={NOW} />);
    expect(screen.getByText(messages.promo.home.unavailable)).toBeTruthy();
    unmount();
    const empty = wrap(<PromotionsModule view={EMPTY} now={NOW} />);
    expect(empty.container.innerHTML).toBe('');
    expect(container).toBeTruthy();
  });
  it('участие — прогресс оборота', () => {
    wrap(<PromotionsModule view={{ ...EMPTY, participating: [inProgress] }} now={NOW} />);
    expect(screen.getByRole('progressbar')).toBeTruthy();
    expect(screen.getByText('3 из 4 условий выполнено')).toBeTruthy();
  });
});

const referral = (over: Partial<MyReferralView> = {}): MyReferralView => ({
  enabled: true,
  disabledReason: null,
  code: 'ABCD2345',
  link: 'https://site.example/?ref=ABCD2345',
  program: null,
  isPartner: false,
  invited: [],
  totals: { invited: 0, qualified: 0, creditedMinor: 0, processingMinor: 0 },
  ...over,
});

describe('«Пригласи друга»', () => {
  it('сбой — объяснение', () => {
    wrap(<ReferralScreen data={null} qrSvg={null} brand="B" />);
    expect(screen.getByText(messages.referrals.unavailableTitle)).toBeTruthy();
  });
  it('нет программы и приглашённых, нет ссылки — честные подписи, код виден', () => {
    wrap(<ReferralScreen data={{ referral: referral({ link: null }), partner: null }} qrSvg={null} brand="B" />);
    expect(screen.getByText(messages.referrals.noProgram)).toBeTruthy();
    expect(screen.getByText(messages.referrals.invitedEmpty)).toBeTruthy();
    expect(screen.getByText(messages.referrals.linkMissing)).toBeTruthy();
    expect(screen.getByTestId('referral-code').textContent).toBe('ABCD2345');
  });
  it('условия программы — из данных', () => {
    wrap(
      <ReferralScreen
        data={{
          referral: referral({
            program: {
              promotionId: 'p',
              texts: { title: 'Программа', summary: '', terms: '' },
              rules: {
                type: 'referral',
                referrerRewardMinor: 1_234,
                refereeRewardMinor: 567,
                kycRequired: true,
                minDepositMinor: 10_000,
                turnoverNotionalMinor: 1_000_000,
                minHoldSeconds: 0,
                windowDays: 30,
                maxPaidReferralsPerMonth: 0,
              },
            },
          }),
          partner: null,
        }}
        qrSvg={null}
        brand="B"
      />,
    );
    expect(screen.getByText(/12,34/)).toBeTruthy();
    expect(screen.getByText(/5,67/)).toBeTruthy();
  });
  it('IB-партнёр без договора в данных — блок партнёра с честной подписью вместо программы', () => {
    wrap(<ReferralScreen data={{ referral: referral({ isPartner: true }), partner: null }} qrSvg={null} brand="B" />);
    expect(screen.getAllByText(messages.referrals.partner.title).length).toBeGreaterThan(0);
    expect(screen.getByText(messages.referrals.partner.termsMissing)).toBeTruthy();
    expect(screen.queryByText(messages.referrals.noProgram)).toBeNull();
  });
  it('IB revshare — доля из б.п., начисления по месяцам', () => {
    const partner: MyPartnerView = {
      displayName: 'Club',
      model: 'revshare',
      cpaAmountMinor: null,
      cpaRules: null,
      revshareBps: 2500,
      rewards: [{ period: '2026-10', amountMinor: 4_773, status: 'processing', createdAt: '2026-11-01T00:00:00Z' }],
    };
    wrap(<ReferralScreen data={{ referral: referral({ isPartner: true }), partner }} qrSvg={null} brand="B" />);
    expect(screen.getByTestId('partner-block').textContent).toContain('25 %');
    expect(screen.getByText(/47,73/)).toBeTruthy();
  });
});

const contest = (over: Partial<ContestSummary> = {}): ContestSummary => ({
  promotionId: 'c1',
  slug: 'cup',
  texts: { title: 'Кубок', summary: '', terms: '' },
  rules: { type: 'contest', startBalanceMinor: 1_000_000, minTrades: 3, prizes: [], prizeRequiresKyc: false },
  startsAt: '2026-11-05T00:00:00Z',
  endsAt: '2026-11-19T00:00:00Z',
  phase: 'running',
  participants: 0,
  myStatus: null,
  ...over,
});

describe('«Конкурс»', () => {
  it('сбой и пустой список — объяснения', () => {
    const a = wrap(<ContestScreen contests={null} selected={null} board={null} demoCurrency="USD" now={NOW} />);
    expect(screen.getByText(messages.contest.unavailableTitle)).toBeTruthy();
    a.unmount();
    wrap(<ContestScreen contests={[]} selected={null} board={null} demoCurrency="USD" now={NOW} />);
    expect(screen.getByText(messages.contest.empty)).toBeTruthy();
  });
  it('без призов и лидеров — не падает; «Участвовать» доступно', () => {
    const c = contest();
    const board: ContestLeaderboard = { contest: c, final: false, computedAt: NOW.toISOString(), rows: [], me: null };
    wrap(<ContestScreen contests={[c]} selected={c} board={board} demoCurrency="USD" now={NOW} />);
    expect(screen.getByText(messages.contest.leaderboardEmpty)).toBeTruthy();
    expect(screen.getByRole('button', { name: messages.contest.join })).toBeTruthy();
  });
  it('моё место закреплено; если я ниже выдачи — дописан в таблицу', () => {
    const c = contest({ myStatus: 'active', participants: 60 });
    const me = { place: 57, returnBps: -120, pnlMinor: -12_000, tradesCount: 4, ineligible: null, prizeMinor: null, displayName: 'Алексей М.', isMe: true };
    const top = { place: 1, returnBps: 2843, pnlMinor: 1, tradesCount: 3, ineligible: null, prizeMinor: 50_000, displayName: 'Татьяна П.', isMe: false };
    const board: ContestLeaderboard = { contest: c, final: false, computedAt: NOW.toISOString(), rows: [top], me };
    wrap(<ContestScreen contests={[c]} selected={c} board={board} demoCurrency="USD" now={NOW} />);
    expect(screen.getByTestId('my-place').textContent).toContain('#57');
    const rows = screen.getByTestId('leaderboard').querySelectorAll('tbody tr');
    expect(rows).toHaveLength(2);
    expect(rows[1]!.getAttribute('data-me')).toBe('yes');
    expect(screen.queryByRole('button', { name: messages.contest.join })).toBeNull();
  });
  it('без места: сколько сделок не хватает', () => {
    const c = contest({ myStatus: 'active' });
    const me = { place: null, returnBps: null, pnlMinor: 0, tradesCount: 1, ineligible: 'min_trades' as const, prizeMinor: null, displayName: 'Я', isMe: true };
    const board: ContestLeaderboard = { contest: c, final: false, computedAt: NOW.toISOString(), rows: [], me };
    wrap(<ContestScreen contests={[c]} selected={c} board={board} demoCurrency="USD" now={NOW} />);
    expect(screen.getByTestId('my-place').textContent).toContain('Нужно ещё 2 сделки');
  });
});

describe('«Условия счетов»', () => {
  const pro: AccountTypeTerms = {
    key: 'pro',
    title: 'Pro',
    isDefault: false,
    sortOrder: 1,
    leverage: 50,
    baseLeverage: 50,
    classOverrides: {},
    markupBps: 5,
    commissionBps: 4,
    instruments: null,
    description: null,
  };
  it('нет данных — «временно недоступны», ни одной цифры', () => {
    const { container } = wrap(<AccountsScreen data={null} />);
    expect(screen.getByText(messages.accounts.unavailableTitle)).toBeTruthy();
    expect(container.textContent).not.toMatch(/1:\d/);
  });
  it('пустой список — честная подпись', () => {
    wrap(<AccountsScreen data={{ types: [], myKey: null }} />);
    expect(screen.getByText(messages.accounts.empty)).toBeTruthy();
  });
  it('условия — из данных; «ваш тип» отмечен; нет инструментов — «не указано»', () => {
    wrap(<AccountsScreen data={{ types: [pro, { ...pro, key: 'std', title: 'Std', markupBps: 15, commissionBps: 0, leverage: 10, classOverrides: { crypto: 10 } }], myKey: 'pro' }} />);
    const mine = document.querySelector('[data-account-type="pro"]')!;
    expect(mine.textContent).toContain(messages.accounts.yours);
    expect(mine.textContent).toContain('Спред + 0,05 % и комиссия 0,04 % от суммы сделки');
    expect(mine.textContent).toContain('до 1:50');
    expect(mine.textContent).toContain(messages.accounts.notSpecified);
    const std = document.querySelector('[data-account-type="std"]')!;
    expect(std.textContent).toContain('Криптовалюты: до 1:10');
    expect(std.textContent).not.toContain(messages.accounts.yours);
  });
});

describe('валюта реальных денег — USDT (решение штаба 10.11)', () => {
  it('начисления из терминала в USD показываются в USDT; «USD» рядом с «USDT» нет', () => {
    const { container } = wrap(
      <PromotionsScreen
        view={{
          ...EMPTY,
          participating: [inProgress],
          rewards: [
            {
              id: 'r1',
              kind: 'promo',
              promotionId: null,
              promotionTitle: 'Бонус',
              amountMinor: 30_000,
              currency: 'USD',
              period: null,
              status: 'credited',
              rejectReason: null,
              externalRef: 'x',
              createdAt: '2026-11-01T00:00:00Z',
              creditedAt: '2026-11-02T00:00:00Z',
            },
          ],
        }}
        now={NOW}
      />,
    );
    const text = container.textContent ?? '';
    expect(text).toContain('USDT');
    expect(text).not.toMatch(/USD(?!T)/);
  });

  it('партнёр: начисления и итоги — USDT', () => {
    const partner: MyPartnerView = {
      displayName: 'Club',
      model: 'cpa',
      cpaAmountMinor: 7_500,
      cpaRules: null,
      revshareBps: null,
      rewards: [{ period: null, amountMinor: 7_500, status: 'credited', createdAt: '2026-11-01T00:00:00Z' }],
    };
    const { container } = wrap(
      <ReferralScreen data={{ referral: referral({ isPartner: true }), partner }} qrSvg={null} brand="B" />,
    );
    expect(container.textContent ?? '').not.toMatch(/USD(?!T)/);
  });
});
