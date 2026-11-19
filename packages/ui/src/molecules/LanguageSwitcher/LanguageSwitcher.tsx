'use client';

import { useEffect, useRef, useState } from 'react';
import { cn } from '../../lib/cn';

export interface LanguageOption {
  locale: string;
  label: string;
  href: string;
}

export interface LanguageSwitcherProps {
  current: string;
  options: LanguageOption[];
  label: string;
  className?: string;
}

export function LanguageSwitcher({ current, options, label, className }: LanguageSwitcherProps) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (root.current && !root.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (options.length < 2) return null;

  return (
    <div ref={root} className={cn('relative', className)}>
      <button
        type="button"
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={label}
        onClick={() => setOpen((v) => !v)}
        className="flex h-11 min-w-11 items-center justify-center gap-1 rounded-lg px-2 text-sm font-semibold text-secondary transition-colors hover:bg-primary/5 hover:text-primary"
      >
        <svg viewBox="0 0 24 24" className="size-4 fill-none stroke-current" aria-hidden>
          <circle cx="12" cy="12" r="9" strokeWidth="1.8" />
          <path d="M3 12h18M12 3c2.5 2.7 2.5 15.3 0 18M12 3c-2.5 2.7-2.5 15.3 0 18" strokeWidth="1.8" />
        </svg>
        {current.toUpperCase()}
      </button>
      {open && (
        <ul
          role="list"
          aria-label={label}
          className="absolute right-0 top-full z-50 mt-1 min-w-40 overflow-hidden rounded-xl border border-border bg-elevated py-1 shadow-xl"
        >
          {options.map((option) => {
            const active = option.locale === current;
            return (
              <li key={option.locale}>
                <a
                  href={option.href}
                  hrefLang={option.locale}
                  lang={option.locale}
                  aria-current={active ? 'true' : undefined}
                  onClick={() => setOpen(false)}
                  className={cn(
                    'flex items-center justify-between gap-3 px-4 py-2.5 text-sm transition-colors',
                    active ? 'font-semibold text-primary' : 'text-secondary hover:bg-primary/5 hover:text-primary',
                  )}
                >
                  {option.label}
                  <span className="text-xs uppercase text-muted">{option.locale}</span>
                </a>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
