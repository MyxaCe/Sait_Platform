import { describe, expect, it } from 'vitest';
import type { Locale } from '@broker/api-client';
import { buildArticleDetail, CMS_MOCK } from './cms-mock';

/**
 * Контрактный тест (риск R-16): каждый ресурс mock-CRM в обеих локалях
 * обязан проходить Zod-схему контракта (parse встроен в билдеры —
 * исключение здесь означает рассинхрон данных и контракта).
 */
const LOCALES: Locale[] = ['ru', 'en'];

describe('mock-CRM соответствует контракту', () => {
  for (const locale of LOCALES) {
    for (const [resource, builder] of Object.entries(CMS_MOCK)) {
      it(`${resource} (${locale})`, () => {
        expect(() => builder(locale, new URLSearchParams())).not.toThrow();
      });
    }
  }

  it('articles: фильтр категории и пагинация', () => {
    const result = CMS_MOCK.articles!('ru', new URLSearchParams('category=economy&pageSize=2')) as {
      items: unknown[];
      total: number;
      pageSize: number;
    };
    expect(result.total).toBeGreaterThan(0);
    expect(result.items.length).toBeLessThanOrEqual(2);
  });

  it('streams: фильтр по статусу', () => {
    const result = CMS_MOCK.streams!('en', new URLSearchParams('status=past')) as {
      items: { status: string }[];
    };
    expect(result.items.every((s) => s.status === 'past')).toBe(true);
  });

  it('детальная статья существует и валидна; неизвестный слаг → null', () => {
    expect(buildArticleDetail('gold-tests-record-highs', 'en')).not.toBeNull();
    expect(buildArticleDetail('no-such-article', 'ru')).toBeNull();
  });
});
