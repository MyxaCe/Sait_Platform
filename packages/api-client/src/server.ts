import type { z } from 'zod';
import type { ContentLocale } from './schemas/common';

export interface CmsFetchOptions<T> {
  schema: z.ZodType<T, z.ZodTypeDef, unknown>;
  locale?: ContentLocale;
  tags?: string[];
  revalidate?: number | false;
  searchParams?: Record<string, string>;
  timeoutMs?: number;
}

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
      'CMS_API_URL is not set — CMS is not configured',
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
    searchParams = {},
    timeoutMs = 3_000,
  } = options;

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
    throw error instanceof CmsError ? error : new CmsError('fetch failed', path, error);
  }
}
