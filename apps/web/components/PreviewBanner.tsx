import { draftMode } from 'next/headers';

/** Плашка активного preview-режима с кнопкой выхода. */
export function PreviewBanner({ locale }: { locale: string }) {
  if (!draftMode().isEnabled) return null;
  const en = locale === 'en';

  return (
    <div className="fixed bottom-4 left-1/2 z-[100] flex -translate-x-1/2 items-center gap-3 rounded-full border border-accent/40 bg-elevated/95 px-4 py-2 text-sm shadow-xl backdrop-blur">
      <span className="size-2 animate-pulse rounded-full bg-accent" aria-hidden />
      <span className="text-primary">{en ? 'Preview mode' : 'Режим предпросмотра'}</span>
      <a
        href="/api/preview/disable"
        className="rounded-full bg-accent px-3 py-1 text-xs font-semibold text-base hover:bg-accent-hover"
      >
        {en ? 'Exit' : 'Выйти'}
      </a>
    </div>
  );
}
