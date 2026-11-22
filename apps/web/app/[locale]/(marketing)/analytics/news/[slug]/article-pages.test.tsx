import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { articlesResponseSchema } from '@broker/api-client';

const translate = Object.assign((key: string, values?: Record<string, unknown>) => (values ? `${key}:${Object.values(values).join(',')}` : key), {
  has: () => false,
});

vi.mock('next-intl/server', () => ({
  getTranslations: async () => translate,
  setRequestLocale: () => undefined,
}));
vi.mock('@/i18n/navigation', () => ({
  Link: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}));
vi.mock('@/lib/brand', () => ({ brandName: async () => 'Brand' }));

const state = vi.hoisted(() => ({ draft: false, articles: null as unknown }));
vi.mock('@/lib/cms', () => ({
  isDraft: () => state.draft,
  getCms: async () => state.articles,
  staticParamsFromCms: async () => [],
}));

const body = {
  root: {
    type: 'root',
    children: [
      { type: 'heading', tag: 'h2', children: [{ type: 'text', text: 'Что дальше', format: 0 }] },
      { type: 'paragraph', children: [{ type: 'text', text: 'Текст из редактора', format: 1 }] },
    ],
  },
};
const base = {
  title: 'Золото на максимуме',
  excerpt: 'Анонс',
  category: 'metals',
  source: 'Отдел',
  readingMinutes: 3,
  bodyMarkdown: 'Markdown-копия',
};

afterEach(() => {
  state.draft = false;
});

async function renderNews(slug: string) {
  const { default: Page } = await import('./page');
  return render(await Page({ params: { locale: 'ru', slug } }));
}

describe('страница новости на витрине', () => {
  it('новая CMS: Lexical вместо Markdown, обложка, название категории из CMS', async () => {
    state.articles = articlesResponseSchema.parse({
      items: [{ ...base, slug: 'gold', publishedAt: '2026-11-20T08:00:00Z', section: 'news', body, categoryTitle: 'Металлы', cover: { url: 'https://cms.example/c.jpg', width: 1200, height: 600, alt: 'Слиток', mimeType: 'image/jpeg' } }],
      total: 1, page: 1, pageSize: 50, section: 'news',
    });
    await renderNews('gold');
    expect(screen.getByRole('heading', { level: 2, name: 'Что дальше' })).toBeTruthy();
    expect(screen.getByText('Текст из редактора').closest('strong')).toBeTruthy();
    expect(screen.queryByText('Markdown-копия')).toBeNull();
    expect(screen.getByText('Металлы')).toBeTruthy();
    expect(screen.getByRole('img', { name: 'Слиток' }).getAttribute('src')).toBe('https://cms.example/c.jpg');
  });

  it('запланированная статья: на сайте 404, в предпросмотре — с пометкой о дате', async () => {
    state.articles = articlesResponseSchema.parse({
      items: [{ ...base, slug: 'tomorrow', publishedAt: '2099-01-01T08:00:00Z', section: 'news', body }],
      total: 1, page: 1, pageSize: 50, section: 'news',
    });
    await expect(renderNews('tomorrow')).rejects.toThrow();
    state.draft = true;
    await renderNews('tomorrow');
    expect(screen.getByText(/^scheduled:/)).toBeTruthy();
  });
});
