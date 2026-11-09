'use client';

import { Fragment, useState } from 'react';
import Link from 'next/link';
import { CopyButton, Mono, cn, type StatusTone } from '@broker/ui';
import { ToneMark } from '@/components/control/ToneMark';

/**
 * Лента журнала (ADM-06, концепция §6.1/§6.13) — плотная таблица записей с
 * раскрытием. Строка отвечает «что, над кем, кто, когда, на каком основании»
 * человеческим языком; раскрытие — доказательная часть: точное время UTC,
 * код действия, полный payload и звенья хеш-цепочки (entry_hash ← prev_hash).
 *
 * Чистое отображение: строки уже отобраны по роли и отформатированы на
 * сервере (даты — серверной функцией, чтобы не было рассинхрона часовых
 * поясов при гидрации). Клиентская часть — только раскрытие строки.
 */

export interface JournalViewRow {
  seq: number;
  /** «09.11.2026, 21:43». */
  time: string;
  /** Точное время записи, ISO UTC (как входит в хеш). */
  occurredAt: string;
  action: string;
  label: string;
  tone: StatusTone;
  basis: string | null;
  operatorName: string;
  operatorLogin: string;
  subjectKind: string;
  subjectKindLabel: string;
  subjectId: string;
  subjectName: string | null;
  /** Карточка субъекта (клиент), если есть. */
  subjectHref: string | null;
  /** Все записи по субъекту. */
  subjectJournalHref: string;
  payload: Record<string, unknown>;
  entryHash: string;
  prevHash: string | null;
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden
      className={cn('size-4', open && 'rotate-180')}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
    >
      <path d="M4 6l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Subject({ row }: { row: JournalViewRow }) {
  const name = row.subjectName ? (
    row.subjectHref ? (
      <Link
        href={row.subjectHref}
        className="text-primary hover:text-accent block truncate font-medium"
      >
        {row.subjectName}
      </Link>
    ) : (
      <span className="text-primary block truncate">{row.subjectName}</span>
    )
  ) : (
    <Mono value={row.subjectId} middle={6} className="text-secondary block" />
  );
  return (
    <div className="min-w-0">
      {name}
      <span className="text-muted block truncate text-xs">{row.subjectKindLabel}</span>
    </div>
  );
}

function HashLine({ label, value, note }: { label: string; value: string | null; note?: string }) {
  return (
    <div className="space-y-0.5">
      <p className="text-muted text-xs">{label}</p>
      {value ? (
        <p className="flex items-start gap-1.5">
          <span className="text-primary break-all font-mono text-[12px] leading-5">{value}</span>
          <CopyButton value={value} label={label} />
        </p>
      ) : (
        <p className="text-secondary text-[13px]">∅ — первая запись цепочки</p>
      )}
      {note ? <p className="text-positive text-xs">{note}</p> : null}
    </div>
  );
}

function Details({ row, linkNote }: { row: JournalViewRow; linkNote?: string }) {
  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div className="min-w-0 space-y-4">
        <dl className="grid grid-cols-[8.5rem_minmax(0,1fr)] gap-x-3 gap-y-2 text-[13px]">
          <dt className="text-muted text-xs leading-5">Время записи (UTC)</dt>
          <dd className="text-primary font-mono text-[12px] leading-5">{row.occurredAt}</dd>
          <dt className="text-muted text-xs leading-5">Код действия</dt>
          <dd className="text-primary font-mono text-[12px] leading-5">{row.action}</dd>
          <dt className="text-muted text-xs leading-5">Оператор</dt>
          <dd className="text-primary">
            {row.operatorName} <span className="text-muted">({row.operatorLogin})</span>
          </dd>
          <dt className="text-muted text-xs leading-5">Субъект</dt>
          <dd className="min-w-0 space-y-0.5">
            <span className="text-primary block">
              {row.subjectKindLabel}
              {row.subjectName ? ` · ${row.subjectName}` : ''}
            </span>
            <span className="flex items-center gap-1.5">
              <Mono value={row.subjectId} className="text-secondary truncate" />
              <CopyButton value={row.subjectId} label="id субъекта" />
            </span>
            <Link
              href={row.subjectJournalHref}
              className="text-accent text-xs font-medium hover:underline"
            >
              Все записи по этому субъекту →
            </Link>
          </dd>
          {row.basis ? (
            <>
              <dt className="text-muted text-xs leading-5">Основание</dt>
              <dd className="text-primary whitespace-pre-wrap">{row.basis}</dd>
            </>
          ) : null}
        </dl>
        <div className="space-y-2">
          <HashLine label="entry_hash — хеш этой записи" value={row.entryHash} />
          <HashLine
            label="prev_hash — хеш предыдущей записи"
            value={row.prevHash}
            note={linkNote}
          />
        </div>
      </div>
      <div className="min-w-0">
        <p className="text-muted mb-1 text-xs">Содержимое записи (payload)</p>
        <pre className="border-border bg-sunken text-secondary max-h-80 overflow-auto rounded-md border p-3 font-mono text-[12px] leading-5">
          {JSON.stringify(row.payload, null, 2)}
        </pre>
      </div>
    </div>
  );
}

