'use client';

import { useCallback, useEffect, useRef } from 'react';
import { useLocale } from 'next-intl';

/**
 * Iframe терминала + postMessage-протокол SSO (финализация, решение B):
 *  parent → iframe: { type: 'sso.token', token }       — при загрузке и по запросу
 *  iframe → parent: { type: 'token.refresh.request' }  — тихий ре-handoff
 *  parent → iframe: { type: 'sso.logout' }             — сессия платформы погашена
 * Терминал держит свою сессию ≤15 мин; погашенная сессия кабинета
 * не может переотдать токен — терминал разлогинивается сам.
 */

interface TerminalFrameProps {
  terminalUrl: string;
  site: string;
  title: string;
}

export function TerminalFrame({ terminalUrl, site, title }: TerminalFrameProps) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const locale = useLocale();
  const src = `${terminalUrl}?site=${encodeURIComponent(site)}&locale=${locale}`;
  const terminalOrigin = new URL(terminalUrl).origin;

  const sendToken = useCallback(async () => {
    const target = frameRef.current?.contentWindow;
    if (!target) return;
    try {
      const res = await fetch('/api/sso/token', { method: 'POST' });
      if (res.ok) {
        const { token } = (await res.json()) as { token: string };
        target.postMessage({ type: 'sso.token', token }, terminalOrigin);
      } else {
        // Сессия кабинета мертва — терминал должен разлогиниться
        target.postMessage({ type: 'sso.logout' }, terminalOrigin);
      }
    } catch {
      // Сеть моргнула: терминал переспросит сам (token.refresh.request)
    }
  }, [terminalOrigin]);

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (event.origin !== terminalOrigin) return;
      if ((event.data as { type?: string })?.type === 'token.refresh.request') {
        void sendToken();
      }
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [terminalOrigin, sendToken]);

  return (
    <iframe
      ref={frameRef}
      src={src}
      title={title}
      onLoad={() => void sendToken()}
      className="block h-[calc(100svh-7rem)] w-full border-0 bg-elevated lg:h-svh"
      allow="clipboard-write"
    />
  );
}
