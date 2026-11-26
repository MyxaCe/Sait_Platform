import { describe, expect, it } from 'vitest';
import { parseInline, parseMarkdown, safeHref } from './markdown';

describe('Markdown из CMS (ТД-009 п.7)', () => {
  it('абзацы, заголовок, списки', () => {
    const b = parseMarkdown('## Раздел\n\nПервый абзац\nпродолжение\n\n- раз\n- два\n\n1. а\n2. б');
    expect(b.map((x) => x.kind)).toEqual(['h', 'p', 'ul', 'ol']);
    expect(b[1]).toEqual({ kind: 'p', inline: [{ kind: 'text', text: 'Первый абзац продолжение' }] });
  });

  it('жирный, курсив, код, ссылки', () => {
    expect(parseInline('**жирно** и *курсив* и `код`').map((n) => n.kind)).toEqual(['strong', 'text', 'em', 'text', 'code']);
    expect(parseInline('[политика](/legal/privacy)')).toEqual([
      { kind: 'link', href: '/legal/privacy', external: false, children: [{ kind: 'text', text: 'политика' }] },
    ]);
  });

  it('опасные ссылки остаются текстом, HTML не исполняется', () => {
    expect(safeHref('javascript:alert(1)')).toBeNull();
    expect(safeHref('//evil.test')).toBeNull();
    expect(parseInline('[x](javascript:alert(1))')[0]?.kind).toBe('text');
    expect(parseMarkdown('<script>alert(1)</script>')).toEqual([{ kind: 'p', inline: [{ kind: 'text', text: '<script>alert(1)</script>' }] }]);
  });

  it('звёздочка в обычном тексте не ломает разбор', () => {
    expect(parseInline('цена 2 * 3')).toEqual([{ kind: 'text', text: 'цена 2 * 3' }]);
  });
});
