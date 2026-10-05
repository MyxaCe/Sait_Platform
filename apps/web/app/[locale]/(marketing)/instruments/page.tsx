import type { Metadata } from 'next';
import { useTranslations } from 'next-intl';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Container, Section } from '@broker/ui';
import { AccessNotice } from '@/features/instruments/AccessNotice';
import { InstrumentsBrowser } from '@/features/instruments/InstrumentsBrowser';
import { getCms } from '@/lib/cms';
import { getMdsIcons } from '@/lib/mds';
import {
  accessNotice,
  getTenantAccess,
  isSymbolAllowed,
  type AccessNoticeSpec,
} from '@/lib/tenant';

interface PageProps {
  params: { locale: string };
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const t = await getTranslations({ locale: params.locale, namespace: 'instruments' });
  return { title: t('title'), description: t('metaDescription') };
}

export default async function InstrumentsPage({ params }: PageProps) {
  setRequestLocale(params.locale);
  // Контент страницы ∩ ДОСТУП сайта (allow-list карточки сайта, ADR-028).
  // Граница fail-closed (Р-025): закрыта — список пуст, и вместо него
  // стоит объяснение, а не пустая таблица «0 из 0».
  const [{ items: pageItems }, access] = await Promise.all([
    getCms('instruments', { locale: params.locale === 'en' ? 'en' : 'ru' }),
    getTenantAccess(),
  ]);
  const notice = accessNotice(access);
  const items = pageItems.filter((i) => isSymbolAllowed(access, i.symbol));

  // Иконки: загруженная в CMS приоритетнее, иначе — иконка монеты из MDS
  const mdsIcons = await getMdsIcons();
  const icons: Record<string, string> = {};
  for (const item of items) {
    const url = item.icon?.url ?? mdsIcons[item.symbol];
    if (url) icons[item.symbol] = url;
  }

  return <PageContent symbols={items.map((i) => i.symbol)} icons={icons} notice={notice} />;
}

function PageContent({
  symbols,
  icons,
  notice,
}: {
  symbols: string[];
  icons: Record<string, string>;
  notice: AccessNoticeSpec | null;
}) {
  const t = useTranslations('instruments');
  return (
    <Section className="py-10 md:py-14">
      <Container>
        <div className="max-w-2xl">
          <h1 className="text-3xl font-semibold tracking-tight text-primary sm:text-4xl lg:text-5xl">
            {t('title')}
          </h1>
          <p className="mt-3 text-secondary sm:text-lg">{t('subtitle')}</p>
        </div>

        <div className="mt-8 lg:mt-10">
          {notice ? (
            <AccessNotice
              state={notice.state}
              title={t(notice.titleKey)}
              text={t(notice.textKey)}
              reason={notice.reason}
              reasonLabel={notice.reason && t('accessReason', { reason: notice.reason })}
            />
          ) : (
            <InstrumentsBrowser symbols={symbols} icons={icons} />
          )}
        </div>
      </Container>
    </Section>
  );
}
