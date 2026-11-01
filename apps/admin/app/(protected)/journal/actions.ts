'use server';

import { randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';
import { getOperatorSession } from '@/lib/auth/current';
import { LOGIN_PATH } from '@/lib/auth/constants';
import { appendJournalEntry } from '@/lib/journal/journal';
import { listJournalEntries, loadChainRows, type JournalFilters } from './queries';
import { verifyChain, type ChainResult } from './verify-chain';

/**
 * Серверные экшены журнала (ADM-06). Как и у KYC — server actions, а не новые
 * `/api`-ручки (Р-451 п.3): страница уже за гейтом `(protected)`. Личность и
 * роль берутся из СЕССИИ на сервере, не из аргументов (Р-451): аргумент о
 * роли был бы оракулом. Роль-гейт fail-closed: проверку цепочки и экспорт
 * запускает только `admin`.
 */

export type VerifyChainState =
  | { checked: false }
  | { checked: true; forbidden: true }
  | { checked: true; forbidden: false; result: ChainResult };

/**
 * Проверка целостности цепочки (admin). Это ЧТЕНИЕ — журнал не пишем (иначе
 * каждая проверка меняла бы то, что проверяет). Пересчёт — ровно
 * `computeEntryHash`/`canonicalize` из `lib/journal/journal.ts` (см.
 * `verify-chain.ts`).
 */
export async function verifyChainAction(): Promise<VerifyChainState> {
  const operator = await getOperatorSession();
  if (!operator) redirect(LOGIN_PATH);
  if (operator.role !== 'admin') {
    // Не раскрываем результат не-админу — fail-closed.
    return { checked: true, forbidden: true };
  }

  const rows = await loadChainRows();
  return { checked: true, forbidden: false, result: verifyChain(rows) };
}

export type ExportState =
  | { ok: false; forbidden?: true; error?: string }
  | { ok: true; filename: string; json: string; count: number };

/** Человекочитаемое основание экспорта из объёма и фильтра (Р-049 требует след). */
function buildExportBasis(count: number, filters: JournalFilters, note: string): string {
  const parts: string[] = [];
  if (filters.operatorId) parts.push(`оператор=${filters.operatorId}`);
  if (filters.action) parts.push(`действие=${filters.action}`);
  if (filters.subjectKind) parts.push(`род=${filters.subjectKind}`);
  if (filters.subjectId) parts.push(`субъект=${filters.subjectId}`);
  if (filters.from) parts.push(`с=${filters.from}`);
  if (filters.to) parts.push(`по=${filters.to}`);
  const scope = parts.length > 0 ? parts.join(', ') : 'без фильтра (вся выборка)';
  const trimmedNote = note.trim();
  const noteSuffix = trimmedNote ? ` · ${trimmedNote}` : '';
  return `Экспорт журнала: ${count} записей; фильтр: ${scope}${noteSuffix}`;
}

/**
 * Экспорт выборки (admin). Экспорт САМ journal-able (п.3.10): перед выдачей
 * данных пишем `journal.exported` через `appendJournalEntry` с основанием
 * (объём + фильтр). Доступ к массиву ПД-следов сам оставляет след. Сериализацию
 * возвращаем клиенту — он отдаёт файл на скачивание (новой публичной
 * поверхности не заводим).
 */
export async function exportJournalAction(
  filters: JournalFilters,
  note: string,
): Promise<ExportState> {
  const operator = await getOperatorSession();
  if (!operator) redirect(LOGIN_PATH);
  if (operator.role !== 'admin') {
    return { ok: false, forbidden: true };
  }

  // Экспорт — админский, поэтому выборка без роль-ограничения (admin видит всё).
  const entries = await listJournalEntries({
    role: 'admin',
    selfOperatorId: operator.operatorId,
    filters,
    limit: 100_000,
  });

  const basis = buildExportBasis(entries.length, filters, note);

  // Запись об экспорте ДО выдачи данных: даже если клиент не скачает — факт
  // доступа к выборке зафиксирован (fail-closed след).
  await appendJournalEntry({
    operatorId: operator.operatorId,
    action: 'journal.exported',
    subjectKind: 'journal',
    subjectId: randomUUID(),
    payload: {
      basis,
      filter: {
        operatorId: filters.operatorId ?? null,
        action: filters.action ?? null,
        subjectKind: filters.subjectKind ?? null,
        subjectId: filters.subjectId ?? null,
        from: filters.from ?? null,
        to: filters.to ?? null,
      },
      count: entries.length,
      format: 'json',
    },
  });

  const json = JSON.stringify(
    {
      exportedAt: new Date().toISOString(),
      exportedBy: { operatorId: operator.operatorId, login: operator.login },
      filter: filters,
      count: entries.length,
      entries,
    },
    null,
    2,
  );

  return {
    ok: true,
    filename: `journal-export-${Date.now()}.json`,
    json,
    count: entries.length,
  };
}
