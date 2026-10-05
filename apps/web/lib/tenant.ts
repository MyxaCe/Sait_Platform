/**
 * Доступ сайта к инструментам — allow-list с карточки сайта в CMS
 * (конфиг тенанта `GET {CMS_API_URL}/cms/sites/{slug}`). Это ГРАНИЦА
 * ДОСТУПА (ADR-028), заведённая ради регуляторики, и с решения штаба
 * Р-025 она **fail-closed** — см. ADR-029 и `_brain/КОНТРАКТЫ.md` §4б.
 *
 * Граница различает ТРИ состояния, и ни одно не сводится к другому:
 *
 *   allowed     — список получен и непуст. Разрешено ровно перечисленное.
 *   empty       — список получен и пуст. Не разрешено НИЧЕГО. Это НАСТРОЙКА
 *                 владельца: новый сайт заводится с пустым доступом
 *                 (ADR-028), символы в него кладут из CMS. Не поломка и не
 *                 «временная пустота, которую надо обойти».
 *   unavailable — списка нет вовсе: переменная не задана, CMS не ответила,
 *                 ответила не-2xx или ответила без поля `instruments[]`.
 *                 Разрешено тоже ничего, но чинится это иначе, чем `empty`,
 *                 и потому обязано быть отличимо (Р-025, п. 2).
 *
 * Чего здесь сознательно НЕТ и почему:
 *
 *  - **пустой список не значит «разрешено всё»**. Так было до Р-025
 *    (`length === 0 → null → фильтр не применяется`), и это превращало
 *    отказ соседа в разрешение — худший исход для регуляторного фильтра:
 *    цена платится не нами (КОНТРАКТЫ.md §4б);
 *  - **отсутствующее или нестроковое `instruments` не значит «пусто»**.
 *    Известно только «источник ничего не сказал» — это
 *    `unavailable: 'malformed'`. Умолчание — утверждение о том, чего мы
 *    не знаем;
 *  - **last-good и бессрочного кеша нет**: список меняется ровно потому,
 *    что меняются разрешения, и устаревание бьёт по единственному
 *    свойству, ради которого список существует;
 *  - **standalone-режима у сайта нет**. У терминала «нет тенанта → полный
 *    список» законно: `?site=` не задан, юрисдикции нет. Сайт — всегда
 *    витрина конкретного тенанта, и незаданный `CMS_API_URL` означает не
 *    «тенанта нет», а «мы не смогли узнать его разрешения».
 *
 * Инвалидация — вебхук карточки сайта (тег `cms:brand[:slug]`).
 */

/** Почему списка нет. Четыре причины, и чинятся они по-разному. */
export type TenantAccessUnavailableReason =
  /** `CMS_API_URL` не задан — сайт знает заранее, в сеть не ходит. Видно в
   *  отпечатке конфигурации `/api/health` (B-019). */
  | 'not-configured'
  /** CMS ответила не-2xx: жива, но конфиг тенанта не отдала. */
  | 'http-error'
  /** Соединение отклонено, таймаут, мусор вместо JSON — узнали по факту. */
  | 'network'
  /** CMS ответила 2xx, но поля `instruments[]` в ответе нет либо оно не
   *  массив. Источник ничего не сказал — это не пустой список. */
  | 'malformed';

/**
 * Решение границы доступа. Размеченное объединение, а не `Set | null`:
 * `null` был ответом «нет» на три разных вопроса сразу, и каждый
 * потребитель прочитал его по-своему (Р-025). Тип обязан различать
 * причины, иначе вызывающий неизбежно обработает их одинаково.
 */
export type TenantAccess =
  | { readonly state: 'allowed'; readonly symbols: ReadonlySet<string> }
  | { readonly state: 'empty' }
  | { readonly state: 'unavailable'; readonly reason: TenantAccessUnavailableReason };

/**
 * ЕДИНСТВЕННОЕ место, где вычисляется «пропускает ли граница символ».
 *
 * Разрешает только `allowed`. `empty` и `unavailable` запрещают всё —
 * в этом и состоит fail-closed. Потребителям запрещено восстанавливать
 * прежнее поведение выражениями вида `!access || access.has(s)`: именно
 * оно и снимало границу.
 *
 * Тест-растяжка на эту функцию (`tenant.test.ts`) краснеет от мутации
 * «вернуть fail-open на пустом списке» — то есть барьер проверяется
 * снятием самого барьера, а не косвенным следствием.
 */
