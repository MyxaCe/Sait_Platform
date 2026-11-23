'use client';

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { OnboardingLabels, OnboardingStep } from '@broker/api-client';
import { cn } from '@broker/ui';
import { highlightBox, nextAvailable, placeCard, stepLabel, type Box, type CardPlacement } from './geometry';
import type { TourStatus } from '@/lib/onboarding/state';

export interface TourProps {
  steps: OnboardingStep[];
  labels: OnboardingLabels;
  /** Элемент шага на экране или null — тогда шаг пропускается. */
  resolve: (anchor: string) => HTMLElement | null;
  /** `shown` — был ли показан хоть один шаг (иначе отметку не сохраняем). */
  onClose: (status: TourStatus, shown: boolean) => void;
}

function boxOf(el: HTMLElement): Box {
  const r = el.getBoundingClientRect();
  return { top: r.top, left: r.left, width: r.width, height: r.height };
}

function reducedMotion(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Пошаговая подсказка: затемнение, подсветка одного элемента, карточка с текстом
 * и кнопками «Назад» / «Далее» / «Пропустить». Esc — пропустить, стрелки — листать.
 * Без сторонних библиотек и без :has()/popover/svh — работает в Chrome 104 (ТД-001).
 */
export function Tour({ steps, labels, resolve, onClose }: TourProps) {
  const titleId = useId();
  const bodyId = useId();
  const cardRef = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(() => nextAvailable(0, 1, steps.length, (i) => resolve(steps[i]!.anchor) !== null));
  const [target, setTarget] = useState<Box | null>(null);
  const [placement, setPlacement] = useState<CardPlacement>({ mode: 'sheet' });
  const restoreFocus = useRef<Element | null>(null);
  const shown = useRef(false);

  const available = useCallback((i: number) => resolve(steps[i]!.anchor) !== null, [resolve, steps]);
  const total = steps.length;

  const finish = useCallback(
    (status: TourStatus) => {
      const back = restoreFocus.current;
      onClose(status, shown.current);
      if (back instanceof HTMLElement) back.focus();
    },
    [onClose],
  );

  useEffect(() => {
    restoreFocus.current = document.activeElement;
  }, []);

  useEffect(() => {
    if (index === -1) finish('done');
  }, [index, finish]);

  const measure = useCallback(() => {
    if (index < 0) return;
    const el = resolve(steps[index]!.anchor);
    if (!el) return;
    const box = boxOf(el);
    const vp = { width: window.innerWidth, height: window.innerHeight };
    setTarget(highlightBox(box, vp));
    setPlacement(placeCard(box, vp, cardRef.current?.offsetHeight ?? 180));
  }, [index, resolve, steps]);

  useLayoutEffect(() => {
    if (index < 0) return;
    const el = resolve(steps[index]!.anchor);
    if (!el) {
      const next = nextAvailable(index + 1, 1, total, available);
      setIndex(next);
      return;
    }
    shown.current = true;
    el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: reducedMotion() ? 'auto' : 'smooth' });
    measure();
    cardRef.current?.focus();
  }, [index, resolve, steps, total, available, measure]);

  useEffect(() => {
    let frame = 0;
    const onChange = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };
    window.addEventListener('resize', onChange);
    window.addEventListener('scroll', onChange, true);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', onChange);
      window.removeEventListener('scroll', onChange, true);
    };
  }, [measure]);

  const go = useCallback(
    (dir: 1 | -1) => {
      const next = nextAvailable(index + dir, dir, total, available);
      if (next === -1) {
        if (dir === 1) finish('done');
        return;
      }
      setIndex(next);
    },
    [index, total, available, finish],
  );

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        finish('skipped');
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        go(1);
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault();
        go(-1);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go, finish]);

  if (index < 0) return null;
  const step = steps[index]!;
  const isLast = nextAvailable(index + 1, 1, total, available) === -1;
  const isFirst = nextAvailable(index - 1, -1, total, available) === -1;
  const motion = 'motion-safe:transition-all motion-safe:duration-200';

  return (
    <div className="fixed inset-0 z-[1000]" data-tour-overlay="">
      <div className="absolute inset-0" aria-hidden onClick={(e) => e.stopPropagation()} />
      {target ? (
        <div
          aria-hidden
          className={cn('pointer-events-none fixed rounded-[10px] ring-2 ring-accent', motion)}
          style={{
            top: target.top,
            left: target.left,
            width: target.width,
            height: target.height,
            boxShadow: '0 0 0 9999px rgba(0, 0, 0, 0.6)',
          }}
        />
      ) : (
        <div aria-hidden className="absolute inset-0 bg-black/60" />
      )}
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        tabIndex={-1}
        className={cn(
          'fixed border border-border bg-elevated p-4 text-primary shadow-xl outline-none',
          placement.mode === 'sheet'
            ? 'inset-x-0 bottom-0 rounded-t-2xl pb-[calc(1rem+env(safe-area-inset-bottom))]'
            : 'w-[340px] max-w-[calc(100vw-24px)] rounded-2xl',
          motion,
        )}
        style={placement.mode === 'float' ? { top: placement.top, left: placement.left } : undefined}
      >
        <p className="text-xs text-muted">{stepLabel(labels.stepOf, index + 1, total)}</p>
        <h2 id={titleId} className="mt-1 text-base font-semibold">
          {step.title}
        </h2>
        <p id={bodyId} className="mt-1.5 whitespace-pre-line text-sm leading-relaxed text-secondary">
          {step.body}
        </p>
        <div className="mt-4 flex items-center gap-2">
          <button
            type="button"
            onClick={() => finish('skipped')}
            className="mr-auto min-h-[40px] rounded-lg px-2 text-sm text-secondary hover:text-primary"
          >
            {labels.skip}
          </button>
          <button
            type="button"
            onClick={() => go(-1)}
            disabled={isFirst}
            className="min-h-[40px] rounded-lg border border-border px-3 text-sm disabled:opacity-40"
          >
            {labels.back}
          </button>
          <button
            type="button"
            onClick={() => (isLast ? finish('done') : go(1))}
            className="min-h-[40px] rounded-lg bg-accent px-4 text-sm font-medium text-on-accent hover:bg-accent-hover"
          >
            {isLast ? labels.done : labels.next}
          </button>
        </div>
      </div>
    </div>
  );
}
