'use client';

import { useCallback, useEffect, useRef } from 'react';
import { useLocale } from 'next-intl';

interface TerminalFrameProps {
  terminalUrl: string;
  site: string;
  title: string;
  accountKind?: 'demo' | 'real';
  symbol?: string | null;
  className?: string;
}

export function TerminalFrame({ terminalUrl, site, title, accountKind = 'demo', symbol = null, className }: TerminalFrameProps) {
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
