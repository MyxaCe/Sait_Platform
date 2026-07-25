'use client';

import { Link, usePathname } from '@/i18n/navigation';
import { cn } from '@broker/ui';

interface NavLinkProps {
  href: string;
  children: React.ReactNode;
  badge?: number;
  mobile?: boolean;
}

export function NavLink({ href, children, badge, mobile }: NavLinkProps) {
  const pathname = usePathname();
  const active = href === '/' ? pathname === '/' : pathname.startsWith(href);

  return (
    <Link
      href={href}
      className={cn(
        mobile
          ? 'flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 px-1 text-[11px]'
          : 'flex items-center justify-between rounded-xl px-3 py-2.5 text-sm transition-colors',
        active
          ? mobile
            ? 'text-accent'
            : 'bg-accent/10 text-accent'
          : 'text-secondary hover:bg-primary/5 hover:text-primary',
      )}
    >
      <span className="truncate">{children}</span>
      {badge ? (
        <span className="ml-2 grid min-w-5 place-items-center rounded-full bg-accent px-1.5 text-[11px] font-semibold text-base">
          {badge}
        </span>
      ) : null}
    </Link>
  );
}
