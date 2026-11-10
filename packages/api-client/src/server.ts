import type { z } from 'zod';

/**
 * Серверный клиент CMS-контракта (используется ТОЛЬКО в RSC/route handlers).
 * Слои защиты (риск R-06): timeout → Zod-валидация → ОШИБКА наружу.
 * ISR-кеширование — через параметры next: { tags, revalidate }.
 *
 * Подмены фикстурами нет (решение владельца 10.11, `_brain/ДЕМО-контент-из-CMS-аудит.md`):
 * контента в коде нет даже как запасного. Отказ CMS всегда бросает
 * `CmsError` — что показать вместо (последний удачный ответ CMS или
 * честную заглушку), решает потребитель (`apps/web/lib/cms.ts`).
 * Подставленная «правдоподобная» версия неотличима для посетителя от
 * настоящей и однажды уже разошлась с CMS.
 */

export interface CmsFetchOptions<T> {
  /**
   * Вход схемы — `unknown`, а не `T` (WEB-11).
   *
   * `z.ZodType<T>` это `ZodType<T, ZodTypeDef, T>`, то есть «вход равен
   * выходу». Схемы с нормализацией — а бренд теперь читает две разные
   * формы ответа и приводит их к одной — под такой тип не подходят.
   * Разбирается всегда `await response.json()`, то есть `unknown`, и
   * тип обязан это говорить: иначе потребитель не может привести форму
   * соседа к своей, не солгав компилятору.
   */
  schema: z.ZodType<T, z.ZodTypeDef, unknown>;
  locale?: 'ru' | 'en';
  /** Теги для revalidateTag() из вебхука /api/revalidate */
  tags?: string[];
  /** Страховочный интервал ревалидации, сек */
  revalidate?: number | false;
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
    // Лог — забота потребителя: он знает, есть ли чем заменить ответ, и
    // пишет одну строку с исходом, а не две (R-15: отказ виден всегда).
    throw error instanceof CmsError ? error : new CmsError('fetch failed', path, error);
  }
}
