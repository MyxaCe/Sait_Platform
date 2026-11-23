'use client';

import { useTranslations } from 'next-intl';
import { CookieNotice } from '@broker/ui';
import { usePathname } from '@/i18n/navigation';

/** Уведомление о cookie в кабинете; во весь экран терминала не показываем. */
export function CabinetCookieNotice({ policyHref }: { policyHref: string }) {
  const t = useTranslations('cookies');
  const pathname = usePathname();
  return (
    <CookieNotice acceptLabel={t('accept')} ariaLabel={t('aria')} hidden={pathname.startsWith('/terminal')}>
      {t.rich('text', {
        policy: (chunks) => (
          <a href={policyHref} target="_blank" rel="noopener noreferrer" className="text-accent underline-offset-2 hover:underline">
            {chunks}
          </a>
        ),
      })}
    </CookieNotice>
  );
}
