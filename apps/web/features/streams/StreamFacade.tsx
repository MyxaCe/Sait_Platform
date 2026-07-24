'use client';

import { useState } from 'react';
import { cn } from '@broker/ui';

/**
 * Фасад видео-стрима (спецификация §7 «Стримы»): сторонний JS
 * YouTube/Vimeo НЕ грузится до клика — на странице только постер
 * и кнопка. Клик → iframe с privacy-доменом.
 */
export interface StreamFacadeProps {
  provider: 'youtube' | 'vimeo';
  videoId: string;
  title: string;
  posterUrl?: string | null;
  className?: string;
}

function embedUrl(provider: 'youtube' | 'vimeo', videoId: string): string {
  return provider === 'youtube'
    ? `https://www.youtube-nocookie.com/embed/${encodeURIComponent(videoId)}?autoplay=1`
    : `https://player.vimeo.com/video/${encodeURIComponent(videoId)}?autoplay=1`;
}

export function StreamFacade({ provider, videoId, title, posterUrl, className }: StreamFacadeProps) {
  const [activated, setActivated] = useState(false);

  return (
    <div
      className={cn(
        'relative aspect-video overflow-hidden rounded-2xl border border-border bg-elevated',
        className,
      )}
    >
      {activated ? (
        <iframe
          src={embedUrl(provider, videoId)}
          title={title}
          allow="autoplay; encrypted-media; picture-in-picture"
          allowFullScreen
          className="absolute inset-0 h-full w-full"
        />
      ) : (
        <button
          type="button"
          onClick={() => setActivated(true)}
          aria-label={title}
          className="group absolute inset-0 flex w-full items-center justify-center"
          style={
            posterUrl
              ? { backgroundImage: `url(${posterUrl})`, backgroundSize: 'cover', backgroundPosition: 'center' }
              : undefined
          }
        >
          <span className="absolute inset-0 bg-gradient-to-br from-royal/40 via-base/60 to-base/80" />
          <span className="relative grid size-16 place-items-center rounded-full bg-accent text-base transition-transform group-hover:scale-110">
            <svg viewBox="0 0 24 24" className="ml-1 size-7 fill-current" aria-hidden>
              <path d="M8 5v14l11-7z" />
            </svg>
          </span>
          <span className="absolute bottom-4 left-4 right-4 truncate text-left text-sm font-medium text-primary">
            {title}
          </span>
        </button>
      )}
    </div>
  );
}
