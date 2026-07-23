import { SiteFooter } from '@/components/layout/SiteFooter';
import { SiteHeader } from '@/components/layout/SiteHeader';
import { QuotesTicker } from '@/features/quotes/QuotesTicker';

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-svh flex-col">
      <SiteHeader />
      <QuotesTicker />
      <main className="flex-1">{children}</main>
      <SiteFooter />
    </div>
  );
}
