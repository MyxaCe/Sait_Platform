import { describe, expect, it } from 'vitest';
import { academyResponseSchema, streamsResponseSchema } from './cms';

const webinar = {
  id: 'web-1',
  title: 't',
  speaker: 's',
  speakerRole: 'r',
  startsAt: '2026-01-01T10:00:00.000Z',
  durationMinutes: 60,
  level: 'l',
  description: 'd',
};
const article = { slug: 'a', title: 't', excerpt: 'e', level: 'beginner', readingMinutes: 3, bodyMarkdown: 'b' };
const stream = { provider: 'youtube', videoId: 'abc', title: 't', poster: null, startsAt: '2026-01-01T10:00:00.000Z', status: 'past' };
const recording = { provider: 'vimeo', videoId: '76979871', url: 'https://vimeo.com/76979871' };

describe('видео-ссылки в контракте CMS', () => {
  it('ответ прежней CMS без новых полей читается как раньше', () => {
    const academy = academyResponseSchema.parse({ articles: [article], webinars: [webinar], glossary: [] });
    expect(academy.webinars[0]?.recording).toBeUndefined();
    expect(academy.webinars[0]?.joinUrl).toBeUndefined();
    expect(academy.articles[0]?.video).toBeUndefined();
    expect(streamsResponseSchema.parse({ items: [stream] }).items[0]?.videoUrl).toBeUndefined();
  });

  it('новые поля читаются', () => {
    const academy = academyResponseSchema.parse({
      articles: [{ ...article, video: recording }],
      webinars: [{ ...webinar, recording, joinUrl: 'https://zoom.us/j/1' }],
      glossary: [],
    });
    expect(academy.articles[0]?.video).toEqual(recording);
    expect(academy.webinars[0]?.recording).toEqual(recording);
    expect(academy.webinars[0]?.joinUrl).toBe('https://zoom.us/j/1');
    const url = 'https://youtu.be/dQw4w9WgXcQ';
    expect(streamsResponseSchema.parse({ items: [{ ...stream, videoUrl: url }] }).items[0]?.videoUrl).toBe(url);
  });

  it('негодное значение теряет только себя, а не весь ответ', () => {
    const academy = academyResponseSchema.parse({
      articles: [{ ...article, video: { provider: 'rutube', videoId: 'x', url: 'x' } }],
      webinars: [{ ...webinar, recording: 'https://vimeo.com/1', joinUrl: 'javascript:alert(1)' }],
      glossary: [],
    });
    expect(academy.articles[0]?.video).toBeUndefined();
    expect(academy.webinars[0]?.recording).toBeUndefined();
    expect(academy.webinars[0]?.joinUrl).toBeUndefined();
    expect(academyResponseSchema.safeParse({ articles: [], webinars: [{ ...webinar, joinUrl: 'http://zoom.us/j/1' }], glossary: [] }).data?.webinars[0]?.joinUrl).toBeUndefined();
  });
});
