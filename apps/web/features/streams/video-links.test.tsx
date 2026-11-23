import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { academyResponseSchema, streamsResponseSchema } from '@broker/api-client';

const translate = (key: string, values?: Record<string, unknown>) =>
  values ? `${key}:${Object.values(values).join(',')}` : key;

vi.mock('next-intl', () => ({
  useTranslations: () => translate,
  useLocale: () => 'ru',
}));
vi.mock('next-intl/server', () => ({
  getTranslations: async () => translate,
  setRequestLocale: () => undefined,
}));
vi.mock('@/i18n/navigation', () => ({
  Link: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock('@/lib/brand', () => ({ brandName: async () => 'Brand' }));
vi.mock('@/lib/site-languages', () => ({
  getSiteLanguages: async () => ({ defaultLanguage: 'ru', languages: ['ru', 'en'] }),
}));

const CABINET_REGISTER = `${(process.env.NEXT_PUBLIC_CABINET_URL || 'http://localhost:3002').replace(/\/$/, '')}/register`;

const cms = vi.fn<(resource: string) => unknown>();
vi.mock('@/lib/cms', () => ({
  getCms: async (resource: string) => cms(resource),
  staticParamsFromCms: async () => [],
}));

afterEach(() => cms.mockReset());

const PAST = '2020-03-01T10:00:00.000Z';
const FUTURE = '2099-03-01T10:00:00.000Z';
const YT = 'dQw4w9WgXcQ';

const webinar = (over: Record<string, unknown>) => ({
  id: 'web',
  title: 'Вебинар',
  speaker: 'Анна Белова',
  speakerRole: 'Аналитик',
  startsAt: FUTURE,
  durationMinutes: 60,
  level: 'Новичок',
  description: 'Описание',
  ...over,
});

const stream = (over: Record<string, unknown>) => ({
  provider: 'youtube',
  videoId: YT,
  title: 'Эфир',
  poster: null,
  startsAt: PAST,
  status: 'past',
  ...over,
});

function setCms(academy: unknown, streams: unknown) {
  const parsedAcademy = academyResponseSchema.parse(academy);
  const parsedStreams = streamsResponseSchema.parse(streams);
  cms.mockImplementation((resource) => (resource === 'academy' ? parsedAcademy : parsedStreams));
}

async function renderWebinars() {
  const { default: Page } = await import('../../app/[locale]/(marketing)/education/webinars/page');
  return render(await Page({ params: { locale: 'ru' } }));
}

async function renderArticle(slug: string) {
  const { default: Page } = await import('../../app/[locale]/(marketing)/education/articles/[slug]/page');
  return render(await Page({ params: { locale: 'ru', slug } }));
}

const card = (title: string) => screen.getByRole('heading', { name: title }).closest('article')!;

describe('вебинары: запись и ссылка участия', () => {
  it('прошедший с записью — «Смотреть запись», плеер только после клика', async () => {
    setCms(
      {
        articles: [],
        glossary: [],
        webinars: [
          webinar({ id: 'w1', title: 'С записью', startsAt: PAST, recording: { provider: 'vimeo', videoId: '76979871', url: 'https://vimeo.com/76979871' } }),
          webinar({ id: 'w2', title: 'Без записи', startsAt: PAST }),
        ],
      },
      { items: [] },
    );
    const { container } = await renderWebinars();
    expect(container.querySelector('iframe')).toBeNull();
    expect(within(card('Без записи')).getByRole('button', { name: 'recordSoon' }).hasAttribute('disabled')).toBe(true);

    fireEvent.click(within(card('С записью')).getByRole('button', { name: 'watchRecording' }));
    const iframe = container.querySelector('iframe');
    expect(iframe?.getAttribute('src')).toBe('https://player.vimeo.com/video/76979871?autoplay=1');
  });

  it('будущий с joinUrl — «Занять место» в новой вкладке, без — на регистрацию', async () => {
    setCms(
      {
        articles: [],
        glossary: [],
        webinars: [
          webinar({ id: 'w1', title: 'Zoom', joinUrl: 'https://zoom.us/j/123' }),
          webinar({ id: 'w2', title: 'Обычный' }),
        ],
      },
      { items: [] },
    );
    await renderWebinars();
    const zoom = within(card('Zoom')).getByRole('link');
    expect(zoom.getAttribute('href')).toBe('https://zoom.us/j/123');
    expect(zoom.getAttribute('target')).toBe('_blank');
    expect(zoom.getAttribute('rel')).toContain('noopener');
    const plain = within(card('Обычный')).getByRole('link');
    expect(plain.getAttribute('href')).toBe(CABINET_REGISTER);
    expect(plain.getAttribute('target')).toBeNull();
  });

  it('ответ CMS без новых полей и с негодной ссылкой — прежнее поведение', async () => {
    setCms(
      {
        articles: [],
        glossary: [],
        webinars: [
          webinar({ id: 'w1', title: 'Старый прошедший', startsAt: PAST, recording: { provider: 'rutube', videoId: 'x', url: 'x' } }),
          webinar({ id: 'w2', title: 'Старый будущий', joinUrl: 'javascript:alert(1)' }),
        ],
      },
      { items: [stream({ status: 'upcoming' })] },
    );
    await renderWebinars();
    expect(within(card('Старый прошедший')).getByRole('button', { name: 'recordSoon' }).hasAttribute('disabled')).toBe(true);
    expect(within(card('Старый будущий')).getByRole('link').getAttribute('href')).toBe(CABINET_REGISTER);
    expect(screen.queryByRole('region', { name: 'streamRecords' })).toBeNull();
  });
});

describe('записи эфиров', () => {
  it('прошедшие эфиры — блок «Записи эфиров», новые сверху, фасад до клика', async () => {
    setCms(
      { articles: [], glossary: [], webinars: [] },
      {
        items: [
          stream({ title: 'Сейчас', status: 'live', startsAt: FUTURE }),
          stream({ title: 'Старый', videoId: 'old-video-1', startsAt: '2026-01-01T10:00:00.000Z' }),
          stream({ title: 'Новый', provider: 'vimeo', videoId: '76979871', startsAt: '2026-06-01T10:00:00.000Z' }),
        ],
      },
    );
    const { container } = await renderWebinars();
    const block = screen.getByRole('region', { name: 'streamRecords' });
    expect(within(block).getByRole('heading', { name: 'streamRecords' })).toBeTruthy();
    expect(within(block).getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual(['Новый', 'Старый']);
    expect(container.querySelector('iframe')).toBeNull();
    fireEvent.click(within(block).getByRole('button', { name: 'Старый' }));
    expect(container.querySelector('iframe')?.getAttribute('src')).toBe(
      'https://www.youtube-nocookie.com/embed/old-video-1?autoplay=1',
    );
  });
});

describe('статья обучения: видео вверху', () => {
  const article = (over: Record<string, unknown>) => ({
    slug: 'a',
    title: 'Статья',
    excerpt: 'e',
    level: 'beginner',
    readingMinutes: 3,
    bodyMarkdown: 'Текст',
    ...over,
  });

  it('с видео — фасад плеера над текстом, iframe только после клика', async () => {
    setCms(
      {
        articles: [article({ slug: 'v', video: { provider: 'youtube', videoId: YT, url: `https://youtu.be/${YT}` } })],
        webinars: [],
        glossary: [],
      },
      { items: [] },
    );
    const { container } = await renderArticle('v');
    const section = screen.getByRole('region', { name: 'articleVideo' });
    expect(container.querySelector('iframe')).toBeNull();
    fireEvent.click(within(section).getByRole('button', { name: 'Статья' }));
    expect(container.querySelector('iframe')?.getAttribute('src')).toBe(
      `https://www.youtube-nocookie.com/embed/${YT}?autoplay=1`,
    );
  });

  it('без видео — плеера нет', async () => {
    setCms({ articles: [article({ slug: 'p' })], webinars: [], glossary: [] }, { items: [] });
    await renderArticle('p');
    expect(screen.queryByRole('region', { name: 'articleVideo' })).toBeNull();
  });
});

describe('статья обучения: значок уровня', () => {
  it('уровень advanced показывает «Профессиональный» (levelAdvanced), а не «Средний»', async () => {
    setCms(
      {
        articles: [{ slug: 'pro', title: 'Про уровень', excerpt: 'e', level: 'advanced', readingMinutes: 5, bodyMarkdown: 'Текст' }],
        glossary: [],
        webinars: [],
      },
      { items: [] },
    );
    await renderArticle('pro');
    expect(screen.getByText('levelAdvanced')).toBeTruthy();
    expect(screen.queryByText('levelIntermediate')).toBeNull();
  });
});
