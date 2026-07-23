'use client';

import { useLocale } from 'next-intl';
import { useTheme } from 'next-themes';
import { useEffect, useState } from 'react';
import { cn } from '@broker/ui';

/**
 * Переключатель тёмной/светлой темы. Рендерит нейтральную заглушку
 * до маунта, чтобы не получить hydration mismatch (тема известна только на клиенте).
 */
export function ThemeToggle({ className }: { className?: string }) {
  const { theme, setTheme } = useTheme();
  const locale = useLocale();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  const isDark = theme !== 'light';
  const en = locale === 'en';
  const label = !mounted
    ? en ? 'Toggle theme' : 'Сменить тему'
    : isDark
      ? en ? 'Switch to light theme' : 'Включить светлую тему'
      : en ? 'Switch to dark theme' : 'Включить тёмную тему';

  return (
    <button
      type="button"
      onClick={() => setTheme(isDark ? 'light' : 'dark')}
      aria-label={label}
      title={mounted ? label : undefined}
      className={cn(
        'grid size-11 place-items-center rounded-lg text-secondary transition-colors hover:bg-primary/5 hover:text-primary',
        className,
      )}
    >
      {!mounted ? (
        <span className="size-5 rounded-full bg-border" aria-hidden />
      ) : isDark ? (
        // Солнце — переключение на светлую
        <svg viewBox="0 0 24 24" className="size-5 fill-none stroke-current" aria-hidden>
          <circle cx="12" cy="12" r="4" strokeWidth="1.8" />
          <path
            d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4l1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4m11.4-11.4l1.4-1.4"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
        </svg>
      ) : (
        // Луна — переключение на тёмную
        <svg viewBox="0 0 24 24" className="size-5 fill-none stroke-current" aria-hidden>
          <path
            d="M21 12.8A9 9 0 1111.2 3a7 7 0 009.8 9.8z"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}
    </button>
  );
}
