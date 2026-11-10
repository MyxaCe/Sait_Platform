import { getTranslations } from 'next-intl/server';
import type { MyReferralView } from '@broker/promo';
import { Link } from '@/i18n/navigation';
import { NavIcon } from '@/features/shell/NavIcon';
import { linkButton } from '@/features/ui/link-button';

/**
 * Мини-карточка «Пригласи друга» на главной (десктоп-раскладка): условия
 * одной строкой из действующей программы, код, сколько приглашено, переход в
 * раздел. Данные — те же, что в «Пригласи друга»; программа выключена или не
 * загрузилась — карточки нет (раздел объясняет причину сам).
 */
export async function ReferralMini({ referral }: { referral: MyReferralView | null }) {
  if (!referral || (!referral.enabled && !referral.isPartner)) return null;
  const t = await getTranslations('home');
  const title = referral.program?.texts.title || t('referralTitle');
  const summary = referral.program?.texts.summary || t('referralLead');

  return (
    <section
      aria-labelledby="home-ref"
      className="flex h-full flex-col rounded-2xl border border-accent/30 bg-accent/[0.05] p-5"
    >
      <div className="flex items-center gap-2.5">
        <span aria-hidden className="grid size-8 place-items-center rounded-full bg-accent/15 text-accent">
          <NavIcon name="friends" className="size-[18px]" />
        </span>
        <h2 id="home-ref" className="font-semibold">
          {title}
        </h2>
      </div>
      <p className="mt-2 flex-1 text-sm text-secondary">{summary}</p>
      <dl className="mt-3 flex items-end justify-between gap-3">
        <div>
          <dt className="text-xs text-muted">{t('referralCode')}</dt>
          <dd className="font-mono text-[15px] font-semibold tracking-[0.12em]">{referral.code}</dd>
        </div>
        <div className="text-right">
          <dt className="text-xs text-muted">{t('referralInvited')}</dt>
          <dd className="text-[15px] font-semibold tabular-nums">{referral.totals.invited}</dd>
        </div>
      </dl>
      <Link href="/referrals" className={linkButton('primary', 'mt-4 w-full')}>
        {t('referralOpen')}
      </Link>
    </section>
  );
}
