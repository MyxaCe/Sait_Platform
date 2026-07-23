'use client';

import { useLocale } from 'next-intl';
import { Link, usePathname } from '@/i18n/navigation';

/**
 * Переключатель языка: ведёт на текущую страницу в другой локали.
 * usePathname из i18n-навигации возвращает путь без префикса локали,
 * поэтому ссылка всегда корректна.
 */
export function LangSwitcher() {
  const locale = useLocale();
  const pathname = usePathname();
  const target = locale === 'ru' ? 'en' : 'ru';

  return (
    <Link
      href={pathname}
      locale={target}
      aria-label={target === 'en' ? 'Switch to English' : 'Переключить на русский'}
      className="grid h-11 min-w-11 place-items-center rounded-lg px-2 text-sm font-semibold text-secondary transition-colors hover:bg-primary/5 hover:text-primary"
    >
      {target.toUpperCase()}
    </Link>
  );
}
