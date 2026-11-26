import { cn } from '../../lib/cn';

/**
 * Как показывать бренд в шапке (поле CMS «Как показывать бренд в шапке»):
 * - `logo-name` — логотип (или буква-заглушка) и название рядом (по умолчанию, прежнее поведение);
 * - `logo` — только логотип: он уже содержит название (wordmark). Без логотипа — название текстом;
 * - `name` — только название текстом.
 */
export type BrandLogoMode = 'logo-name' | 'logo' | 'name';

export interface BrandMarkLogo {
  url: string;
  width?: number;
  height?: number;
  alt?: string;
}

export interface BrandMarkParts {
  /** Показать картинку логотипа. */
  image: boolean;
  /** Показать букву-заглушку (логотипа нет, режим logo-name). */
  initial: boolean;
  /** Показать название текстом. */
  name: boolean;
}

export function brandMarkParts(mode: BrandLogoMode | null | undefined, hasLogo: boolean): BrandMarkParts {
  switch (mode) {
    case 'name':
      return { image: false, initial: false, name: true };
    case 'logo':
      return hasLogo ? { image: true, initial: false, name: false } : { image: false, initial: false, name: true };
    default:
      return { image: hasLogo, initial: !hasLogo, name: true };
  }
}

export interface BrandMarkProps {
  name: string;
  logo?: BrandMarkLogo | null;
  mode?: BrandLogoMode | null;
  /** Высота логотипа рядом с названием. */
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  /** Дополнительные классы для текста названия (например, скрыть на узких экранах). */
  nameClassName?: string;
}

// Логотип с названием (wordmark) шире и должен быть заметнее, чем значок рядом с текстом.
const ICON_HEIGHT = { sm: 'h-7', md: 'h-8', lg: 'h-9' } as const;
const WORDMARK = {
  sm: 'h-6 max-h-6 max-w-[140px]',
  md: 'h-7 max-h-7 max-w-[180px]',
  lg: 'h-8 max-h-8 max-w-[200px]',
} as const;
const INITIAL = { sm: 'size-7', md: 'size-8', lg: 'size-9' } as const;

export function BrandMark({ name, logo, mode, size = 'md', className, nameClassName }: BrandMarkProps) {
  const parts = brandMarkParts(mode, Boolean(logo?.url));
  const wordmark = mode === 'logo' && parts.image;
  return (
    <span className={cn('inline-flex min-w-0 items-center gap-2', className)}>
      {parts.image && logo ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={logo.url}
          width={logo.width}
          height={logo.height}
          alt={wordmark ? name : logo.alt || name}
          className={cn('w-auto object-contain', wordmark ? WORDMARK[size] : ICON_HEIGHT[size])}
        />
      ) : null}
      {parts.initial ? (
        <span
          aria-hidden="true"
          className={cn('grid shrink-0 place-items-center rounded-lg bg-accent font-bold text-on-accent', INITIAL[size])}
        >
          {name.charAt(0)}
        </span>
      ) : null}
      {parts.name ? <span className={cn('truncate', nameClassName)}>{name}</span> : null}
    </span>
  );
}
