import { getFormatter, getTranslations, setRequestLocale } from 'next-intl/server';
import { ToneBadge, cn } from '@broker/ui';
import { Segmented } from '@/features/ui/Segmented';
import { PAGE_NARROW } from '@/features/ui/page';
import { NavIcon } from '@/features/shell/NavIcon';
import { requireSessionUser } from '@/lib/auth/require';
import { getVerificationState } from '@/lib/kyc';
import {
  AccountOverview,
  DocumentsSection,
  PersonalSection,
  SecuritySection,
  VerificationSection,
} from '@/features/profile/ProfileSections';
// ── Поддержка: подтверждение email (ветка demo-support) ──
import { EmailVerifyNotice } from '@/features/auth/EmailVerifyNotice';

/**
 * «Профиль» (r2, замечание владельца): личные данные, верификация,
 * безопасность и документы — одна страница с вкладками (`?tab=`, без JS).
 * Старые `/verification`, `/security`, `/documents` ведут сюда.

 */
export const dynamic = 'force-dynamic';

const TABS = ['personal', 'verification', 'security', 'documents'] as const;
type Tab = (typeof TABS)[number];

export default async function ProfilePage({
  params,
  searchParams,
}: {
  params: { locale: string };
  searchParams: { tab?: string };
}) {
  setRequestLocale(params.locale);
  const user = await requireSessionUser(params.locale);
  const t = await getTranslations('profile');
  const th = await getTranslations('home');
  const format = await getFormatter();
  const tab: Tab = (TABS as readonly string[]).includes(searchParams.tab ?? '') ? (searchParams.tab as Tab) : 'personal';
  const state = (await getVerificationState(user.id)) ?? 'unverified';
  const initials = user.fullName
    .split(' ')
    .map((w) => w.charAt(0))
    .slice(0, 2)
    .join('')
    .toUpperCase();

  const icon = (name: 'profile' | 'verification' | 'security' | 'documents') => (
    <NavIcon name={name} className="hidden size-[18px] shrink-0 xl:block" />
  );

  /*
   * Раскладка (десктоп, 10.11). < xl — прежняя колонка: шапка → 2×2
   * переключатель → раздел. ≥ xl: слева колонка (карточка клиента + меню
   * разделов вертикально, липкая), справа содержимое раздела в две колонки
   * (сами разделы раскладываются сеткой на xl).
   */
  return (
    <div className={cn(PAGE_NARROW, 'space-y-5 xl:grid xl:grid-cols-12 xl:items-start xl:gap-5 xl:space-y-0')}>
      <div className="space-y-5 xl:sticky xl:top-6 xl:col-span-3 xl:space-y-4">
        <div className="xl:rounded-2xl xl:border xl:border-border xl:bg-elevated xl:p-5">
          <div className="flex items-center gap-4 xl:flex-col xl:items-start xl:gap-3">
            <span
              aria-hidden
              className="grid size-14 shrink-0 place-items-center rounded-full bg-accent/15 text-lg font-semibold text-accent ring-1 ring-inset ring-accent/25"
            >
              {initials}
            </span>
            <div className="min-w-0">
              <h1 className="truncate text-xl font-semibold tracking-tight sm:text-2xl">{user.fullName}</h1>
              <p className="truncate text-sm text-secondary">{user.email}</p>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-secondary">
                <span className="inline-flex h-[22px] items-center rounded-md bg-primary/[0.06] px-2 tabular-nums">
                  UID {user.uid ?? '—'}
                </span>
                <ToneBadge
                  tone={state === 'verified' ? 'positive' : state === 'pending' ? 'warning' : state === 'rejected' ? 'negative' : 'neutral'}
                >
                  {th(state === 'verified' ? 'kycVerified' : state === 'pending' ? 'kycPending' : state === 'rejected' ? 'kycRejected' : 'kycNone')}
                </ToneBadge>
                <span>{t('memberSince', { date: format.dateTime(user.createdAt, { dateStyle: 'long' }) })}</span>
              </div>
            </div>
          </div>
        </div>

        {/* 4 раздела: на телефоне — сетка 2×2, на ≥ sm — строка, на ≥ xl —
            вертикальное меню слева. */}
        <Segmented
          vertical
          label={t('tabsLabel')}
          active={tab}
          className="grid grid-cols-2 gap-1 sm:flex"
          items={[
            { key: 'personal', label: <>{icon('profile')}{t('tabPersonal')}</>, href: '/profile' },
            { key: 'verification', label: <>{icon('verification')}{t('tabVerification')}</>, href: '/profile?tab=verification' },
            { key: 'security', label: <>{icon('security')}{t('tabSecurity')}</>, href: '/profile?tab=security' },
            { key: 'documents', label: <>{icon('documents')}{t('tabDocuments')}</>, href: '/profile?tab=documents' },
          ]}
        />
      </div>

      <div className="space-y-5 xl:col-span-9">
        {/* Поддержка (demo-support): напоминание подтвердить email — над личными данными. */}
        {tab === 'personal' ? <EmailVerifyNotice userId={user.id} /> : null}
        {tab === 'personal' ? (
          <div className="xl:grid xl:grid-cols-2 xl:items-start xl:gap-5">
            <PersonalSection user={user} />
            <div className="hidden xl:block">
              <AccountOverview userId={user.id} state={state} />
            </div>
          </div>
        ) : null}
        {tab === 'verification' ? <VerificationSection userId={user.id} state={state} /> : null}
        {tab === 'security' ? <SecuritySection userId={user.id} /> : null}
        {tab === 'documents' ? <DocumentsSection userId={user.id} /> : null}
      </div>
    </div>
  );
}
