'use client';

import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import { realtime, useConnectionStatus, useQuotesStore } from '@broker/realtime';
import { collect, createCollector, drawable } from './collector';
import { backdropMode, backdropProfile } from './mode';
import {
  bandFor,
  easeSpan,
  projectSeries,
  targetSpan,
  trimSeries,
  visibleSamples,
  type Span,
} from './series';

const collector = createCollector();

const STILL_REPAINT_MS = 60_000;
const TAIL_MS = 15_000;
const MAX_DPR = 2;
const FRAME_SLACK_MS = 4;

const TONE = {
  primaryAlpha: 0.34,
  secondaryAlpha: 0.2,
  lineWidth: 1.25,
  fadeFrom: 0.45,
  fadeTo: 0.65,
  compactAlpha: 0.45,
};

function useMedia(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const list = window.matchMedia(query);
      list.addEventListener('change', onChange);
      return () => list.removeEventListener('change', onChange);
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false,
  );
}

function readChannels(style: CSSStyleDeclaration, name: string): [number, number, number] | null {
  const parts = style
    .getPropertyValue(name)
    .trim()
    .split(/[\s,/]+/)
    .slice(0, 3)
    .map(Number);
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return null;
  return [parts[0]!, parts[1]!, parts[2]!];
}

function rgba([r, g, b]: [number, number, number], alpha: number): string {
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function QuoteLinesCanvas({ symbols }: { symbols: string[] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const status = useConnectionStatus();
  const reducedMotion = useMedia('(prefers-reduced-motion: reduce)');
  const compact = useMedia('(max-width: 767px)');
  const profile = backdropProfile(compact);
  const lineSymbols = symbols.slice(0, profile.maxLines);
  const key = lineSymbols.join(',');
  const mode = backdropMode({
    setting: 'quotes',
    feedStatus: status,
    symbols: lineSymbols,
    reducedMotion,
  });

  useEffect(() => {
    const list = key.split(',').filter(Boolean);
    if (list.length === 0) return;
    realtime.connect();
    const unsubscribe = realtime.subscribe(list);
    const take = (state: ReturnType<typeof useQuotesStore.getState>) => {
      collect(collector, state.status, state.quotes, list, Date.now());
    };
    take(useQuotesStore.getState());
    const unlisten = useQuotesStore.subscribe(take);
    return () => {
      unlisten();
      unsubscribe();
    };
  }, [key]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const list = key.split(',').filter(Boolean);
    const spans = new Map<string, Span>();
    let width = 0;
    let height = 0;
    let primary: [number, number, number] | null = null;
    let secondary: [number, number, number] | null = null;
    let raf = 0;
    let lastFrame = 0;
    let onScreen = true;
    let timer: ReturnType<typeof setInterval> | undefined;
    const interval = 1000 / profile.fps;

    const readColors = () => {
      const style = getComputedStyle(document.documentElement);
      primary = readChannels(style, '--accent');
      secondary = readChannels(style, '--text-secondary');
    };

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
      width = rect.width;
      height = rect.height;
      canvas.width = Math.max(1, Math.round(width * dpr));
      canvas.height = Math.max(1, Math.round(height * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const stroke = (color: [number, number, number], alpha: number) => {
      const scaled = compact ? alpha * TONE.compactAlpha : alpha;
      if (compact) return rgba(color, scaled);
      const gradient = ctx.createLinearGradient(0, 0, width, 0);
      gradient.addColorStop(0, rgba(color, 0));
      gradient.addColorStop(TONE.fadeFrom, rgba(color, scaled * 0.35));
      gradient.addColorStop(TONE.fadeTo, rgba(color, scaled));
      gradient.addColorStop(1, rgba(color, scaled));
      return gradient;
    };

    const draw = (ease: number) => {
      ctx.clearRect(0, 0, width, height);
      if (mode === 'grid' || mode === 'off' || !primary || !secondary) return;
      const now = Date.now();
      const feed = useQuotesStore.getState().status;
      for (const { symbol, series } of drawable(collector, feed, list)) {
        trimSeries(series, now, profile.windowMs);
        const samples = visibleSamples(series, now, profile.windowMs);
        const target = targetSpan(samples);
        if (!target) continue;
        const span = easeSpan(spans.get(symbol) ?? null, target, ease);
        spans.set(symbol, span);
        const index = list.indexOf(symbol);
        const band = bandFor(index, list.length, height);
        const points = projectSeries(samples, {
          now,
          windowMs: profile.windowMs,
          width,
          band,
          span,
          tailMs: TAIL_MS,
        });
        if (points.length < 4) continue;
        const isPrimary = index === 0;
        const color = isPrimary ? primary : secondary;
        ctx.beginPath();
        ctx.moveTo(points[0]!, points[1]!);
        for (let i = 2; i < points.length - 2; i += 2) {
          const mx = (points[i]! + points[i + 2]!) / 2;
          const my = (points[i + 1]! + points[i + 3]!) / 2;
          ctx.quadraticCurveTo(points[i]!, points[i + 1]!, mx, my);
        }
        ctx.lineTo(points[points.length - 2]!, points[points.length - 1]!);
        ctx.lineWidth = compact ? 1 : TONE.lineWidth;
        ctx.lineJoin = 'round';
        ctx.strokeStyle = stroke(color, isPrimary ? TONE.primaryAlpha : TONE.secondaryAlpha);
        ctx.stroke();
      }
    };

    const frame = (time: number) => {
      raf = requestAnimationFrame(frame);
      if (time - lastFrame < interval - FRAME_SLACK_MS) return;
      lastFrame = time;
      draw(0.08);
    };

    const stop = () => {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    };

    const start = () => {
      if (mode !== 'flow' || raf || !onScreen || document.hidden) return;
      raf = requestAnimationFrame(frame);
    };

    const sync = () => {
      if (onScreen && !document.hidden) start();
      else stop();
    };

    readColors();
    resize();
    draw(1);

    const resizeObserver = new ResizeObserver(() => {
      resize();
      draw(1);
    });
    resizeObserver.observe(canvas);

    const themeObserver = new MutationObserver(() => {
      readColors();
      draw(1);
    });
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme', 'class', 'style'],
    });

    const intersection = new IntersectionObserver((entries) => {
      onScreen = entries.some((entry) => entry.isIntersecting);
      sync();
    });
    intersection.observe(canvas);

    document.addEventListener('visibilitychange', sync);
    if (mode === 'still') timer = setInterval(() => draw(1), STILL_REPAINT_MS);
    start();

    return () => {
      stop();
      if (timer) clearInterval(timer);
      resizeObserver.disconnect();
      themeObserver.disconnect();
      intersection.disconnect();
      document.removeEventListener('visibilitychange', sync);
    };
  }, [key, mode, compact, profile.fps, profile.windowMs]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className="pointer-events-none absolute inset-0 h-full w-full select-none"
    />
  );
}
