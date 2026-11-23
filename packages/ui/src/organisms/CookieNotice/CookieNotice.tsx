'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { Button } from '../../atoms/Button/Button';

/** Ключ в localStorage: смена версии покажет уведомление заново (если поменялся состав cookie). */
export const COOKIE_NOTICE_STORAGE_KEY = 'cookie-notice-v1';

export interface CookieNoticeProps {
  /** Текст уведомления; ссылка на политику — внутри (rich text). */
  children: ReactNode;
  acceptLabel: string;
  ariaLabel: string;
  /** Не показывать на этой странице (например, во весь экран терминала). */
  hidden?: boolean;
}

function readDismissed(): boolean {
  try {
    return window.localStorage.getItem(COOKIE_NOTICE_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * Информационное уведомление о cookie. Мы ставим только необходимые cookie
 * (вход, язык, защита, учёт партнёрской ссылки) — поэтому здесь нет
 * «настроек» и выбора категорий: выбирать нечего (разбор доверия 22.11).
 * Отметка «понятно» хранится в localStorage, а не в cookie.
 */
export function CookieNotice({ children, acceptLabel, ariaLabel, hidden = false }: CookieNoticeProps) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!hidden) setOpen(!readDismissed());
  }, [hidden]);

  if (!open || hidden) return null;

  const dismiss = () => {
    try {
      window.localStorage.setItem(COOKIE_NOTICE_STORAGE_KEY, '1');
    } catch {
      /* приватный режим: просто закрываем до перезагрузки */
    }
    setOpen(false);
  };

  return (
    <div
      role="region"
      aria-label={ariaLabel}
      data-testid="cookie-notice"
      className="fixed inset-x-3 bottom-3 z-50 mx-auto flex max-w-3xl flex-col gap-3 rounded-2xl border border-border bg-card p-4 text-sm text-secondary shadow-lg sm:flex-row sm:items-center sm:gap-4"
      style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}
    >
      <p className="flex-1">{children}</p>
      <Button size="sm" onClick={dismiss} className="shrink-0">
        {acceptLabel}
      </Button>
    </div>
  );
}
