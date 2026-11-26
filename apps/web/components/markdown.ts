/**
 * Безопасный разбор Markdown из CMS в дерево блоков (ТД-009 п.7). HTML не поддерживается
 * и выводится как текст: никакого dangerouslySetInnerHTML. Ссылки — только http(s), mailto
 * и относительные пути; остальное (javascript:, data:) остаётся текстом.
 */
export type Inline =
  | { kind: 'text'; text: string }
  | { kind: 'strong'; children: Inline[] }
  | { kind: 'em'; children: Inline[] }
  | { kind: 'code'; text: string }
  | { kind: 'link'; href: string; external: boolean; children: Inline[] };

export type Block =
  | { kind: 'p'; inline: Inline[] }
  | { kind: 'h'; level: 2 | 3 | 4; inline: Inline[] }
  | { kind: 'ul' | 'ol'; items: Inline[][] };

export function safeHref(raw: string): { href: string; external: boolean } | null {
  const href = raw.trim();
  if (/^https?:\/\//i.test(href)) return { href, external: true };
  if (/^mailto:[^\s]+$/i.test(href)) return { href, external: true };
  if (href.startsWith('/') && !href.startsWith('//')) return { href, external: false };
  if (href.startsWith('#')) return { href, external: false };
  return null;
}

const INLINE = /(\*\*([^*]+)\*\*|__([^_]+)__|\*([^*\s][^*]*)\*|_([^_\s][^_]*)_|`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\))/;

export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  let rest = text;
  while (rest.length > 0) {
    const m = INLINE.exec(rest);
    if (!m || m.index === undefined) {
      out.push({ kind: 'text', text: rest });
      break;
    }
    if (m.index > 0) out.push({ kind: 'text', text: rest.slice(0, m.index) });
    const [whole, , b1, b2, i1, i2, code, label, url] = m;
    if (b1 ?? b2) out.push({ kind: 'strong', children: parseInline((b1 ?? b2)!) });
    else if (i1 ?? i2) out.push({ kind: 'em', children: parseInline((i1 ?? i2)!) });
    else if (code !== undefined) out.push({ kind: 'code', text: code });
    else if (label !== undefined && url !== undefined) {
      const safe = safeHref(url);
      if (safe) out.push({ kind: 'link', ...safe, children: parseInline(label) });
      else out.push({ kind: 'text', text: whole });
    }
    rest = rest.slice(m.index + whole.length);
  }
  return out;
}

export function parseMarkdown(markdown: string): Block[] {
  const blocks: Block[] = [];
  for (const chunk of markdown.replace(/\r\n?/g, '\n').split(/\n{2,}/)) {
    const lines = chunk.split('\n').map((l) => l.trimEnd()).filter((l) => l.trim().length > 0);
    if (lines.length === 0) continue;
    const heading = /^(#{1,4})\s+(.*)$/.exec(lines[0]!.trim());
    if (heading && lines.length === 1) {
      const level = Math.min(4, Math.max(2, heading[1]!.length + 1)) as 2 | 3 | 4;
      blocks.push({ kind: 'h', level, inline: parseInline(heading[2]!) });
      continue;
    }
    if (lines.every((l) => /^\s*[-*•]\s+/.test(l))) {
      blocks.push({ kind: 'ul', items: lines.map((l) => parseInline(l.replace(/^\s*[-*•]\s+/, ''))) });
      continue;
    }
    if (lines.every((l) => /^\s*\d+[.)]\s+/.test(l))) {
      blocks.push({ kind: 'ol', items: lines.map((l) => parseInline(l.replace(/^\s*\d+[.)]\s+/, ''))) });
      continue;
    }
    blocks.push({ kind: 'p', inline: parseInline(lines.map((l) => l.trim()).join(' ')) });
  }
  return blocks;
}
