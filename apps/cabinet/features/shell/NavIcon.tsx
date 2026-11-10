/**
 * Иконки навигации кабинета — инлайновый SVG (никаких иконочных CDN/шрифтов).
 * 20×20, обводка `currentColor` 1.5 — цвет наследуют от пункта.
 */
export type NavIconName =
  | 'home'
  | 'trade'
  | 'deposit'
  | 'withdraw'
  | 'wallet'
  | 'history'
  | 'profile'
  | 'security'
  | 'documents'
  | 'verification'
  | 'notifications'
  | 'more'
  | 'site'
  | 'logout';

const PATHS: Record<NavIconName, React.ReactNode> = {
  home: (
    <>
      <path d="M3.5 9 10 3.75 16.5 9v7.25h-4.25V12h-4.5v4.25H3.5z" strokeLinejoin="round" />
    </>
  ),
  trade: (
    <>
      <path d="M3 15.5 7.5 10l3 3 6.5-7.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M13 5.5h4v4" strokeLinecap="round" strokeLinejoin="round" />
    </>
  ),
  deposit: (
    <>
      <path d="M10 3.5v9M6.25 9 10 12.75 13.75 9" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4 14.5v2h12v-2" strokeLinecap="round" strokeLinejoin="round" />
    </>
  ),
  withdraw: (
    <>
      <path d="M10 12.75v-9M6.25 7.25 10 3.5l3.75 3.75" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4 14.5v2h12v-2" strokeLinecap="round" strokeLinejoin="round" />
    </>
  ),
  wallet: (
    <>
      <path d="M3.5 6.25A1.75 1.75 0 0 1 5.25 4.5h9.25v2.75" strokeLinejoin="round" />
      <rect x="3.5" y="6.5" width="13" height="9.5" rx="1.75" />
      <path d="M12.75 11.25h1.5" strokeLinecap="round" />
    </>
  ),
  history: (
    <>
      <circle cx="10" cy="10" r="6.75" />
      <path d="M10 6.25V10l2.5 1.75" strokeLinecap="round" strokeLinejoin="round" />
    </>
  ),
  profile: (
    <>
      <circle cx="10" cy="7" r="3.25" />
      <path d="M3.75 16.75c.75-3 3.25-4.5 6.25-4.5s5.5 1.5 6.25 4.5" strokeLinecap="round" />
    </>
  ),
  security: (
    <>
      <rect x="4.5" y="8.75" width="11" height="8" rx="1.75" />
      <path d="M7 8.75V6.5a3 3 0 0 1 6 0v2.25" />
    </>
  ),
  documents: (
    <>
      <path d="M5.25 2.75h6.5l3 3v11.5h-9.5z" strokeLinejoin="round" />
      <path d="M11.5 2.75v3.25h3.25M7.75 10.5h4.5M7.75 13.5h4.5" strokeLinecap="round" />
    </>
  ),
  verification: (
    <>
      <path d="M10 2.75 16 5v4.75c0 3.5-2.5 6.25-6 7.5-3.5-1.25-6-4-6-7.5V5z" strokeLinejoin="round" />
      <path d="m7.25 10 2 2 3.5-3.75" strokeLinecap="round" strokeLinejoin="round" />
    </>
  ),
  notifications: (
    <>
      <path d="M5.25 13.75V9a4.75 4.75 0 0 1 9.5 0v4.75l1.25 1.5H4z" strokeLinejoin="round" />
      <path d="M8.25 17.25a1.9 1.9 0 0 0 3.5 0" strokeLinecap="round" />
    </>
  ),
  more: (
    <>
      <circle cx="4.75" cy="10" r="1.25" fill="currentColor" stroke="none" />
      <circle cx="10" cy="10" r="1.25" fill="currentColor" stroke="none" />
      <circle cx="15.25" cy="10" r="1.25" fill="currentColor" stroke="none" />
    </>
  ),
  site: (
    <>
      <path d="M8.5 5.25 3.75 10l4.75 4.75M4 10h12.25" strokeLinecap="round" strokeLinejoin="round" />
    </>
  ),
  logout: (
    <>
      <path d="M8 3.75H4.5v12.5H8M12.5 6.5 16 10l-3.5 3.5M16 10H7.75" strokeLinecap="round" strokeLinejoin="round" />
    </>
  ),
};

export function NavIcon({ name, className }: { name: NavIconName; className?: string }) {
  return (
    <svg
      viewBox="0 0 20 20"
      aria-hidden
      className={className ?? 'size-5 shrink-0'}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
    >
      {PATHS[name]}
    </svg>
  );
}
