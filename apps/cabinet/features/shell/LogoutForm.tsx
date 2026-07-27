'use client';

import { logoutAction } from '@/lib/actions';

/**
 * Форма выхода + best-effort мгновенный сигнал терминалу (финализация B):
 * при сабмите шлём `sso.logout` во все iframe на странице (на /trade это
 * терминал, он жив в этот момент) — мгновенный UX-логаут. Жёсткая гарантия
 * остаётся за TTL сессии терминала (≤15 мин) и отказом ре-handoff.
 * targetOrigin '*' допустим: сообщение не несёт секретов.
 */
export function LogoutForm({
  locale,
  label,
  className,
}: {
  locale: string;
  label: string;
  className?: string;
}) {
  return (
    <form
      action={logoutAction}
      onSubmit={() => {
        document.querySelectorAll('iframe').forEach((frame) => {
          frame.contentWindow?.postMessage({ type: 'sso.logout' }, '*');
        });
      }}
    >
      <input type="hidden" name="uiLocale" value={locale} />
      <button type="submit" className={className}>
        {label}
      </button>
    </form>
  );
}
