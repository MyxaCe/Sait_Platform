'use client';

import { useCallback, useEffect, useRef } from 'react';
import { useLocale } from 'next-intl';
import type { OnboardingLabels, OnboardingPartConfig } from '@broker/api-client';
import { saveTourResultAction } from '@/lib/onboarding/actions';

/** Экскурсия по терминалу: тексты из CMS передаются терминалу сообщением. */
export interface TerminalTour {
  part: OnboardingPartConfig;
  labels: OnboardingLabels;
  autostart: boolean;
}

interface TerminalFrameProps {
  terminalUrl: string;
  site: string;
  title: string;
  accountKind?: 'demo' | 'real';
  symbol?: string | null;
  className?: string;
  tour?: TerminalTour | null;
}

export function TerminalFrame({ terminalUrl, site, title, accountKind = 'demo', symbol = null, className, tour = null }: TerminalFrameProps) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const locale = useLocale();
  const src = `${terminalUrl}?site=${encodeURIComponent(site)}&lang=${locale}&locale=${locale}${symbol ? `&symbol=${encodeURIComponent(symbol)}` : ''}`;
  const terminalOrigin = new URL(terminalUrl).origin;

  const sendToken = useCallback(async () => {
    const target = frameRef.current?.contentWindow;
    if (!target) return;
    try {
      const res = await fetch(`/api/sso/token?account=${accountKind}`, { method: 'POST' });
      if (res.ok) {
        const { token } = (await res.json()) as { token: string };
        target.postMessage({ type: 'sso.token', token }, terminalOrigin);
      } else {
        target.postMessage({ type: 'sso.logout' }, terminalOrigin);
      }
    } catch {
    }
  }, [terminalOrigin, accountKind]);

  const autostartSent = useRef(false);
  const sendTour = useCallback(() => {
    const target = frameRef.current?.contentWindow;
    if (!target || !tour) return;
    const autostart = tour.autostart && !autostartSent.current;
    autostartSent.current = autostartSent.current || autostart;
    target.postMessage(
      {
        type: 'onboarding.tour.config',
        version: tour.part.version,
        steps: tour.part.steps,
        labels: tour.labels,
        autostart,
      },
      terminalOrigin,
    );
  }, [terminalOrigin, tour]);

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (event.origin !== terminalOrigin) return;
      const data = event.data as { type?: string; status?: unknown; version?: unknown } | null;
      if (data?.type === 'token.refresh.request') {
        void sendToken();
      } else if (data?.type === 'onboarding.tour.ready') {
        sendTour();
      } else if (data?.type === 'onboarding.tour.result' && tour) {
        const status = data.status === 'done' || data.status === 'skipped' ? data.status : null;
        if (status && data.version === tour.part.version) void saveTourResultAction('terminal', tour.part.version, status);
      }
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [terminalOrigin, sendToken, sendTour, tour]);

  return (
    <iframe
      ref={frameRef}
      key={accountKind}
      src={src}
      title={title}
      onLoad={() => void sendToken()}
      className={className ?? 'block h-svh w-full border-0 bg-elevated'}
      allow="clipboard-write; fullscreen"
      allowFullScreen
    />
  );
}
