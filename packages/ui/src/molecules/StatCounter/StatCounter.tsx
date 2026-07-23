'use client';

import { useEffect, useRef, useState } from 'react';
import { cn } from '../../lib/cn';

export interface StatCounterProps {
  value: number;
  label: string;
  suffix?: string;
  prefix?: string;
  durationMs?: number;
  className?: string;
}

/**
 * Анимированный счётчик: запускается один раз при появлении во вьюпорте,
 * уважает prefers-reduced-motion (показывает значение сразу).
 */
export function StatCounter({
  value,
  label,
  suffix = '',
  prefix = '',
  durationMs = 1600,
  className,
}: StatCounterProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [display, setDisplay] = useState(0);
  const started = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduceMotion) {
      setDisplay(value);
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting || started.current) return;
        started.current = true;
        const start = performance.now();
        const tick = (now: number) => {
          const progress = Math.min((now - start) / durationMs, 1);
          // easeOutExpo — быстрый разгон, мягкое торможение
          const eased = progress === 1 ? 1 : 1 - Math.pow(2, -10 * progress);
          setDisplay(Math.round(value * eased));
          if (progress < 1) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
        observer.disconnect();
      },
      { threshold: 0.4 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [value, durationMs]);

  return (
    <div ref={ref} className={cn('flex flex-col gap-1', className)}>
      <dt className="order-2 text-sm text-secondary">{label}</dt>
      <dd className="order-1 text-2xl font-semibold tabular-nums text-primary sm:text-3xl">
        {prefix}
        {display.toLocaleString('ru-RU')}
        {suffix}
      </dd>
    </div>
  );
}
