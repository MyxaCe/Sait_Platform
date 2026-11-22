import { afterEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ draft: false, responses: {} as Record<string, unknown>, calls: [] as unknown[] }));

vi.mock('./cms', () => ({
  isDraft: () => state.draft,
  getCms: async (resource: string, options: { params?: Record<string, string> }) => {
    state.calls.push([resource, options.params ?? {}]);
    return state.responses[resource];
  },
}));

const { findEducationArticle, findNews, isPublishedBy, loadEducationArticles, loadNews } = await import('./articles');

const NOW = new Date('2026-11-22T12:00:00Z');
const past = '2026-11-20T08:00:00Z';
const future = '2099-01-01T08:00:00Z';
const article = (slug: string, extra: Record<string, unknown> = {}) => ({
  slug,
  title: slug,
  excerpt: 'e',
  category: 'forex',
  source: 'Desk',
  publishedAt: past,
  readingMinutes: 2,
  bodyMarkdown: 'text',
  ...extra,
});
const academyArticle = { slug: 'what-is-forex', title: 'Forex', excerpt: 'e', level: 'beginner', readingMinutes: 7, bodyMarkdown: 'md' };

afterEach(() => {
  state.draft = false;
  state.responses = {};
  state.calls = [];
  vi.useRealTimers();
});

describe('статьи на витрине: расписание, черновики, раздел обучения', () => {
  it('дата публикации: прошлое и сейчас — видно, будущее — нет', () => {
    expect(isPublishedBy(past, NOW)).toBe(true);
    expect(isPublishedBy('2026-11-22T12:00:00Z', NOW)).toBe(true);
    expect(isPublishedBy(future, NOW)).toBe(false);
    expect(isPublishedBy(undefined, NOW)).toBe(true);
  });

  it('новости: запланированные скрыты, статьи обучения в ленту новостей не попадают', async () => {
    state.responses.articles = { items: [article('now'), article('later', { publishedAt: future }), article('edu', { section: 'education' })], section: 'news' };
    expect((await loadNews('ru')).map((a) => a.slug)).toEqual(['now']);
    expect(await findNews('ru', 'later')).toBeNull();
    expect(state.calls[0]).toEqual(['articles', { pageSize: '50' }]);
  });

  it('предпросмотр (draft mode): запланированные видны', async () => {
    state.draft = true;
    state.responses.articles = { items: [article('now'), article('later', { publishedAt: future })], section: 'news' };
    expect((await loadNews('ru')).map((a) => a.slug)).toEqual(['now', 'later']);
  });

  it('обучение: новая CMS — из коллекции (section=education), без запроса academy', async () => {
    state.responses.articles = {
      items: [article('what-is-forex', { section: 'education', level: 'intermediate', category: '', body: { root: { children: [] } } }), article('soon', { section: 'education', publishedAt: future })],
      section: 'education',
    };
    const items = await loadEducationArticles('de');
    expect(items.map((a) => [a.slug, a.level])).toEqual([['what-is-forex', 'intermediate']]);
    expect(items[0]!.body).toBeDefined();
    expect(state.calls).toEqual([['articles', { section: 'education', pageSize: '100' }]]);
  });

  it('обучение: старая CMS (нет section в ответе) — как раньше, из academy; адреса те же', async () => {
    state.responses.articles = { items: [article('fed-news')], total: 1, page: 1, pageSize: 20 };
    state.responses.academy = { articles: [academyArticle], webinars: [], glossary: [] };
    expect((await loadEducationArticles('ru')).map((a) => a.slug)).toEqual(['what-is-forex']);
    expect((await findEducationArticle('ru', 'what-is-forex'))?.bodyMarkdown).toBe('md');
    expect(await findEducationArticle('ru', 'fed-news')).toBeNull();
  });
});
