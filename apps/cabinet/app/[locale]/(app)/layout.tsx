import { getTranslations, setRequestLocale } from 'next-intl/server';
import { redirect } from 'next/navigation';
import { Link } from '@/i18n/navigation';
import { getSessionUser } from '@/lib/auth/session';
import { countUnread } from '@/lib/data';
import { logoutAction } from '@/lib/actions';
import { NavLink } from '@/features/shell/NavLink';

interface LayoutProps {
  children: React.ReactNode;
  params: { locale: string };
}

/** Защищённая зона: настоящая валидация сессии (middleware проверяет только куку). */
export default async function AppLayout({ children, params }: LayoutProps) {
  setRequestLocale(params.locale);
  const user = await getSessionUser();
  if (!user) {
    redirect(params.locale === 'en' ? '/en/login' : '/login');
  }

  const [tNav, tCommon, unread] = await Promise.all([
    getTranslations('nav'),
    getTranslations('common'),
    countUnread(user.id),
  ]);

  const nav = [
    { href: '/', label: tNav('dashboard') },
    { href: '/trade', label: tNav('trade') },
    { href: '/profile', label: tNav('profile') },
    { href: '/security', label: tNav('security') },
    { href: '/documents', label: tNav('documents') },
    { href: '/notifications', label: tNav('notifications'), badge: unread },
  ];

  return (
    <div className="flex min-h-svh">
      <aside className="hidden w-64 shrink-0 flex-col border-r border-border bg-elevated p-4 lg:flex">
        <Link href="/" className="mb-8 flex items-center gap-2 px-2 text-lg font-semibold">
          <span className="grid size-8 place-items-center rounded-lg bg-accent font-bold text-base">
            {tCommon('brand').charAt(0)}
          </span>
          {tCommon('cabinet')}
        </Link>
        <nav className="flex flex-1 flex-col gap-1">
          {nav.map((item) => (
            <NavLink key={item.href} href={item.href} badge={item.badge}>
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-border pt-4">
          <p className="truncate px-2 text-sm text-primary">{user.fullName}</p>
          <p className="truncate px-2 text-xs text-secondary">{user.email}</p>
          <form action={logoutAction} className="mt-3 px-2">
            <input type="hidden" name="uiLocale" value={params.locale} />
            <button type="submit" className="text-sm text-secondary transition-colors hover:text-negative">
              {tCommon('logout')} →
            </button>
          </form>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Мобильная шапка + нижняя навигация */}
        <header className="flex h-14 items-center justify-between border-b border-border bg-elevated px-4 lg:hidden">
          <span className="font-semibold">{tCommon('cabinet')}</span>
          <form action={logoutAction}>
            <input type="hidden" name="uiLocale" value={params.locale} />
            <button type="submit" className="text-sm text-secondary">
              {tCommon('logout')}
            </button>
          </form>
        </header>

        <main className="flex-1 px-4 py-6 pb-24 sm:px-6 lg:px-10 lg:pb-6">{children}</main>

        <nav className="fixed inset-x-0 bottom-0 z-40 flex border-t border-border bg-elevated lg:hidden">
          {nav.map((item) => (
            <NavLink key={item.href} href={item.href} badge={item.badge} mobile>
              {item.label}
            </NavLink>
          ))}
        </nav>
      </div>
    </div>
  );
}
