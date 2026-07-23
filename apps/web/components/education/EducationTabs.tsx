'use client';

import { useTranslations } from 'next-intl';
import { Link, usePathname } from '@/i18n/navigation';
import { cn } from '@broker/ui';

export function EducationTabs() {
  const t = useTranslations('education');
  const pathname = usePathname();

  const tabs = [
    { href: '/education/articles', label: t('tabArticles') },
    { href: '/education/webinars', label: t('tabWebinars') },
    { href: '/education/glossary', label: t('tabGlossary') },
    { href: '/education/faq', label: t('tabFaq') },
  ];

  return (
    <nav aria-label={t('tabsAria')} className="-mx-4 overflow-x-auto px-4"
         style={{ scrollbarWidth: 'none' }}>
      <div className="flex gap-2 border-b border-border">
        {tabs.map((tab) => {
          const active = pathname.startsWith(tab.href);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'whitespace-nowrap border-b-2 px-4 py-3 text-sm transition-colors',
                active
                  ? 'border-accent font-medium text-primary'
                  : 'border-transparent text-secondary hover:text-primary',
              )}
            >
              {tab.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
