import { useTranslations } from 'next-intl';
import { setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';

interface LayoutProps {
  children: React.ReactNode;
  params: { locale: string };
}

/**
 * Облегчённый layout для входа/регистрации: без полного меню и тикера,
 * ничто не отвлекает от конверсионного действия.
 */
export default function AuthLayout({ children, params }: LayoutProps) {
  setRequestLocale(params.locale);
  return <LayoutContent>{children}</LayoutContent>;
}

function LayoutContent({ children }: { children: React.ReactNode }) {
  const t = useTranslations('auth');
  return (
    <div className="flex min-h-svh flex-col">
      <header className="border-b border-border">
        <div className="mx-auto flex h-16 w-full max-w-page items-center justify-between px-4 sm:px-6 lg:px-8">
          <Link href="/" className="flex items-center gap-2 text-lg font-semibold text-primary">
            <span className="grid size-8 place-items-center rounded-lg bg-accent font-bold text-base">
              A
            </span>
            Apex Capital
          </Link>
          <Link href="/" className="text-sm text-secondary transition-colors hover:text-primary">
            {t('backHome')}
          </Link>
        </div>
      </header>
      <main className="flex flex-1 items-start justify-center px-4 py-10 sm:px-6 sm:py-14">
        {children}
      </main>
      <footer className="border-t border-border py-6">
        <p className="mx-auto max-w-page px-4 text-center text-xs text-secondary sm:px-6">
          {t('footerRisk', { year: new Date().getFullYear() })}
        </p>
      </footer>
    </div>
  );
}
