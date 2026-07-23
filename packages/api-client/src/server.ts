import type { z } from 'zod';

/**
 * Серверный клиент CMS-контракта (используется ТОЛЬКО в RSC/route handlers).
 * Слои защиты (риск R-06): timeout → Zod-валидация → fallback.
 * ISR-кеширование — через параметры next: { tags, revalidate }.
 */

export interface CmsFetchOptions<T> {
  schema: z.ZodType<T>;
  locale?: 'ru' | 'en';
  /** Теги для revalidateTag() из вебхука /api/revalidate */
  tags?: string[];
  /** Страховочный интервал ревалидации, сек */
  revalidate?: number | false;
  /** Последний рубеж при недоступной/невалидной CRM (фикстуры) */
  fallback?: T;
  searchParams?: Record<string, string>;
  timeoutMs?: number;
}

/** Пакет не зависит от Next напрямую — опция `next` объявлена локально */
type NextRequestInit = RequestInit & {
  next?: { tags?: string[]; revalidate?: number | false };
};

export class CmsError extends Error {
  constructor(
    message: string,
    public readonly path: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'CmsError';
  }
}

function baseUrl(): string {
  const url = process.env.CMS_API_URL;
  if (!url) {
    throw new CmsError(
      'CMS_API_URL is not set — use fallback fixtures or configure mock-CRM origin',
      '(config)',
    );
  }
  return url.replace(/\/$/, '');
}

export async function cmsFetch<T>(path: string, options: CmsFetchOptions<T>): Promise<T> {
  const {
    schema,
    locale = 'ru',
    tags = [],
    revalidate = 3600,
    fallback,
    searchParams = {},
    timeoutMs = 3_000,
  } = options;

  const report = (reason: string, cause?: unknown) => {
    // Каждый фолбэк обязан быть виден: риск R-15 «фолбэк без алерта — скрытая авария».
    // TODO(glitchtip): заменить на Sentry.captureException после подключения SDK.
    console.error(`[cmsFetch] ${reason} path=${path} locale=${locale}`, cause ?? '');
  };

  try {
    const params = new URLSearchParams({ locale, ...searchParams });
    const init: NextRequestInit = {
      headers: {
        Accept: 'application/json',
        ...(process.env.CMS_API_KEY ? { 'X-API-Key': process.env.CMS_API_KEY } : {}),
      },
      signal: AbortSignal.timeout(timeoutMs),
      next: { tags, revalidate },
    };
    const response = await fetch(`${baseUrl()}${path}?${params}`, init);

    if (!response.ok) {
      throw new CmsError(`HTTP ${response.status}`, path);
    }

    const parsed = schema.safeParse(await response.json());
    if (!parsed.success) {
      throw new CmsError('schema validation failed', path, parsed.error.issues.slice(0, 5));
    }
    return parsed.data;
  } catch (error) {
    if (fallback !== undefined) {
      report('falling back to fixtures', error);
      return fallback;
    }
    report('failed without fallback', error);
    throw error instanceof CmsError ? error : new CmsError('fetch failed', path, error);
  }
}
