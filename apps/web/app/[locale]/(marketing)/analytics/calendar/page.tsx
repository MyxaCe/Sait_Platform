import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';

interface PageProps {
  params: { locale: string };
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const t = await getTranslations({ locale: params.locale, namespace: 'analytics' });
  // Пустую страницу не индексируем: показать в поиске нечего
  return {
    title: t('calendarMetaTitle'),
    description: t('calendarMetaDescription'),
    robots: { index: false, follow: true },
  };
}

/**
 * Экономический календарь без источника — честное «данных нет».
 *
 * Прежде здесь стоял синтетический календарь из кода (`calendar-data.ts`):
 * события с «фактом» и «прогнозом», сгенерированные от текущей даты, то
 * есть выдуманные макроданные под видом реальных. Удалён 10.11 вместе с
 * остальным контентом в коде. Компонент `EconomicCalendar` остаётся и
 * подключится, когда появится провайдер или блок CMS v2.
 */
export default async function CalendarPage({ params }: PageProps) {
  setRequestLocale(params.locale);
  const t = await getTranslations('analytics.calendar');
  return (
    <div
      className="rounded-2xl border border-border bg-card p-8 text-center"
      data-testid="calendar-no-source"
    >
      <p className="font-medium text-primary">{t('noSourceTitle')}</p>
      <p className="mt-2 text-sm text-secondary">{t('noSourceText')}</p>
    </div>
  );
}
