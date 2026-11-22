import type { Metadata } from 'next';
import { cn } from '@broker/ui';
import { interCyrillic, interLatin } from './fonts';
import { devPalette } from '@/lib/ui/dev-palette';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'Центр управления', template: '%s · Центр управления' },
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="ru"
      data-surface="admin"
      data-palette={devPalette()}
      className={cn(interLatin.variable, interCyrillic.variable)}
    >
      <body>{children}</body>
    </html>
  );
}
