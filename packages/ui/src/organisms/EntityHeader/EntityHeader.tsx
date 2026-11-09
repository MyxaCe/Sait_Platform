import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';

/**
 * Шапка карточки сущности (концепция §6.12) — клиент, оператор, заявка.
 * Слева: монограмма → имя + статус-бейджи → строка метаданных (email · UID ·
 * id с копированием). Справа: действия. Под шапкой — `facts`: ряд ключевых
 * цифр (баланс, equity, депозиты…), чтобы ответ на «кто это и что с ним»
 * был виден без прокрутки.
 *
 * Тон `negative` — сущность ограничена (заблокирована): красная полоса слева
 * у всей шапки, причина — в Callout сразу под ней (рисует потребитель).
 */
export interface EntityFact {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
}

export interface EntityHeaderProps {
  title: ReactNode;
  /** Инициалы/монограмма; по умолчанию — первые буквы `initialsFrom`. */
  initialsFrom?: string;
  badges?: ReactNode;
  /** Элементы строки метаданных; разделяются точкой. */
  meta?: ReactNode[];
  actions?: ReactNode;
  facts?: EntityFact[];
  tone?: 'default' | 'negative';
  className?: string;
}

export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const letters = parts.length >= 2 ? [parts[0]![0], parts[1]![0]] : [parts[0]?.[0], parts[0]?.[1]];
  return letters.filter(Boolean).join('').toUpperCase();
}

export function EntityHeader({
  title,
  initialsFrom,
  badges,
  meta,
  actions,
  facts,
  tone = 'default',
  className,
}: EntityHeaderProps) {
  return (
    <section
      className={cn(
        'bg-card relative overflow-hidden rounded-lg border',
        tone === 'negative' ? 'border-negative/30' : 'border-border',
        className,
      )}
    >
      {tone === 'negative' ? (
        <span aria-hidden className="bg-negative absolute inset-y-0 left-0 w-1" />
      ) : null}
      <div className="flex flex-wrap items-start justify-between gap-4 px-5 py-4 lg:flex-nowrap">
        <div className="flex min-w-0 flex-1 items-start gap-4">
          {initialsFrom ? (
            <span
              aria-hidden
              className="bg-accent/15 text-accent ring-accent/30 flex size-12 shrink-0 items-center justify-center rounded-lg text-[15px] font-semibold ring-1 ring-inset"
            >
              {initialsOf(initialsFrom)}
            </span>
          ) : null}
          <div className="min-w-0 space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-primary text-xl font-semibold tracking-tight">{title}</h1>
              {badges}
            </div>
            {meta && meta.length > 0 ? (
              <p className="text-secondary flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                {meta.map((m, i) => (
                  <span key={i} className="inline-flex items-center gap-2">
                    {i > 0 ? (
                      <span aria-hidden className="text-muted">
                        ·
                      </span>
                    ) : null}
                    {m}
                  </span>
                ))}
              </p>
            ) : null}
          </div>
        </div>
        {actions ? (
          <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
        ) : null}
      </div>
      {facts && facts.length > 0 ? (
        <dl
          className="border-border grid border-t sm:grid-cols-2 lg:[grid-template-columns:repeat(var(--facts),minmax(0,1fr))]"
          style={{ ['--facts' as string]: facts.length }}
        >
          {facts.map((f, i) => (
            <div
              key={f.label}
              className={cn(
                'min-w-0 px-5 py-3',
                i > 0 && 'border-border border-t sm:border-t-0 lg:border-l',
              )}
            >
              <dt className="text-muted text-xs">{f.label}</dt>
              <dd className="text-primary mt-0.5 truncate text-lg font-semibold tabular-nums tracking-tight">
                {f.value}
              </dd>
              {f.hint ? <dd className="text-muted truncate text-xs">{f.hint}</dd> : null}
            </div>
          ))}
        </dl>
      ) : null}
    </section>
  );
}
