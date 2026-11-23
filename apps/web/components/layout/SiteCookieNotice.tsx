'use client';

import { useTranslations } from 'next-intl';
import { CookieNotice } from '@broker/ui';
import { Link } from '@/i18n/navigation';

export function SiteCookieNotice() {
  const t = useTranslations('cookies');
  return (
    <CookieNotice acceptLabel={t('accept')} ariaLabel={t('aria')}>
      {t.rich('text', {
        policy: (chunks) => (
          <Link href="/legal/privacy" className="text-accent underline-offset-2 hover:underline">
            {chunks}
          </Link>
        ),
      })}
    </CookieNotice>
  );
}
