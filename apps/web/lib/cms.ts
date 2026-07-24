import { unstable_cache } from 'next/cache';
import type { z } from 'zod';
import { CMS_RESPONSE_SCHEMAS, cmsFetch, type Locale } from '@broker/api-client';
import { CMS_MOCK } from './cms-mock';

/**
 * Единая точка чтения CMS-контента страницами (этап 1 интеграции).
 * - CMS_API_URL задан → cmsFetch к реальной CMS (timeout/Zod/last-good),
 *   фолбэк — локальный mock-билдер (фикстуры).
 * - Не задан → mock in-process ЧЕРЕЗ unstable_cache с теми же тегами:
 *   revalidateTag() из вебхука работает одинаково для мока и боевой CMS.
 * Теги: cms:{resource} — согласованы со спецификацией (§4).
 */

type Resource = keyof typeof CMS_MOCK & keyof typeof CMS_RESPONSE_SCHEMAS;

interface GetCmsOptions {
  locale: Locale;
  /** Страховочный интервал ревалидации, сек (медленные данные — 3600) */
  revalidate?: number;
  params?: Record<string, string>;
}

export async function getCms<K extends Resource>(
  resource: K,
  { locale, revalidate = 3600, params = {} }: GetCmsOptions,
): Promise<z.infer<(typeof CMS_RESPONSE_SCHEMAS)[K]>> {
  const schema = CMS_RESPONSE_SCHEMAS[resource];
  const tag = `cms:${resource}`;
  const buildLocal = () => CMS_MOCK[resource]!(locale, new URLSearchParams(params));

  if (process.env.CMS_API_URL) {
    return cmsFetch(`/cms/${resource}`, {
      schema,
      locale,
      tags: [tag],
      revalidate,
      searchParams: params,
      fallback: schema.parse(buildLocal()),
    }) as Promise<z.infer<(typeof CMS_RESPONSE_SCHEMAS)[K]>>;
  }

  const cached = unstable_cache(
    async () => buildLocal(),
    ['cms', resource, locale, JSON.stringify(params)],
    { tags: [tag], revalidate },
  );
  return schema.parse(await cached()) as z.infer<(typeof CMS_RESPONSE_SCHEMAS)[K]>;
}
