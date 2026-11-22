import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { articleSchema } from '@broker/api-client';
import { ArticleBody, RichText, safeHref } from './RichText';

const text = (value: string, format = 0) => ({ type: 'text', text: value, format });
const paragraph = (...children: unknown[]) => ({ type: 'paragraph', children });
const doc = (...children: unknown[]) => ({ root: { type: 'root', children } });

const BODY = doc(
  { type: 'heading', tag: 'h2', children: [text('Итоги недели')] },
  paragraph(text('Доллар '), text('ослаб', 1), text(', евро ', 0), text('вырос', 2), { type: 'linebreak' }, text('и всё.')),
  { type: 'list', listType: 'bullet', tag: 'ul', children: [{ type: 'listitem', children: [text('пункт один')] }, { type: 'listitem', children: [text('пункт два')] }] },
  { type: 'list', listType: 'number', tag: 'ol', children: [{ type: 'listitem', children: [text('шаг')] }] },
  { type: 'quote', children: [text('Цитата аналитика')] },
  paragraph(
    { type: 'link', fields: { url: 'https://example.com/report', newTab: true }, children: [text('отчёт')] },
    text(' и '),
    { type: 'link', fields: { url: '/education/articles/risk', newTab: false }, children: [text('статья')] },
    text(' и '),
    { type: 'link', fields: { url: 'javascript:alert(1)' }, children: [text('плохая')] },
  ),
  { type: 'upload', media: { url: 'https://cms.example/m/chart.png', width: 800, height: 400, alt: 'График EURUSD', mimeType: 'image/png' } },
  { type: 'upload', media: { url: 'https://cms.example/m/file.pdf', width: 1, height: 1, alt: '', mimeType: 'application/pdf' } },
  { type: 'block', fields: { blockType: 'video', caption: 'Разбор графика', video: { provider: 'youtube', videoId: 'dQw4w9WgXcQ', url: 'https://youtu.be/dQw4w9WgXcQ' } } },
  { type: 'block', fields: { blockType: 'video', video: { provider: 'rutube', videoId: 'x' } } },
  { type: 'horizontalrule' },
  { type: 'mystery', children: [text('неизвестный узел')] },
  paragraph(),
);

describe('рендер Lexical на витрине', () => {
  it('заголовки, жирный/курсив, списки, цитаты', () => {
    const { container } = render(<RichText value={BODY} title="Статья" />);
    expect(screen.getByRole('heading', { level: 2, name: 'Итоги недели' })).toBeTruthy();
    expect(container.querySelector('strong')?.textContent).toBe('ослаб');
    expect(container.querySelector('em')?.textContent).toBe('вырос');
    expect(container.querySelector('br')).toBeTruthy();
    expect([...container.querySelectorAll('ul > li')].map((li) => li.textContent)).toEqual(['пункт один', 'пункт два']);
    expect(container.querySelector('ol > li')?.textContent).toBe('шаг');
    expect(container.querySelector('blockquote')?.textContent).toBe('Цитата аналитика');
    expect(container.querySelector('hr')).toBeTruthy();
    expect(screen.getByText('неизвестный узел')).toBeTruthy();
    expect(container.querySelectorAll('p').length).toBe(2);
  });

  it('ссылки: rel="noopener noreferrer", новая вкладка по флагу, опасные адреса — просто текст', () => {
    render(<RichText value={BODY} title="Статья" />);
    const external = screen.getByRole('link', { name: 'отчёт' });
    expect(external.getAttribute('href')).toBe('https://example.com/report');
    expect(external.getAttribute('rel')).toBe('noopener noreferrer');
    expect(external.getAttribute('target')).toBe('_blank');
    const internal = screen.getByRole('link', { name: 'статья' });
    expect(internal.getAttribute('rel')).toBe('noopener noreferrer');
    expect(internal.getAttribute('target')).toBeNull();
    expect(screen.queryByRole('link', { name: 'плохая' })).toBeNull();
    expect(screen.getByText('плохая')).toBeTruthy();
    expect(safeHref('//evil.example')).toBeNull();
    expect(safeHref(' mailto:desk@example.com ')).toBe('mailto:desk@example.com');
  });

  it('картинка из media с размерами и alt; не-картинки не выводятся', () => {
    render(<RichText value={BODY} title="Статья" />);
    const images = screen.getAllByRole('img');
    expect(images).toHaveLength(1);
    expect(images[0]!.getAttribute('src')).toBe('https://cms.example/m/chart.png');
    expect(images[0]!.getAttribute('alt')).toBe('График EURUSD');
    expect(images[0]!.getAttribute('width')).toBe('800');
    expect(images[0]!.getAttribute('loading')).toBe('lazy');
  });

  it('видео-блок — фасад: плеер грузится только по клику, неизвестная платформа не выводится', () => {
    const { container } = render(<RichText value={BODY} title="Статья" />);
    expect(container.querySelector('iframe')).toBeNull();
    const play = screen.getByRole('button', { name: 'Разбор графика' });
    fireEvent.click(play);
    const iframes = container.querySelectorAll('iframe');
    expect(iframes).toHaveLength(1);
    expect(iframes[0]!.getAttribute('src')).toBe('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?autoplay=1');
  });

  it('совместимость: без Lexical (старая CMS) — Markdown по абзацам', () => {
    const legacy = articleSchema.parse({
      slug: 's',
      title: 't',
      excerpt: 'e',
      category: 'forex',
      source: 'Desk',
      publishedAt: '2026-07-23T08:30:00Z',
      readingMinutes: 3,
      bodyMarkdown: 'Первый абзац.\n\nВторой абзац.',
    });
    const { container } = render(<ArticleBody body={legacy.body} bodyMarkdown={legacy.bodyMarkdown} title={legacy.title} />);
    expect([...container.querySelectorAll('p')].map((p) => p.textContent)).toEqual(['Первый абзац.', 'Второй абзац.']);
    const empty = render(<ArticleBody body={doc()} bodyMarkdown="Запасной текст" title="t" />);
    expect(empty.container.textContent).toBe('Запасной текст');
  });
});
