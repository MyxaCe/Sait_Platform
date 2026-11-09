import type { Metadata } from 'next';
import { cn } from '@broker/ui';
import { interCyrillic, interLatin } from './fonts';
import { devPalette } from '@/lib/ui/dev-palette';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'Центр управления', template: '%s · Центр управления' },
  // Операторский периметр не индексируется (дублирует заголовок из next.config).
  robots: { index: false, follow: false },
};

/**
 * Корневой layout поверхности управления. Одна область, один язык (ru).
 *
 * `data-surface="admin"` включает палитру центра управления из
 * `@broker/ui/tokens.css` (перекраска = значения токенов, классы не меняются).
 * `data-palette` ставится только на локальном dev-стенде для сравнения
 * вариантов (см. lib/ui/dev-palette.ts) — в проде атрибута нет.
 */
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
