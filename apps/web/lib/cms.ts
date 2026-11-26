import { draftMode } from 'next/headers';
import type { z } from 'zod';
import { CMS_RESPONSE_SCHEMAS, cmsFetch, rewriteMediaUrls, type ContentLocale } from '@broker/api-client';
import { readTenantSlug } from '@broker/tenant';
import { lastGoodKey, loadLastGood, saveLastGood } from './cms-last-good';
import { markCmsOutage } from './cms-outage';
import { withLiveParams } from './live-params';

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
  locale: ContentLocale;
  revalidate?: number;
  params?: Record<string, string>;
}

export class CmsUnavailableError extends Error {
  constructor(
    readonly resource: string,
    readonly reason: string,
  ) {
    super(`CMS недоступна, сохранённой версии нет: ${resource} (${reason})`);
    this.name = 'CmsUnavailableError';
  }
}

export function cmsTags(resource: string, slug: string | null): string[] {
  const tag = `cms:${resource}`;
  return slug ? [tag, `${tag}:${slug}`] : [tag];
}

export function isCmsConfigured(): boolean {
  return Boolean(process.env.CMS_API_URL?.trim()) && readTenantSlug(process.env.SITE_SLUG) !== null;
}

export function isDraft(): boolean {
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
      if (!draft && key) await saveLastGood(key, data);
      // Медиа CMS — через /media/ сайта (хост cms. закрыт по IP). В «последней версии» храним как есть.
      return withLiveParams(rewriteMediaUrls(data), locale);
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
      return withLiveParams(rewriteMediaUrls(parsed.data), locale);
    }
  }

  console.error(
    `[cms] ALERT: CMS недоступна и сохранённой версии нет — ${resource} (${locale}), ` +
      `страница не будет показана (503): ${describeFailure(failure)}`,
  );
  markCmsOutage(resource);
  throw new CmsUnavailableError(resource, describeFailure(failure));
}

export async function staticParamsFromCms<T>(load: () => Promise<T[]>): Promise<T[]> {
  if (!isCmsConfigured()) return [];
  try {
    return await load();
  } catch {
    return [];
  }
}
