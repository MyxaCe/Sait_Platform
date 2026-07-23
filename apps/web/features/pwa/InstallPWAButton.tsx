'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { Button } from '@broker/ui';

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

type InstallState =
  | 'idle' // ждём beforeinstallprompt
  | 'ready' // можно вызвать нативный промпт
  | 'installed' // уже установлено (standalone)
  | 'ios' // iOS: нативного промпта нет, показываем инструкцию
  | 'manual'; // прочие браузеры без промпта

function detectIos(): boolean {
  return /iPhone|iPad|iPod/.test(navigator.userAgent);
}

export function InstallPWAButton({ className }: { className?: string }) {
  const t = useTranslations('pwa');
  const [state, setState] = useState<InstallState>('idle');
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [showHint, setShowHint] = useState(false);

  useEffect(() => {
    if (window.matchMedia('(display-mode: standalone)').matches) {
      setState('installed');
      return;
    }
    if (detectIos()) setState('ios');

    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
      setState('ready');
    };
    const onInstalled = () => setState('installed');

    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    // Если за 3 секунды промпт не пришёл (Firefox, некоторые браузеры) —
    // покажем инструкцию по ручной установке
    const timer = setTimeout(() => {
      setState((s) => (s === 'idle' ? 'manual' : s));
    }, 3000);

    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
      clearTimeout(timer);
    };
  }, []);

  const install = async () => {
    if (state === 'ready' && deferred) {
      await deferred.prompt();
      const choice = await deferred.userChoice;
      if (choice.outcome === 'accepted') setState('installed');
      setDeferred(null);
      return;
    }
    setShowHint((v) => !v);
  };

  if (state === 'installed') {
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

      {showHint && (
        <p className="mt-3 rounded-xl border border-border bg-elevated p-4 text-left text-sm leading-relaxed text-secondary">
          {state === 'ios' ? t('iosHint') : t('manualHint')}
        </p>
      )}
    </div>
  );
}
