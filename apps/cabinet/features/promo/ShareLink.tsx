'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { CopyButtonLarge } from '@/features/money/CopyText';

/**
 * «Поделиться»: на телефоне — системное меню (Web Share API), где его нет —
 * копирование ссылки. Кнопка рисуется всегда; поддержку проверяем после
 * гидрации (на сервере `navigator` нет).
 */
export function ShareButton({ link, title }: { link: string; title: string }) {
  const t = useTranslations('referrals');
  const [canShare, setCanShare] = useState(false);
  const [done, setDone] = useState(false);
  useEffect(() => {
    setCanShare(typeof navigator !== 'undefined' && typeof navigator.share === 'function');
  }, []);

  async function onClick() {
    if (canShare) {
      try {
        await navigator.share({ title, text: t('shareText'), url: link });
        return;
      } catch (e) {
        // Пользователь закрыл меню — не ошибка; иначе — запасной путь ниже.
        if (e instanceof DOMException && e.name === 'AbortError') return;
      }
    }
    try {
      await navigator.clipboard.writeText(link);
      setDone(true);
      setTimeout(() => setDone(false), 2000);
    } catch {
      /* буфер недоступен — ссылка видна и выделяется целиком */
    }
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-xl bg-accent px-4 text-sm font-medium text-on-accent transition-colors hover:bg-accent-hover sm:flex-none"
    >
      <svg viewBox="0 0 20 20" aria-hidden className="size-[18px]" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M10 12.5V3.5M6.75 6.5 10 3.25l3.25 3.25" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M6 9H5a1.5 1.5 0 0 0-1.5 1.5v5A1.5 1.5 0 0 0 5 17h10a1.5 1.5 0 0 0 1.5-1.5v-5A1.5 1.5 0 0 0 15 9h-1" strokeLinecap="round" />
      </svg>
      <span aria-live="polite">{done ? t('copied') : t('share')}</span>
    </button>
  );
}

export function CopyRow({ value, label, doneLabel }: { value: string; label: string; doneLabel: string }) {
  return <CopyButtonLarge value={value} label={label} doneLabel={doneLabel} className="flex-1 sm:flex-none" />;
}
