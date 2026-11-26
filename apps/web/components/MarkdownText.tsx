import { Fragment } from 'react';
import { parseMarkdown, type Inline } from './markdown';

function renderInline(nodes: Inline[]): React.ReactNode {
  return nodes.map((n, i) => {
    switch (n.kind) {
      case 'text':
        return <Fragment key={i}>{n.text}</Fragment>;
      case 'strong':
        return <strong key={i} className="font-semibold text-primary">{renderInline(n.children)}</strong>;
      case 'em':
        return <em key={i}>{renderInline(n.children)}</em>;
      case 'code':
        return <code key={i} className="rounded bg-elevated px-1 py-0.5 font-mono text-[0.9em]">{n.text}</code>;
      case 'link':
        return (
          <a
            key={i}
            href={n.href}
            className="text-accent underline-offset-2 hover:underline"
            {...(n.external ? { target: '_blank', rel: 'noopener noreferrer nofollow' } : {})}
          >
            {renderInline(n.children)}
          </a>
        );
    }
  });
}

/** Markdown из CMS: абзацы, заголовки, списки, жирный, курсив, код, ссылки. Без HTML. */
export function MarkdownText({
  markdown,
  paragraphClassName = 'leading-relaxed text-primary/90',
}: {
  markdown: string;
  paragraphClassName?: string;
}) {
  return (
    <>
      {parseMarkdown(markdown).map((b, i) => {
        if (b.kind === 'p') return <p key={i} className={paragraphClassName}>{renderInline(b.inline)}</p>;
        if (b.kind === 'h') {
          const Tag = `h${b.level}` as 'h2' | 'h3' | 'h4';
          return <Tag key={i} className="mt-2 font-semibold text-primary">{renderInline(b.inline)}</Tag>;
        }
        const List = b.kind === 'ul' ? 'ul' : 'ol';
        return (
          <List key={i} className={`${paragraphClassName} ${b.kind === 'ul' ? 'list-disc' : 'list-decimal'} space-y-1 pl-6`}>
            {b.items.map((item, j) => <li key={j}>{renderInline(item)}</li>)}
          </List>
        );
      })}
    </>
  );
}
