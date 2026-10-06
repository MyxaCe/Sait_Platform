/**
 * Чтение конфига тенанта: `GET {CMS_API_URL}/cms/sites/{slug}`.
 *
 * ОДНА реализация на витрину и кабинет (Р-029). До выноса здесь лежали
 * две дословные копии, связанные парными тестами: тип расхождение
 * устранил, возможность расхождения кода — нет. Теперь расходиться
 * нечему, а различия потребителей сведены к параметрам вызова (теги
 * ревалидации у витрины, их отсутствие у кабинета).
 *
 * Из одного ответа читаются ТРИ разные вещи, и у каждой своя политика:
 *
 *   access       — граница доступа, fail-closed (`access.ts`);
 *   startBalance — сумма, отказ вместо умолчания (`balance.ts`);
 *   expiry       — срок годности списка от источника (`expiry.ts`).
 *
 * Разбор полей независим: сломанное `instruments` не делает недоступной
 * сумму, и наоборот. Склеить их значило бы снова получить один исход на
 * несколько причин.
 */

import { readAccess, UNAVAILABLE, type TenantAccess, type TenantAccessUnavailableReason } from './access';
import {
  readStartBalance,
  START_BALANCE_UNAVAILABLE,
  type TenantStartBalance,
  type TenantStartBalanceUnavailableReason,
} from './balance';
import { applyListExpiry, readListExpiry, type TenantListExpiry } from './expiry';

export interface TenantConfig {
  readonly access: TenantAccess;
  readonly startBalance: TenantStartBalance;
  /** Что источник сказал о сроке годности списка — для отчётов и тестов;
   *  к `access` он уже применён. */
  readonly expiry: TenantListExpiry;
}

export interface TenantConfigRequest {
  /** `CMS_API_URL`. Пустой или незаданный — `not-configured`, в сеть не идём. */
  readonly baseUrl: string | undefined;
  readonly slug: string;
  readonly apiKey?: string | undefined;
  /**
   * Параметры запроса, специфичные для потребителя: у Next это
   * `next: { revalidate, tags }`. Кеширование — дело вызывающего, решение
   * о доступе — дело этого пакета.
   */
  readonly fetchInit?: RequestInit;
  readonly timeoutMs?: number;
  /** Время решения. Параметром — чтобы истечение срока проверялось без
   *  ожидания в тесте, а не подставлялось из часов внутри функции. */
  readonly now?: () => number;
  readonly onUnavailable?: (reason: TenantAccessUnavailableReason, detail: unknown) => void;
}

/**
 * Недоступность границы — инцидент, а не рутина: фолбэк без алерта это
 * скрытая авария (R-15). `not-configured` сюда сознательно не попадает —
 * ненастроенная CMS это конфигурация контура, и в логе ошибок ей делать
 * нечего; для неё сигнал — отпечаток конфигурации в `/api/health` (B-019).
 */
function defaultReport(reason: TenantAccessUnavailableReason, detail: unknown): void {
  console.error(
    `[tenant] конфиг тенанта недоступен (${reason}) — граница закрыта fail-closed`,
    detail,
  );
}

function both(
  reason: TenantStartBalanceUnavailableReason,
): { access: TenantAccess; startBalance: TenantStartBalance } {
  return { access: UNAVAILABLE[reason], startBalance: START_BALANCE_UNAVAILABLE[reason] };
}

export async function fetchTenantConfig(request: TenantConfigRequest): Promise<TenantConfig> {
  const {
    slug,
    apiKey,
    fetchInit,
    timeoutMs = 3_000,
    now = Date.now,
    onUnavailable = defaultReport,
  } = request;
  const base = request.baseUrl?.replace(/\/$/, '');
  const unnamed: TenantListExpiry = { state: 'unnamed' };

  if (!base) return { ...both('not-configured'), expiry: unnamed };

  try {
    const res = await fetch(`${base}/cms/sites/${slug}`, {
      ...fetchInit,
      headers: apiKey ? { 'X-API-Key': apiKey } : {},
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) {
      onUnavailable('http-error', { slug, status: res.status });
      return { ...both('http-error'), expiry: unnamed };
    }
    const data = (await res.json()) as {
      instruments?: unknown;
      demoStartBalanceCents?: unknown;
    };

    const expiry = readListExpiry(res.headers);
    const parsed = readAccess(data.instruments);
    if (parsed.state === 'unavailable') onUnavailable(parsed.reason, { slug, got: typeof data.instruments });

    // Срок применяется ПОСЛЕ разбора: истечение закрывает полученный
    // список, а не подменяет причину у списка, которого не было.
    const access = applyListExpiry(parsed, expiry, now());
    if (access.state === 'unavailable' && access.reason === 'expired') {
      onUnavailable('expired', { slug, expiresAt: expiry.state === 'named' ? expiry.expiresAt : null });
    }

    return { access, startBalance: readStartBalance(data.demoStartBalanceCents), expiry };
  } catch (error) {
    onUnavailable('network', { slug, error: (error as Error)?.message });
    return { ...both('network'), expiry: unnamed };
  }
}
