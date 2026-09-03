import { unstable_cache } from 'next/cache';
import { draftMode } from 'next/headers';
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

  // Preview (этап 3): редактор с draftMode-кукой видит черновой контент —
  // кеш обходится, к CMS уходит draft=true. Вне request-контекста — false.
  let draft = false;
  try {
    draft = draftMode().isEnabled;
  } catch {
    draft = false;
  }

  if (process.env.CMS_API_URL) {
    // Мульти-тенантная CMS: сайт явно называет себя (без site CMS взяла бы дефолт)
    const siteParams = { site: process.env.SITE_SLUG ?? 'apex-ru', ...params };
    // Фикстура строится ДО вызова, значит её исключение летит мимо try/catch
    // внутри cmsFetch (баг B-017): сломанная фикстура роняла страницу даже при
    // живой CMS, к которой не успевали сходить. Страховка не имеет права быть
    // причиной аварии — строим её здесь и сами же ловим.
    // Тип — union по всем ресурсам, а не по K: сузить до K значит увести
    // вывод T у cmsFetch с schema на fallback и поссорить их между собой.
    let fallback: z.infer<(typeof CMS_RESPONSE_SCHEMAS)[Resource]> | undefined;
    try {
      fallback = schema.parse(buildLocal());
    } catch (error) {
      // Подавленная диагностика дороже шумной: фикстура разошлась с контрактом,
      // сайт остался без последнего рубежа — это должно быть видно.
      console.error(`[getCms] fixture build failed resource=${resource} locale=${locale}`, error);
    }
    return cmsFetch(`/cms/${resource}`, {
      schema,
      locale,
      tags: [tag],
      revalidate: draft ? 0 : revalidate,
      searchParams: draft ? { ...siteParams, draft: 'true' } : siteParams,
      fallback,
    }) as Promise<z.infer<(typeof CMS_RESPONSE_SCHEMAS)[K]>>;
  }

  if (draft) {
    return schema.parse(buildLocal()) as z.infer<(typeof CMS_RESPONSE_SCHEMAS)[K]>;
  }

  const cached = unstable_cache(
    async () => buildLocal(),
    ['cms', resource, locale, JSON.stringify(params)],
    { tags: [tag], revalidate },
  );
  return schema.parse(await cached()) as z.infer<(typeof CMS_RESPONSE_SCHEMAS)[K]>;
}
