import { getTranslations } from 'next-intl/server';
import type { Media } from '@broker/api-client';
import { formatDate, formatTime } from '@broker/utils';
import { isDraft } from '@/lib/cms';
import { intlTag } from '@/lib/locale';

export function ArticleCover({ cover }: { cover: Media }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- обложка из медиатеки CMS, размеры известны
    <img
      src={cover.url}
      alt={cover.alt}
      width={cover.width}
      height={cover.height}
      className="mt-8 h-auto w-full rounded-3xl border border-border"
    />
  );
}

export async function scheduledLabel(publishedAt: string | undefined, locale: string): Promise<string | null> {
  if (!publishedAt || !isDraft() || Date.parse(publishedAt) <= Date.now()) return null;
  const t = await getTranslations({ locale, namespace: 'preview' });
  const intlLocale = intlTag(locale);
  return t('scheduled', { date: `${formatDate(publishedAt, intlLocale)} ${formatTime(publishedAt, intlLocale)}` });
}

export function ScheduledBadge({ label }: { label: string }) {
  return (
    <p className="mt-4 inline-block rounded-full border border-accent/40 bg-accent/10 px-3 py-1 text-xs text-accent">
      {label}
    </p>
  );
}
