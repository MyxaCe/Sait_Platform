import { draftMode } from 'next/headers';
import type { z } from 'zod';
import { CMS_RESPONSE_SCHEMAS, cmsFetch, type Locale } from '@broker/api-client';
import { readTenantSlug } from '@broker/tenant';
import { lastGoodKey, loadLastGood, saveLastGood } from './cms-last-good';
import { markCmsOutage } from './cms-outage';

/**
 * Единая точка чтения CMS-контента страницами.
 *
 * **Контента в коде нет — даже как запасного** (решение владельца 10.11,
 * `_brain/ДЕМО-контент-из-CMS-аудит.md`). Прежде здесь при любой ошибке
 * CMS и на сборке без CMS подставлялись фикстуры из `lib/cms-mock.ts`:
 * они разошлись с CMS, а посетитель не мог отличить их от настоящих.
 *
 * Порядок теперь такой:
 *  1. CMS ответила → данные; ответ записывается как «последний удачный»
 *     (`cms-last-good.ts`, на постоянном томе).
 *  2. CMS не ответила (сеть, таймаут, 5xx, мусор мимо схемы, CMS не
 *     настроена) → последний удачный ответ CMS с диска + лог уровня error.
 *  3. Сохранённого нет → `CmsUnavailableError`. Страница не рендерится:
 *     ISR оставляет прежнюю версию, а если её нет — посетитель видит
 *     «Контент временно недоступен» (503, noindex, Retry-After — см.
 *     `cms-outage.ts` и `server-entry.cjs`).
 *
 * **Теги.** Вешаются ОБА: `cms:<ресурс>` и `cms:<ресурс>:<слаг>`. CMS для
 * сайта не по умолчанию шлёт в вебхуке второй вид, и с одним первым
 * правки до второй платформы доходили только по таймеру (~час).
 */

/** Все ресурсы контракта, которые читает витрина: для прогрева и тегов. */
export const CMS_RESOURCES = [
  'brand',
  'navigation',
  'instruments',
  'accounts',
  'faq',
  'promotions',
  'partners',
  'academy',
  'streams',
  'articles',
  'contacts',
  'careers',
  'legal',
  'system-status',
] as const satisfies readonly (keyof typeof CMS_RESPONSE_SCHEMAS)[];

export type CmsResource = (typeof CMS_RESOURCES)[number];

type CmsData<K extends CmsResource> = z.infer<(typeof CMS_RESPONSE_SCHEMAS)[K]>;

interface GetCmsOptions {
  locale: Locale;
  /** Страховочный интервал ревалидации, сек (медленные данные — 3600) */
  revalidate?: number;
  params?: Record<string, string>;
}

/** CMS недоступна, и сохранённой версии ресурса нет. Показать нечего. */
export class CmsUnavailableError extends Error {
  constructor(
    readonly resource: string,
    readonly reason: string,
  ) {
    super(`CMS недоступна, сохранённой версии нет: ${resource} (${reason})`);
    this.name = 'CmsUnavailableError';
  }
}

/** Теги ресурса: общий и со слагом сайта (CMS не по умолчанию шлёт второй). */
export function cmsTags(resource: string, slug: string | null): string[] {
  const tag = `cms:${resource}`;
  return slug ? [tag, `${tag}:${slug}`] : [tag];
}

/** CMS для витрины настроена: адрес и слаг сайта заданы. */
export function isCmsConfigured(): boolean {
  return Boolean(process.env.CMS_API_URL?.trim()) && readTenantSlug(process.env.SITE_SLUG) !== null;
}

function isDraft(): boolean {
  // Вне request-контекста (сборка, generateStaticParams) — false
  try {
    return draftMode().isEnabled;
  } catch {
    return false;
  }
}

function describeFailure(error: unknown): string {
  if (error instanceof Error) {
    const cause = (error as { cause?: unknown }).cause;
    return cause instanceof Error ? `${error.message}: ${cause.message}` : error.message;
  }
  return String(error);
}

export async function getCms<K extends CmsResource>(
  resource: K,
  { locale, revalidate = 3600, params = {} }: GetCmsOptions,
): Promise<CmsData<K>> {
  const schema = CMS_RESPONSE_SCHEMAS[resource] as unknown as z.ZodType<
    CmsData<K>,
    z.ZodTypeDef,
    unknown
  >;
  const draft = isDraft();

  // Слага нет — в CMS НЕ идём вовсе (PKG-05): запрос с `?site=` вернул
  // бы сайт по умолчанию, то есть чужой бренд без единой ошибки.
  const slug = readTenantSlug(process.env.SITE_SLUG);
  const key = slug ? lastGoodKey(resource, slug, locale, params) : null;

  let failure: unknown;
  if (!process.env.CMS_API_URL?.trim()) {
    failure = new Error('CMS_API_URL не задан');
  } else if (slug === null) {
    failure = new Error('SITE_SLUG не задан (PKG-05: без слага CMS отдала бы чужой сайт)');
  } else {
    const siteParams = { site: slug, ...params };
    try {
      const data = await cmsFetch(`/cms/${resource}`, {
        schema,
        locale,
        tags: cmsTags(resource, slug),
        revalidate: draft ? 0 : revalidate,
        searchParams: draft ? { ...siteParams, draft: 'true' } : siteParams,
      });
      // Черновик — не «последняя версия сайта»
      if (!draft && key) await saveLastGood(key, data);
      return data;
    } catch (error) {
      failure = error;
    }
  }

  if (key && !draft) {
    const saved = await loadLastGood(key);
    const parsed = saved ? schema.safeParse(saved.data) : null;
    if (saved && parsed?.success) {
      console.error(
        `[cms] CMS недоступна — ${resource} (${locale}) показан из последней версии от ${saved.savedAt}: ${describeFailure(failure)}`,
      );
      return parsed.data;
    }
  }

  // Уровень error и постоянный префикс — по нему настраивается алерт
  console.error(
    `[cms] ALERT: CMS недоступна и сохранённой версии нет — ${resource} (${locale}), ` +
      `страница не будет показана (503): ${describeFailure(failure)}`,
  );
  markCmsOutage(resource);
  throw new CmsUnavailableError(resource, describeFailure(failure));
}

/**
 * Списки для `generateStaticParams`. CMS на сборке нет (так в CI) или она
 * не ответила → пустой список: страницы соберутся при первом запросе
 * (on-demand ISR, `dynamicParams` по умолчанию true). Списка из кода нет.
 */
export async function staticParamsFromCms<T>(load: () => Promise<T[]>): Promise<T[]> {
  if (!isCmsConfigured()) return [];
  try {
    return await load();
  } catch {
    return [];
  }
}
