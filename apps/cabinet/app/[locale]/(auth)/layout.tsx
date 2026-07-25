import { useTranslations } from 'next-intl';

/** Публичная зона: центрированная карточка на тёмном фоне. */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  const t = useTranslations('common');
  return (
    <main className="flex min-h-svh flex-col items-center justify-center px-4 py-10">
      <div className="mb-8 flex items-center gap-2 text-xl font-semibold">
        <span className="grid size-9 place-items-center rounded-lg bg-accent font-bold text-base">
          {t('brand').charAt(0)}
        </span>
        {t('brand')}
      </div>
      <div className="w-full max-w-md rounded-2xl border border-border bg-elevated p-6 sm:p-8">
        {children}
      </div>
      <a
        href={process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'}
        className="mt-6 text-sm text-secondary hover:text-primary"
      >
        ← {t('backToSite')}
      </a>
    </main>
  );
}
