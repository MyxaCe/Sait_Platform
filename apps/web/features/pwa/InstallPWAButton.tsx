'use client';

import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@broker/ui';
import {
  detectInstallPlatform,
  INSTALL_STEPS,
  SILENT_DISMISS_MS,
  type InstallPlatform,
} from './install-platform';

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/**
 * Кнопка установки приложения (PWA). Никогда не «мёртвая»: если браузер умеет
 * окно установки — показываем его; если не умеет (iOS, встроенный браузер
 * Telegram/Instagram, Samsung Internet), окно не появилось или вызов упал —
 * открываем панель с шагами для этого телефона и браузера.
 */
export function InstallPWAButton({ className }: { className?: string }) {
  const t = useTranslations('pwa');
  const [installed, setInstalled] = useState(false);
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [platform, setPlatform] = useState<InstallPlatform>('desktop');
  const [sheetOpen, setSheetOpen] = useState(false);

  useEffect(() => {
    if (window.matchMedia?.('(display-mode: standalone)').matches) {
      setInstalled(true);
      return;
    }
    setPlatform(detectInstallPlatform(navigator.userAgent, navigator.maxTouchPoints || 0));

    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setInstalled(true);
      setSheetOpen(false);
    };

    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  const install = async () => {
    if (!deferred) {
      setSheetOpen(true);
      return;
    }
    const prompt = deferred;
    setDeferred(null);
    const startedAt = Date.now();
    try {
      await prompt.prompt();
      const choice = await prompt.userChoice;
      if (choice.outcome === 'accepted') setInstalled(true);
      else if (Date.now() - startedAt < SILENT_DISMISS_MS) setSheetOpen(true);
    } catch {
      setSheetOpen(true);
    }
  };

  if (installed) {
    return (
      <p className={className}>
        <span className="inline-flex items-center gap-2 text-sm text-positive">
          <svg viewBox="0 0 24 24" className="size-4 fill-none stroke-current" aria-hidden>
            <path d="M5 13l4 4L19 7" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          {t('installed')}
        </span>
      </p>
    );
  }

  return (
    <div className={className}>
      <Button size="lg" onClick={install} className="w-full sm:w-auto sm:px-10">
        <svg viewBox="0 0 24 24" className="size-5 fill-none stroke-current" aria-hidden>
          <path
            d="M12 3v12m0 0l-4-4m4 4l4-4M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        {t('install')}
      </Button>

      {sheetOpen && <InstallSheet platform={platform} onClose={() => setSheetOpen(false)} />}
    </div>
  );
}

function InstallSheet({ platform, onClose }: { platform: InstallPlatform; onClose: () => void }) {
  const t = useTranslations('pwa.sheet');
  const closeRef = useRef<HTMLButtonElement>(null);
  const [copied, setCopied] = useState(false);
  const steps = Array.from({ length: INSTALL_STEPS[platform] }, (_, i) => t(`${platform}.${i + 1}`));

  const onKey = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    },
    [onClose],
  );

  useEffect(() => {
    closeRef.current?.focus();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onKey]);

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/`);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 sm:items-center sm:p-4"
      onClick={onClose}
      data-testid="pwa-install-sheet"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="pwa-install-title"
        className="w-full max-w-md rounded-t-2xl border border-border bg-elevated p-5 text-left shadow-2xl sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <h3 id="pwa-install-title" className="text-lg font-semibold text-primary">
            {t('title')}
          </h3>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label={t('close')}
            className="-m-1 rounded-lg p-1 text-secondary hover:text-primary"
          >
            <svg viewBox="0 0 24 24" className="size-5 fill-none stroke-current" aria-hidden>
              <path d="M6 6l12 12M18 6L6 18" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <ol className="mt-4 space-y-3 text-sm leading-relaxed text-secondary">
          {steps.map((step, i) => (
            <li key={i} className="flex gap-3">
              <span className="grid size-6 shrink-0 place-items-center rounded-full bg-accent text-xs font-semibold text-on-accent">
                {i + 1}
              </span>
              <span>{step}</span>
            </li>
          ))}
        </ol>
        {platform === 'inApp' && (
          <Button size="md" variant="secondary" onClick={copyLink} className="mt-5 w-full">
            {copied ? t('copied') : t('copy')}
          </Button>
        )}
      </div>
    </div>
  );
}