export function JournalFeed({ rows }: { rows: JournalViewRow[] }) {
  const [open, setOpen] = useState<Set<number>>(() => new Set());
  const toggle = (seq: number) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(seq)) next.delete(seq);
      else next.add(seq);
      return next;
    });

  const th = 'text-secondary whitespace-nowrap px-3 py-2 text-left text-xs font-medium';
  const td = 'px-3 py-2.5 align-top';

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-[13px]" aria-label="Записи журнала">
        <thead>
          <tr className="border-border bg-elevated/60 border-b">
            <th scope="col" className={cn(th, 'w-[4.5rem] text-right')}>
              seq
            </th>
            <th scope="col" className={cn(th, 'w-[9.5rem]')}>
              Время
            </th>
            <th scope="col" className={th}>
              Действие и основание
            </th>
            <th scope="col" className={cn(th, 'w-[13rem]')}>
              Субъект
            </th>
            <th scope="col" className={cn(th, 'w-[11rem]')}>
              Оператор
            </th>
            <th scope="col" className={cn(th, 'hidden w-[9.5rem] xl:table-cell')}>
              Хеш записи
            </th>
            <th scope="col" className={cn(th, 'w-10')}>
              <span className="sr-only">Подробности</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => {
            const isOpen = open.has(row.seq);
            const older = rows[i + 1];
            const linkNote =
              older && older.seq === row.seq - 1 && row.prevHash === older.entryHash
                ? `Совпадает с entry_hash записи seq ${older.seq} — звено цепочки на месте.`
                : undefined;
            const detailsId = `journal-row-${row.seq}`;
            return (
              <Fragment key={row.seq}>
                <tr
                  className={cn(
                    'border-border border-b',
                    isOpen ? 'bg-primary/[0.03]' : 'hover:bg-primary/[0.03]',
                  )}
                >
                  <td className={cn(td, 'text-muted text-right font-mono text-[12px] tabular-nums')}>
                    {row.seq}
                  </td>
                  <td className={cn(td, 'text-secondary whitespace-nowrap tabular-nums')}>
                    <span title={row.occurredAt}>{row.time}</span>
                  </td>
                  <td className={cn(td, 'min-w-0')}>
                    <span className="flex items-center gap-2">
                      <ToneMark tone={row.tone} />
                      <span className="text-primary font-medium">{row.label}</span>
                    </span>
                    {row.basis ? (
                      <span className="text-muted mt-0.5 line-clamp-1 pl-4 text-xs">
                        {row.basis}
                      </span>
                    ) : null}
                  </td>
                  <td className={cn(td, 'max-w-[13rem]')}>
                    <Subject row={row} />
                  </td>
                  <td className={cn(td, 'max-w-[11rem]')}>
                    <span className="text-primary block truncate">{row.operatorName}</span>
                    <span className="text-muted block truncate text-xs">{row.operatorLogin}</span>
                  </td>
                  <td className={cn(td, 'hidden xl:table-cell')}>
                    <Mono value={row.entryHash} middle={6} className="text-secondary text-[12px]" />
                  </td>
                  <td className={cn(td, 'py-2 text-right')}>
                    <button
                      type="button"
                      onClick={() => toggle(row.seq)}
                      aria-expanded={isOpen}
                      aria-controls={detailsId}
                      aria-label={`${isOpen ? 'Свернуть' : 'Раскрыть'} запись seq ${row.seq}`}
                      className="text-muted hover:bg-primary/[0.06] hover:text-primary focus-visible:outline-accent inline-flex size-7 items-center justify-center rounded-md focus-visible:outline focus-visible:outline-2"
                    >
                      <Chevron open={isOpen} />
                    </button>
                  </td>
                </tr>
                {isOpen ? (
                  <tr id={detailsId} className="border-border bg-primary/[0.02] border-b">
                    <td />
                    <td colSpan={6} className="px-3 pb-4 pt-2">
                      <Details row={row} linkNote={linkNote} />
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
