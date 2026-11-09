import { getTranslations } from 'next-intl/server';
import { ToneBadge, type StatusTone } from '@broker/ui';
import type { SessionUser } from '@/lib/auth/session';
import type { VerificationStatus } from '@/lib/home';

const KYC: Record<VerificationStatus, { tone: StatusTone; key: 'kycVerified' | 'kycPending' | 'kycNone' | 'kycRejected' }> = {
  approved: { tone: 'positive', key: 'kycVerified' },
  pending: { tone: 'warning', key: 'kycPending' },
  none: { tone: 'neutral', key: 'kycNone' },
  rejected: { tone: 'negative', key: 'kycRejected' },
};

/** Модуль «Профиль»: монограмма, имя, UID, VIP и статус верификации. */
export async function ProfileModule({
  user,
  verification,
}: {
  user: SessionUser;
  verification: VerificationStatus;
}) {
  const t = await getTranslations('home');
  const initials = user.fullName
    .split(' ')
    .map((w) => w.charAt(0))
    .slice(0, 2)
    .join('')
    .toUpperCase();
  const kyc = KYC[verification];

  return (
    <section className="flex items-center gap-4">
      <span
        aria-hidden
        className="grid size-12 shrink-0 place-items-center rounded-full bg-accent/15 text-[16px] font-semibold text-accent ring-1 ring-inset ring-accent/25"
      >
        {initials}
      </span>
      <div className="min-w-0">
        <h1 className="truncate text-xl font-semibold tracking-tight">{user.fullName}</h1>
        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-secondary">
          {/* Прочерк, а не ноль: «UID 0» выглядит как настоящий номер. */}
          <span className="inline-flex h-[22px] items-center rounded-md bg-primary/[0.06] px-2 tabular-nums">
            UID {user.uid ?? '—'}
          </span>
          <span className="inline-flex h-[22px] items-center rounded-md bg-accent/[0.14] px-2 font-medium text-accent">
            VIP {user.vipLevel}
          </span>
          <ToneBadge tone={kyc.tone}>{t(kyc.key)}</ToneBadge>
        </div>
      </div>
    </section>
  );
}
