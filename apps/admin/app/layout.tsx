import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Центр управления',
  // Операторский периметр не индексируется (дублирует заголовок из next.config).
  robots: { index: false, follow: false },
};

/** Корневой layout поверхности управления. Одна область, один язык (ru). */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
