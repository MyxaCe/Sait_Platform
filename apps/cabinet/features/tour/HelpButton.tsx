'use client';

import { cn } from '@broker/ui';
import { useTour } from './TourProvider';

/** Круглая кнопка «?»: запускает экскурсию по текущей части. Без текстов из CMS не видна. */
export function HelpButton({ className }: { className?: string }) {
  const tour = useTour();
  if (!tour) return null;
  return (
    <button
      type="button"
      data-tour="help"
      onClick={tour.start}
      aria-label={tour.labels.help}
      title={tour.labels.help}
      className={cn(
        'grid size-9 shrink-0 place-items-center rounded-full border border-border text-base font-semibold text-secondary transition-colors hover:border-accent hover:text-accent',
        className,
      )}
    >
      <span aria-hidden>?</span>
    </button>
  );
}