export function isSymbolAllowed(access: TenantAccess, symbol: string): boolean {
  return access.state === 'allowed' && access.symbols.has(symbol);
}

/** Закрыта ли граница целиком — показывать объяснение вместо списка. */
export function isAccessClosed(access: TenantAccess): boolean {
  return access.state !== 'allowed';
}

/**
 * Какое объяснение показать вместо списка. `null` — граница открыта.
 *
 * Ключи каталога, не тексты (ADR-012). Решение «какое состояние чем
 * объясняется» живёт здесь одно на три страницы: иначе тикер, список и
 * деталка снова разойдутся — ровно так, как разошлись витрина с кабинетом.
 */
export interface AccessNoticeSpec {
  /**
   * Состояние границы как есть — для машинного признака в разметке
   * (`data-access-state`). Передаётся явно, а не выводится из наличия
   * `reason`: умолчание «нет причины → значит пусто» было бы тем самым
   * `?? []`, от которого мы здесь и уходим.
   */
  readonly state: 'empty' | 'unavailable';
  readonly titleKey: 'accessEmptyTitle' | 'accessUnavailableTitle';
  readonly textKey: 'accessEmptyText' | 'accessUnavailableText';
  readonly stripKey: 'accessEmptyStrip' | 'accessUnavailableStrip';
  /** Почему недоступно. У `empty` причины нет: ничего не ломалось. */
  readonly reason?: TenantAccessUnavailableReason;
}

export function accessNotice(access: TenantAccess): AccessNoticeSpec | null {
  switch (access.state) {
    case 'allowed':
      return null;
    case 'empty':
      return {
        state: 'empty',
        titleKey: 'accessEmptyTitle',
        textKey: 'accessEmptyText',
        stripKey: 'accessEmptyStrip',
      };
    case 'unavailable':
      return {
        state: 'unavailable',
        titleKey: 'accessUnavailableTitle',
        textKey: 'accessUnavailableText',
        stripKey: 'accessUnavailableStrip',
        reason: access.reason,
      };
  }
}

const UNAVAILABLE: Record<TenantAccessUnavailableReason, TenantAccess> = {
  'not-configured': { state: 'unavailable', reason: 'not-configured' },
  'http-error': { state: 'unavailable', reason: 'http-error' },
  network: { state: 'unavailable', reason: 'network' },
  malformed: { state: 'unavailable', reason: 'malformed' },
};

/**
 * Недоступность границы — инцидент, а не рутина: фолбэк без алерта это
 * скрытая авария (R-15). `not-configured` сюда сознательно не попадает —
 * ненастроенная CMS это конфигурация контура, и в логе ошибок ей делать
 * нечего (та же граница, что в `lib/cms.ts`); для неё сигнал — отпечаток
 * конфигурации в `/api/health`.
 */
function reportUnavailable(reason: TenantAccessUnavailableReason, detail: unknown): void {
  console.error(
    `[tenant] allow-list недоступен (${reason}) — граница закрыта fail-closed`,
    detail,
  );
}

export async function getTenantAccess(): Promise<TenantAccess> {
  const base = process.env.CMS_API_URL?.replace(/\/$/, '');
  if (!base) return UNAVAILABLE['not-configured'];
  const slug = process.env.SITE_SLUG ?? 'apex-ru';
  try {
    const res = await fetch(`${base}/cms/sites/${slug}`, {
      headers: process.env.CMS_API_KEY ? { 'X-API-Key': process.env.CMS_API_KEY } : {},
      next: { revalidate: 300, tags: ['cms:brand', `cms:brand:${slug}`] },
      signal: AbortSignal.timeout(3_000),
    });
    if (!res.ok) {
      reportUnavailable('http-error', { slug, status: res.status });
      return UNAVAILABLE['http-error'];
    }
    const data = (await res.json()) as { instruments?: unknown };
    // Поля нет либо оно не массив — источник ничего не сказал. Это НЕ пустой
    // список: пустой список говорит «ничего не разрешено», молчание источника
    // не говорит ничего.
    if (!Array.isArray(data.instruments)) {
      reportUnavailable('malformed', { slug, got: typeof data.instruments });
      return UNAVAILABLE.malformed;
    }
    if (data.instruments.length === 0) return { state: 'empty' };
    return { state: 'allowed', symbols: new Set(data.instruments.map(String)) };
  } catch (error) {
    reportUnavailable('network', { slug, error: (error as Error)?.message });
    return UNAVAILABLE.network;
  }
}
