import type { ReactNode } from 'react';
import type { RichText as RichTextValue, VideoRef } from '@broker/api-client';
import { StreamFacade } from '@/features/streams/StreamFacade';
import { MarkdownText } from './MarkdownText';

type Node = {
  type?: string;
  text?: string;
  format?: number | string;
  tag?: string;
  listType?: string;
  children?: unknown[];
  fields?: Record<string, unknown>;
  media?: { url?: string; width?: number; height?: number; alt?: string; mimeType?: string };
};

const BOLD = 1;
const ITALIC = 2;
const STRIKETHROUGH = 4;
const UNDERLINE = 8;
const CODE = 16;
const SUBSCRIPT = 32;
const SUPERSCRIPT = 64;

const SAFE_HREF = /^(https?:\/\/|mailto:|tel:|\/(?!\/)|#)/i;

export function safeHref(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const href = value.trim();
  return SAFE_HREF.test(href) ? href : null;
}

function isVideoRef(value: unknown): value is VideoRef {
  const v = value as VideoRef | null;
  return Boolean(v) && (v!.provider === 'youtube' || v!.provider === 'vimeo') && typeof v!.videoId === 'string' && v!.videoId !== '';
}

function renderText(node: Node, key: number): ReactNode {
  let out: ReactNode = node.text ?? '';
  const format = typeof node.format === 'number' ? node.format : 0;
  if (format & CODE) out = <code className="rounded bg-elevated px-1 py-0.5 text-[0.9em]">{out}</code>;
  if (format & BOLD) out = <strong className="font-semibold text-primary">{out}</strong>;
  if (format & ITALIC) out = <em>{out}</em>;
  if (format & STRIKETHROUGH) out = <s>{out}</s>;
  if (format & UNDERLINE) out = <u>{out}</u>;
  if (format & SUBSCRIPT) out = <sub>{out}</sub>;
  if (format & SUPERSCRIPT) out = <sup>{out}</sup>;
  return <span key={key}>{out}</span>;
}

interface RenderContext {
  title: string;
  paragraphClassName: string;
}

function renderChildren(children: unknown[] | undefined, ctx: RenderContext): ReactNode[] {
  return (children ?? []).map((child, i) => renderNode(child as Node, i, ctx));
}

function renderNode(node: Node, key: number, ctx: RenderContext): ReactNode {
  if (!node || typeof node !== 'object') return null;
  switch (node.type) {
    case 'text':
      return renderText(node, key);
    case 'linebreak':
      return <br key={key} />;
    case 'tab':
      return <span key={key}> </span>;
    case 'paragraph': {
      const children = renderChildren(node.children, ctx);
      if (children.length === 0) return null;
      return (
        <p key={key} className={ctx.paragraphClassName}>
          {children}
        </p>
      );
    }
    case 'heading': {
      const tag = node.tag === 'h3' ? 'h3' : node.tag === 'h4' ? 'h4' : 'h2';
      const className =
        tag === 'h2'
          ? 'pt-4 text-xl font-semibold tracking-tight text-primary sm:text-2xl'
          : tag === 'h3'
            ? 'pt-2 text-lg font-semibold text-primary'
            : 'font-semibold text-primary';
      const Tag = tag;
      return (
        <Tag key={key} className={className}>
          {renderChildren(node.children, ctx)}
        </Tag>
      );
    }
    case 'list': {
      const ordered = node.listType === 'number' || node.tag === 'ol';
      const Tag = ordered ? 'ol' : 'ul';
      return (
        <Tag
          key={key}
          className={`${ordered ? 'list-decimal' : 'list-disc'} space-y-2 pl-6 leading-relaxed text-primary/90 marker:text-accent`}
        >
          {renderChildren(node.children, ctx)}
        </Tag>
      );
    }
    case 'listitem':
      return <li key={key}>{renderChildren(node.children, ctx)}</li>;
    case 'quote':
      return (
        <blockquote key={key} className="border-l-2 border-accent pl-4 italic leading-relaxed text-secondary">
          {renderChildren(node.children, ctx)}
        </blockquote>
      );
    case 'horizontalrule':
      return <hr key={key} className="border-border" />;
    case 'link':
    case 'autolink': {
      const href = safeHref(node.fields?.url);
      const children = renderChildren(node.children, ctx);
      if (!href) return <span key={key}>{children}</span>;
      const newTab = Boolean(node.fields?.newTab);
      return (
        <a
          key={key}
          href={href}
          rel="noopener noreferrer"
          {...(newTab ? { target: '_blank' } : {})}
          className="text-accent underline underline-offset-2 hover:text-accent-hover"
        >
          {children}
        </a>
      );
    }
    case 'upload': {
      const media = node.media;
      if (!media?.url || !media.mimeType?.startsWith('image/')) return null;
      return (
        <figure key={key} className="my-2">
          {/* eslint-disable-next-line @next/next/no-img-element -- картинка из медиатеки CMS, размеры известны */}
          <img
            src={media.url}
            alt={media.alt ?? ''}
            width={media.width}
            height={media.height}
            loading="lazy"
            decoding="async"
            className="h-auto w-full rounded-2xl border border-border"
          />
          {media.alt ? <figcaption className="mt-2 text-center text-sm text-secondary">{media.alt}</figcaption> : null}
        </figure>
      );
    }
    case 'block': {
      const fields = node.fields ?? {};
      if (fields.blockType !== 'video' || !isVideoRef(fields.video)) return null;
      const caption = typeof fields.caption === 'string' && fields.caption.trim() ? fields.caption.trim() : null;
      return (
        <figure key={key} className="my-2">
          <StreamFacade provider={fields.video.provider} videoId={fields.video.videoId} title={caption ?? ctx.title} />
          {caption ? <figcaption className="mt-2 text-center text-sm text-secondary">{caption}</figcaption> : null}
        </figure>
      );
    }
    default:
      return Array.isArray(node.children) ? <span key={key}>{renderChildren(node.children, ctx)}</span> : null;
  }
}

export function RichText({
  value,
  title,
  paragraphClassName = 'leading-relaxed text-primary/90',
}: {
  value: RichTextValue;
  title: string;
  paragraphClassName?: string;
}) {
  return <>{renderChildren(value.root.children, { title, paragraphClassName })}</>;
}

export function ArticleBody({
  body,
  bodyMarkdown,
  title,
}: {
  body?: RichTextValue;
  bodyMarkdown: string;
  title: string;
}) {
  if (body && body.root.children.length > 0) return <RichText value={body} title={title} />;
  return <MarkdownText markdown={bodyMarkdown} />;
}
