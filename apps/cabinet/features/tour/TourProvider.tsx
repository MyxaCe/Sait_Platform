'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { OnboardingLabels, OnboardingPart, OnboardingPartConfig } from '@broker/api-client';
import { usePathname } from '@/i18n/navigation';
import { anchorSelectors } from '@/lib/onboarding/anchors';
import { saveTourResultAction } from '@/lib/onboarding/actions';
import type { TourStatus } from '@/lib/onboarding/state';
import { firstVisible } from './geometry';
import { Tour } from './Tour';

interface TourContextValue {
  labels: OnboardingLabels;
  part: OnboardingPartConfig;
  start: () => void;
}

const TourContext = createContext<TourContextValue | null>(null);

export function useTour(): TourContextValue | null {
  return useContext(TourContext);
}

export interface TourProviderProps {
  part: OnboardingPartConfig | null;
  labels: OnboardingLabels | null;
  /** Показать один раз сам (новичок, часть не видена). */
  autostart: boolean;
  /** Где хранить отметку: в базе (клиент вошёл) или в браузере (регистрация). */
  persist: 'server' | 'local';
  /** Сама часть открывается только на этой странице (у кабинета — главная). */
  autostartPath?: string;
  children: ReactNode;
}

export const LOCAL_KEY = 'onboarding.tour';

export function readLocalMark(part: OnboardingPart): number {
  try {
    const raw = JSON.parse(window.localStorage.getItem(LOCAL_KEY) ?? '{}') as Record<string, { v?: number }>;
    return typeof raw[part]?.v === 'number' ? raw[part]!.v! : 0;
  } catch {
    return 0;
  }
}

function writeLocalMark(part: OnboardingPart, version: number, status: TourStatus): void {
  try {
    const raw = JSON.parse(window.localStorage.getItem(LOCAL_KEY) ?? '{}') as Record<string, unknown>;
    raw[part] = { v: version, s: status };
    window.localStorage.setItem(LOCAL_KEY, JSON.stringify(raw));
  } catch {
    /* приватный режим без localStorage — отметка не сохранится, это не ошибка */
  }
}

function resolveAnchor(anchor: string): HTMLElement | null {
  return firstVisible(anchorSelectors(anchor));
}

/**
 * Экскурсия одной части на странице кабинета. Без текстов из CMS (или с
 * выключенным флагом) ничего не рендерит и кнопку «?» не показывает.
 */
export function TourProvider({ part, labels, autostart, persist, autostartPath, children }: TourProviderProps) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const onAutostartPage = autostartPath === undefined || pathname === autostartPath;
  const autoDone = useRef(false);
  const start = useCallback(() => setOpen(true), []);

  useEffect(() => {
    if (!part || !onAutostartPage || autoDone.current) return;
    if (persist === 'local' ? readLocalMark(part.part) < part.version : autostart) {
      const timer = window.setTimeout(() => {
        autoDone.current = true;
        setOpen(true);
      }, 400);
      return () => window.clearTimeout(timer);
    }
    return undefined;
  }, [part, autostart, persist, onAutostartPage]);

  const onClose = useCallback(
    (status: TourStatus, shown: boolean) => {
      setOpen(false);
      if (!part || !shown) return;
      if (persist === 'local') writeLocalMark(part.part, part.version, status);
      else void saveTourResultAction(part.part, part.version, status);
    },
    [part, persist],
  );

  const value = useMemo(() => (part && labels ? { part, labels, start } : null), [part, labels, start]);

  return (
    <TourContext.Provider value={value}>
      {children}
      {open && value ? <Tour steps={value.part.steps} labels={value.labels} resolve={resolveAnchor} onClose={onClose} /> : null}
    </TourContext.Provider>
  );
}
