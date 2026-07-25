import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { logoutAction } from '@/lib/actions';
import type { SessionUser } from '@/lib/auth/session';
import type { ChromeBrand } from '@/lib/chrome';

/**
 * Шапка ЛК (ADR-026, п.1 задания): бренд-зона как у сайта (логотип+имя
 * из CMS) слева, пользователь и выход справа. Навигация остаётся сайдбаром.
 */
export async function CabinetHeader({
  brand,
  user,
  locale,
}: {
  brand: ChromeBrand | null;
  user: SessionUser;
  locale: string;
}) {
  const t = await getTranslations('common');
  const brandName = brand?.name ?? t('brand');

  return (
    <header className="sticky top-0 z-50 flex h-16 items-center justify-between gap-4 border-b border-border bg-base/80 px-4 backdrop-blur-xl sm:px-6 lg:px-8">
      <Link href="/" className="flex items-center gap-2 text-lg font-semibold text-primary">
        {brand?.logo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={brand.logo.url} alt={brand.logo.alt || brandName} className="h-8 w-auto" />
        ) : (
          <span className="grid size-8 place-items-center rounded-lg bg-accent font-bold text-base">
            {brandName.charAt(0)}
          </span>
        )}
        <span className="hidden sm:inline">{brandName}</span>
        <span className="rounded-md bg-primary/10 px-1.5 py-0.5 text-xs font-medium text-secondary">
          {t('cabinet')}
        </span>
      </Link>

      <div className="flex items-center gap-3">
        <div className="hidden text-right sm:block">
          <p className="max-w-48 truncate text-sm text-primary">{user.fullName}</p>
          <p className="text-xs text-secondary">UID {user.uid}</p>
        </div>
        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-accent/20 text-sm font-semibold text-accent">
          {user.fullName.charAt(0).toUpperCase()}
        </span>
        <form action={logoutAction}>
          <input type="hidden" name="uiLocale" value={locale} />
          <button
            type="submit"
            className="rounded-lg px-3 py-2 text-sm text-secondary transition-colors hover:bg-primary/5 hover:text-negative"
          >
            {t('logout')}
          </button>
        </form>
      </div>
    </header>
  );
}
