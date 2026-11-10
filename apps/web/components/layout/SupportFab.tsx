import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';

/**
 * Кнопка «Поддержка» витрины (решение владельца 10.11): гостю — не чат, а
 * форма обращения → тикет, ответ на почту. Чат — только в кабинете (для
 * вошедших). Ведёт к форме на странице контактов.
 */
export async function SupportFab({ locale }: { locale: 'ru' | 'en' }) {
  const t = await getTranslations({ locale, namespace: 'supportFab' });
  return (
    <Link
      href="/company/contacts#write-us"
      aria-label={t('aria')}
      className="fixed bottom-5 right-5 z-40 inline-flex h-12 items-center gap-2 rounded-full bg-accent px-4 text-sm font-medium text-on-accent shadow-lg hover:bg-accent-hover"
    >
      <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M4 5h16v11H9l-5 4zM8 9h8M8 12h5" />
      </svg>
      {t('label')}
    </Link>
  );
}
