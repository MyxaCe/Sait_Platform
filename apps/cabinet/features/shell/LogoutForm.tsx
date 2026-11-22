'use client';

import { logoutAction } from '@/lib/actions';

export function LogoutForm({
  locale,
  label,
  className,
  icon,
}: {
  locale: string;
  label: string;
  className?: string;
  icon?: React.ReactNode;
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
        {icon}
        {label}
      </button>
    </form>
  );
}
