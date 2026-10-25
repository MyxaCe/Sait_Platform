import type { Metadata } from 'next';
import { useTranslations } from 'next-intl';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Container, Section } from '@broker/ui';
import { AccessNotice } from '@/features/instruments/AccessNotice';
import { InstrumentsBrowser } from '@/features/instruments/InstrumentsBrowser';
import { unavailableReasonsOf } from '@/features/instruments/unavailable-map';
import { getCms } from '@/lib/cms';
import { getMdsIcons, getMdsQuotesState } from '@/lib/mds';
import {
  accessNotice,
  getTenantAccess,
  isSymbolAllowed,
  type AccessNoticeSpec,
} from '@/lib/tenant';

/**
 * Страница ДИНАМИЧЕСКАЯ, и это требование, а не настройка (WEB-07).
 *
 * Её содержимое режет граница доступа тенанта — регуляторный фильтр,
 * который читается из окружения В РАНТАЙМЕ. На сборке окружения нет:
 * `getTenantAccess()` возвращает `not-configured`, список становится
 * пустым, а объяснение «список недоступен» ЗАПЕКАЕТСЯ в разметку. На
 * живом домене это вечная ложная авария — та же природа, что у адресов
 * в WEB-22: состояние среды, замороженное на сборке.
 *
 * Отдать список статически и отфильтровать его в браузере нельзя:
 * неразрешённые инструменты оказались бы в HTML, а fail-closed значит
 * «не публиковать то, что может быть запрещено», а не «спрятать потом».
 */
export const dynamic = 'force-dynamic';

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
  // Состояние котировок спрашиваем здесь же (WEB-39): страница и так
  // динамическая и ходит за доступом, CMS и иконками. Без этого
  // вопроса инструмент, который источник не транслирует, стоял бы в
  // списке РЯДОМ с работающими и молчал без объяснения — а прочерк
  // рядом с уверенным числом читается как «это неизвестно, а
  // остальное известно».
  const [{ items: pageItems }, access, quotes] = await Promise.all([
    getCms('instruments', { locale: params.locale === 'en' ? 'en' : 'ru' }),
    getTenantAccess(),
    getMdsQuotesState(),
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

  return (
    <PageContent
      symbols={items.map((i) => i.symbol)}
      icons={icons}
      notice={notice}
      unavailableReasons={unavailableReasonsOf(quotes)}
    />
  );
}

function PageContent({
  symbols,
  icons,
  notice,
  unavailableReasons,
}: {
  symbols: string[];
  icons: Record<string, string>;
  notice: AccessNoticeSpec | null;
  unavailableReasons: Record<string, string>;
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
            <InstrumentsBrowser
              symbols={symbols}
              icons={icons}
              unavailableReasons={unavailableReasons}
            />
          )}
        </div>
      </Container>
    </Section>
  );
}
