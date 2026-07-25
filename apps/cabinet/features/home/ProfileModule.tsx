import { getTranslations } from 'next-intl/server';
import type { SessionUser } from '@/lib/auth/session';

/** Модуль «Профиль»: аватар (инициалы до загрузки), имя, UID, VIP. */
export async function ProfileModule({ user }: { user: SessionUser }) {
  const t = await getTranslations('home');
  const initials = user.fullName
    .split(' ')
    .map((w) => w.charAt(0))
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return (
    <section className="flex items-center gap-4 rounded-2xl border border-border bg-elevated p-5">
      <span className="grid size-16 shrink-0 place-items-center rounded-full bg-gradient-to-br from-accent to-royal text-xl font-bold text-base">
        {initials}
      </span>
      <div className="min-w-0">
        <h1 className="truncate text-xl font-semibold">{user.fullName}</h1>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-secondary">
          <span className="rounded-md bg-primary/5 px-2 py-0.5">UID {user.uid}</span>
          <span className="rounded-md bg-accent/15 px-2 py-0.5 font-medium text-accent">
            VIP {user.vipLevel}
          </span>
          <span className="hidden sm:inline">{t('vipHint')}</span>
        </div>
      </div>
    </section>
  );
}
