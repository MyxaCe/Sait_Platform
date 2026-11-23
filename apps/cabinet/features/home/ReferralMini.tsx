import { getTranslations } from 'next-intl/server';
import type { MyReferralView } from '@broker/promo';
import { cn } from '@broker/ui';
import { Link } from '@/i18n/navigation';
import { NavIcon } from '@/features/shell/NavIcon';
import { linkButton } from '@/features/ui/link-button';

/**
 * «Пригласи друга» на Обзоре. `wide` — горизонтальная раскладка на всю ширину
 * колонки счетов (закрывает место под карточками реального и демо-счёта).
 */
export async function ReferralMini({ referral, wide = false }: { referral: MyReferralView | null; wide?: boolean }) {
  if (!referral || (!referral.enabled && !referral.isPartner)) return null;
  const t = await getTranslations('home');
  const title = referral.program?.texts.title || t('referralTitle');
  const summary = referral.program?.texts.summary || t('referralLead');

  return (
    <section
      aria-labelledby="home-ref"
      data-home-referral
      className={cn(
        'flex h-full min-w-0 flex-col rounded-2xl border border-accent/30 bg-accent/[0.05] p-5',
        wide && 'lg:flex-row lg:items-center lg:gap-6',
      )}
    >
      <div className={cn('min-w-0', wide && 'lg:flex-1')}>
        <div className="flex items-center gap-2.5">
          <span aria-hidden className="grid size-8 shrink-0 place-items-center rounded-full bg-accent/15 text-accent">
            <NavIcon name="friends" className="size-[18px]" />
          </span>
          <h2 id="home-ref" className="font-semibold">
            {title}
          </h2>
        </div>
        <p className={cn('mt-2 text-sm text-secondary', !wide && 'flex-1')}>{summary}</p>
      </div>
      <dl className={cn('mt-3 flex items-end justify-between gap-6', wide && 'lg:mt-0 lg:shrink-0')}>
        <div>
          <dt className="text-xs text-muted">{t('referralCode')}</dt>
          <dd className="font-mono text-[15px] font-semibold tracking-[0.12em]">{referral.code}</dd>
        </div>
        <div className="text-right">
          <dt className="text-xs text-muted">{t('referralInvited')}</dt>
          <dd className="text-[15px] font-semibold tabular-nums">{referral.totals.invited}</dd>
        </div>
      </dl>
      <Link href="/referrals" className={linkButton('primary', cn('mt-4 w-full', wide && 'lg:mt-0 lg:w-auto lg:shrink-0 lg:px-6'))}>
        {t('referralOpen')}
      </Link>
    </section>
  );
}
