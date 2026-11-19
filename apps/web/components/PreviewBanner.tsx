import { draftMode } from 'next/headers';
import { getTranslations } from 'next-intl/server';

/** Плашка активного preview-режима с кнопкой выхода. */
export async function PreviewBanner({ locale }: { locale: string }) {
  if (!draftMode().isEnabled) return null;
  const t = await getTranslations({ locale, namespace: 'preview' });

  return (
    <div className="fixed bottom-4 left-1/2 z-[100] flex -translate-x-1/2 items-center gap-3 rounded-full border border-accent/40 bg-elevated/95 px-4 py-2 text-sm shadow-xl backdrop-blur">
      <span className="size-2 animate-pulse rounded-full bg-accent" aria-hidden />
      <span className="text-primary">{t('mode')}</span>
      <a
        href="/api/preview/disable"
        className="rounded-full bg-accent px-3 py-1 text-xs font-semibold text-base hover:bg-accent-hover"
      >
        {t('exit')}
      </a>
    </div>
  );
}
