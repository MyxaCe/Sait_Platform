import { getTranslations, setRequestLocale } from 'next-intl/server';
import { cn } from '@broker/ui';
import { Link } from '@/i18n/navigation';
import { TerminalFrame } from '@/features/trade/TerminalFrame';
import { NavIcon } from '@/features/shell/NavIcon';
import { requireSessionUser } from '@/lib/auth/require';
import { tenantSlug } from '@/lib/sso/jwt';

/**
 * Терминал НА ВЕСЬ ЭКРАН (замечание владельца r2): без сайдбара, шапки,
 * футера и нижней навигации кабинета. Единственная «рамка» — полоса 44 px:
 * «← Кабинет» (дорога назад, которой в самом терминале нет), переключатель
 * счёта Демо / Реальный и выход не нужен — он в кабинете.
 *
 * Почему та же вкладка, а не новая: на телефоне новая вкладка — это потерянный
 * кабинет (переключатель вкладок спрятан), а «назад» браузера и кнопка
 * «Кабинет» возвращают ровно туда, откуда пришли. SSO остаётся прежним
 * (postMessage в iframe, ADR-023): терминал сегодня принимает handoff только
 * от родительского окна. Полный переход на домен терминала верхним уровнем —
 * после доработки терминала (см. отчёт r2: вход по токену во фрагменте URL +
 * `return_url` для кнопки «В кабинет»).
 */
export default async function TerminalPage({
  params,
  searchParams,
}: {
  params: { locale: string };
  searchParams: { account?: string };
}) {
  setRequestLocale(params.locale);
  await requireSessionUser(params.locale);
  const t = await getTranslations('trade');
  const terminalUrl = process.env.NEXT_PUBLIC_TERMINAL_URL;
  const accountKind = searchParams.account === 'real' ? 'real' : 'demo';

  const seg = (kind: 'demo' | 'real', label: string) => (
    <Link
      href={`/terminal?account=${kind}`}
      aria-current={accountKind === kind ? 'page' : undefined}
      className={cn(
        'inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-xs font-semibold',
        accountKind === kind
          ? kind === 'real'
            ? 'bg-accent text-on-accent'
            : 'bg-primary/10 text-primary'
          : 'text-secondary hover:text-primary',
      )}
    >
      {label}
    </Link>
  );

  return (
    <div className="flex h-svh flex-col bg-base">
      <div className="flex h-11 shrink-0 items-center justify-between gap-2 border-b border-border bg-elevated pl-1 pr-2">
        <Link
          href="/"
          className="inline-flex h-10 items-center gap-1.5 rounded-lg px-2.5 text-sm font-medium text-secondary hover:bg-primary/5 hover:text-primary"
        >
          <NavIcon name="site" className="size-[18px]" />
          {t('backToCabinet')}
        </Link>
        <nav aria-label={t('accountSwitch')} className="flex items-center gap-0.5 rounded-lg border border-border bg-base p-0.5">
          {seg('demo', t('badgeDemo'))}
          {seg('real', t('badgeReal'))}
        </nav>
      </div>
      {terminalUrl ? (
        <TerminalFrame
          terminalUrl={terminalUrl}
          site={tenantSlug()}
          title={t('title')}
          accountKind={accountKind}
          className="block min-h-0 w-full flex-1 border-0 bg-elevated"
        />
      ) : (
        <div className="grid flex-1 place-items-center px-6 text-center">
          <div>
            <p className="text-lg font-medium">{t('comingSoon')}</p>
            <p className="mt-2 max-w-sm text-sm text-secondary">{t('comingSoonHint')}</p>
          </div>
        </div>
      )}
    </div>
  );
}
