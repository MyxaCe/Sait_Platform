/**
 * Конфиг тенанта из CMS (карточка сайта, `GET {CMS_API_URL}/cms/sites/{slug}`,
 * под серверным ключом): стартовый демо-баланс и allow-list инструментов.
 * Единый источник для регистрации (стартовый баланс), модуля «Рынки»
 * (allow-list) и demo-reset.
 *
 * Два поля — две РАЗНЫЕ политики при недоступной CMS, и путать их нельзя:
 *
 *  - **стартовый баланс** — демо-деньги, фолбэк $10 000 законен: это
 *    параметр удобства, его умолчание ничего не разрешает;
 *  - **allow-list** — ГРАНИЦА ДОСТУПА (ADR-028), заведённая ради
 *    регуляторики. С решения штаба Р-025 она **fail-closed** (ADR-029,
 *    `_brain/КОНТРАКТЫ.md` §4б): недоступность границы не может означать
 *    разрешение.
 *
 * Тип `TenantAccess` и функция `isSymbolAllowed` ниже — дословная копия
 * `apps/web/lib/tenant.ts`. Расхождение именно этих двух реализаций на
 * одних и тех же данных и было дефектом Р-025 (витрина снимала границу,
 * кабинет прятал модуль). Вынос в общий пакет — запрос к штабу, пакеты
 * одна команда не меняет; до тех пор обе копии закреплены парными
 * тестами (`apps/web/lib/tenant.test.ts`, `apps/cabinet/lib/tenant.test.ts`),
 * и любое расхождение красит тест в одном из приложений.
 */

const DEFAULT_START_BALANCE_CENTS = 1_000_000; // $10 000

/** Почему списка нет. Четыре причины, и чинятся они по-разному. */
export type TenantAccessUnavailableReason =
  /** `CMS_API_URL` не задан — кабинет знает заранее, в сеть не ходит. */
  | 'not-configured'
  /** CMS ответила не-2xx: жива, но конфиг тенанта не отдала. */
  | 'http-error'
  /** Соединение отклонено, таймаут, мусор вместо JSON — узнали по факту. */
  | 'network'
  /** CMS ответила 2xx, но поля `instruments[]` нет либо оно не массив.
   *  Источник ничего не сказал — это не пустой список. */
  | 'malformed';

/**
 * Решение границы доступа. Размеченное объединение, а не `Set | null`:
 * `null` был ответом «нет» на три разных вопроса сразу, и каждый
 * потребитель прочитал его по-своему (Р-025).
 */
export type TenantAccess =
  | { readonly state: 'allowed'; readonly symbols: ReadonlySet<string> }
  | { readonly state: 'empty' }
  | { readonly state: 'unavailable'; readonly reason: TenantAccessUnavailableReason };

/**
 * ЕДИНСТВЕННОЕ место, где вычисляется «пропускает ли граница символ».
 * Разрешает только `allowed`; `empty` и `unavailable` запрещают всё.
 * Прежнее `new Set([])` давало тот же запрет случайно — как побочное
 * свойство пустого множества, а не как решение; теперь это решение.
 */
export function isSymbolAllowed(access: TenantAccess, symbol: string): boolean {
  return access.state === 'allowed' && access.symbols.has(symbol);
}

export interface TenantConfig {
  demoStartBalanceCents: number;
  /** Граница доступа к инструментам — три состояния, fail-closed (Р-025). */
  access: TenantAccess;
}

const UNAVAILABLE: Record<TenantAccessUnavailableReason, TenantAccess> = {
  'not-configured': { state: 'unavailable', reason: 'not-configured' },
  'http-error': { state: 'unavailable', reason: 'http-error' },
  network: { state: 'unavailable', reason: 'network' },
  malformed: { state: 'unavailable', reason: 'malformed' },
};

/**
 * Недоступность границы — инцидент, а не рутина: фолбэк без алерта это
 * скрытая авария (R-15). `not-configured` сознательно не логируется —
 * это конфигурация контура, а не происшествие.
 */
function reportUnavailable(reason: TenantAccessUnavailableReason, detail: unknown): void {
  console.error(
    `[tenant] allow-list недоступен (${reason}) — граница закрыта fail-closed`,
    detail,
  );
}

export async function getTenantConfig(): Promise<TenantConfig> {
  const base = process.env.CMS_API_URL?.replace(/\/$/, '');
  const slug = process.env.SITE_SLUG ?? 'apex-ru';
  if (!base) {
    return {
      demoStartBalanceCents: DEFAULT_START_BALANCE_CENTS,
      access: UNAVAILABLE['not-configured'],
    };
  }
  try {
    const res = await fetch(`${base}/cms/sites/${slug}`, {
      headers: process.env.CMS_API_KEY ? { 'X-API-Key': process.env.CMS_API_KEY } : {},
      next: { revalidate: 300 },
      signal: AbortSignal.timeout(3_000),
    });
    if (!res.ok) {
      reportUnavailable('http-error', { slug, status: res.status });
      return {
        demoStartBalanceCents: DEFAULT_START_BALANCE_CENTS,
        access: UNAVAILABLE['http-error'],
      };
    }
    const data = (await res.json()) as { demoStartBalanceCents?: unknown; instruments?: unknown };
    const cents = Number(data.demoStartBalanceCents);
    const demoStartBalanceCents =
      Number.isFinite(cents) && cents > 0 ? cents : DEFAULT_START_BALANCE_CENTS;
    // Поля нет либо оно не массив — источник ничего не сказал. Это НЕ
    // пустой список, и подменять одно другим нельзя.
    if (!Array.isArray(data.instruments)) {
      reportUnavailable('malformed', { slug, got: typeof data.instruments });
      return { demoStartBalanceCents, access: UNAVAILABLE.malformed };
    }
    return {
      demoStartBalanceCents,
      access:
        data.instruments.length === 0
          ? { state: 'empty' }
          : { state: 'allowed', symbols: new Set(data.instruments.map(String)) },
    };
  } catch (error) {
    reportUnavailable('network', { slug, error: (error as Error)?.message });
    return { demoStartBalanceCents: DEFAULT_START_BALANCE_CENTS, access: UNAVAILABLE.network };
  }
}

/** Стартовый демо-баланс тенанта (центы); фолбэк — $10 000. */
export async function getTenantStartBalanceCents(): Promise<number> {
  return (await getTenantConfig()).demoStartBalanceCents;
}
