'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { CookieNotice } from '@broker/ui';
import { usePathname } from '@/i18n/navigation';

/** Открыта ли сейчас экскурсия (её слой — `[data-tour-overlay]`). */
function useTourOpen(): boolean {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const check = () => setOpen(document.querySelector('[data-tour-overlay]') !== null);
    check();
    const observer = new MutationObserver(check);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);
  return open;
}

/**
 * Уведомление о cookie в кабинете. Не показываем во весь экран терминала и
 * пока идёт экскурсия: иначе на мобильном оно попадает в подсвеченную
 * область у кнопок внизу формы.
 */
export function CabinetCookieNotice({ policyHref }: { policyHref: string }) {
  const t = useTranslations('cookies');
  const pathname = usePathname();
  const tourOpen = useTourOpen();
  return (
    <CookieNotice acceptLabel={t('accept')} ariaLabel={t('aria')} hidden={tourOpen || pathname.startsWith('/terminal')}>
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
