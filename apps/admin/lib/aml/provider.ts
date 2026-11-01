import type { AmlOutcome, SanctionsListId } from './lists';

/**
 * Порт автоматического AML-скрининга (ADM-14, Р-454 I-5) — ТОЧКА РАСШИРЕНИЯ.
 *
 * На старте скрининг РУЧНОЙ: оператор сверяет клиента во внешних источниках и
 * фиксирует результат (`screening.ts`). Автоинтеграция с провайдером
 * (ComplyAdvantage / Dow Jones / Sumsub) — ОТДЕЛЬНАЯ будущая задача. Здесь —
 * только контракт порта, по которому её можно будет подключить, НЕ меняя ни
 * транзакционное ядро (`recordAmlScreening`), ни схему: автоматический результат
 * сведётся в тот же `AmlOutcome` и запишется тем же журналом.
 *
 * ЖИВОГО ПРОВАЙДЕРА НЕТ. `resolveAmlProvider()` возвращает `null` — это и есть
 * «ручной режим» явно: вызывающий, увидев `null`, идёт ручным путём. Когда
 * провайдер появится, адаптер реализует `AmlScreeningProvider`, а резолвер
 * начнёт его возвращать (например, по env) — остальной код не изменится.
 */

export type AmlProviderId = 'complyadvantage' | 'dowjones' | 'sumsub';

/**
 * Что провайдер получает на вход. Сейчас минимум (имя); по мере подключения
 * реального провайдера тип расширяется (ДР, гражданство, документы) — порт
 * существует как раз чтобы это расширение не трогало ядро.
 */
export interface AmlScreeningSubject {
  userId: string;
  fullName: string;
}

/** Одно совпадение из провайдерского ответа (форма — на будущее). */
export interface AmlScreeningHit {
  /** Список/источник совпадения. */
  source: SanctionsListId | string;
  /** Степень уверенности 0..1, если провайдер её даёт. */
  score?: number;
  /** Человекочитаемое описание совпадения. */
  detail?: string;
}

export interface AmlScreeningProviderResult {
  outcome: AmlOutcome;
  hits: AmlScreeningHit[];
  /** Идентификатор запроса у провайдера — для аудита/повторной выгрузки. */
  providerRef: string;
}

export interface AmlScreeningProvider {
  readonly id: AmlProviderId;
  screen(subject: AmlScreeningSubject): Promise<AmlScreeningProviderResult>;
}

/**
 * Разрешает активного провайдера автоскрининга или `null`, если его нет.
 *
 * СЕЙЧАС ВСЕГДА `null` (ручной режим, Р-454 I-5): ни один провайдер не
 * подключён сознательно. Это не заглушка-ошибка, а явное «авто нет» — вызывающий
 * трактует `null` как «сводит оператор вручную». Будущая задача вернёт здесь
 * настоящий адаптер.
 */
export function resolveAmlProvider(): AmlScreeningProvider | null {
  return null;
}
