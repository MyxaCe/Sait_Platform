import { describe, expect, it } from 'vitest';
import { academyResponseSchema, articleSchema, articlesResponseSchema } from './cms';

const legacy = {
  slug: 'gold',
  title: 'Gold',
  excerpt: 'e',
  category: 'forex',
  source: 'Desk',
  publishedAt: '2026-07-23T08:30:00Z',
  readingMinutes: 3,
  bodyMarkdown: 'Text',
};
const body = { root: { type: 'root', children: [{ type: 'paragraph', children: [{ type: 'text', text: 'Hi' }] }] } };
const cover = { url: 'https://cms.example/c.jpg', width: 1200, height: 600, alt: 'Cover', mimeType: 'image/jpeg' };
const video = { provider: 'youtube', videoId: 'dQw4w9WgXcQ', url: 'https://youtu.be/dQw4w9WgXcQ' };

describe('статьи в контракте CMS', () => {
  it('ответ прежней CMS (только Markdown, без раздела) читается как раньше', () => {
    const list = articlesResponseSchema.parse({ items: [legacy], total: 1, page: 1, pageSize: 20 });
    expect(list.section).toBeUndefined();
    expect(list.items[0]).toEqual(legacy);
  });

  it('новые поля читаются: раздел, Lexical, обложка, название категории, уровень и видео', () => {
    const article = articleSchema.parse({
      ...legacy,
      section: 'education',
      body,
      cover,
      categoryTitle: 'Forex',
      level: 'intermediate',
      video,
    });
    expect(article.section).toBe('education');
    expect(article.body?.root.children).toHaveLength(1);
    expect(article.cover).toEqual(cover);
    expect(article.level).toBe('intermediate');
    expect(article.video).toEqual(video);
    expect(articlesResponseSchema.parse({ items: [], total: 0, page: 1, pageSize: 100, section: 'education' }).section).toBe('education');
  });

  it('негодное новое поле теряет только себя, статья остаётся', () => {
    const article = articleSchema.parse({
      ...legacy,
      section: 'blog',
      body: { html: '<p>x</p>' },
      cover: { url: 'not-a-url' },
      level: 'expert',
      video: { provider: 'rutube', videoId: '1', url: 'https://example.com' },
    });
    expect(article).toEqual(legacy);
  });

  it('уровень «Профессиональный» (advanced) читается', () => {
    expect(articleSchema.parse({ ...legacy, section: 'education', level: 'advanced' }).level).toBe('advanced');
  });

  it('academy: неизвестный уровень из более новой CMS не роняет ответ (глоссарий и вебинары живут)', () => {
    const article = { slug: 'a', title: 'A', excerpt: 'e', readingMinutes: 3, bodyMarkdown: 'x' };
    const parsed = academyResponseSchema.parse({
      articles: [{ ...article, level: 'advanced' }, { ...article, slug: 'b', level: 'expert' }],
      webinars: [],
      glossary: [{ term: 'Спред', definition: 'Разница' }],
    });
    expect(parsed.articles.map((a) => a.level)).toEqual(['advanced', 'beginner']);
    expect(parsed.glossary).toHaveLength(1);
  });
});
