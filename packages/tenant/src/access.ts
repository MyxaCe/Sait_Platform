/**
 * ГРАНИЦА ДОСТУПА тенанта к инструментам (ADR-028, ADR-029).
 *
 * Пакет заведён решением штаба Р-029 и отдельно от `api-client`
 * СОЗНАТЕЛЬНО: `api-client` — про транспорт и схемы ответов, здесь —
 * решение о доступе. Отдельное имя делает видимым, что это граница, а не
 * вспомогательная функция; два потребителя (витрина и кабинет) по
 * критерию PKG-01 означают контракт под надзором штаба, и правка идёт
 * через отчёт.
 *
 * Почему пакет вообще появился. Р-025 устранил расхождение **типом**:
 * `Set | null` заменён размеченным объединением, и одна функция решает,
 * пропускает ли граница. Но в репозитории лежали ДВЕ дословные копии —
 * витрина и кабинет, — связанные парными тестами. Тип убрал расхождение,
 * возможность расхождения кода осталась, а Р-025 именно про неё.
 *
 * Граница различает ТРИ состояния, и ни одно не сводится к другому:
 *
 *   allowed     — список получен и непуст. Разрешено ровно перечисленное.
 *   empty       — список получен и пуст. Не разрешено НИЧЕГО. Это НАСТРОЙКА
 *                 владельца: новый сайт заводится с пустым доступом
 *                 (ADR-028), символы в него кладут из CMS. Не поломка.
 *   unavailable — списка нет либо он больше не действителен. Разрешено
 *                 тоже ничего, но чинится это иначе, чем `empty`, и потому
 *                 обязано быть отличимо (Р-025, п. 2).
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
 *  - **бессрочного last-good нет**: список меняется ровно потому, что
 *    меняются разрешения, и устаревание бьёт по единственному свойству,
 *    ради которого список существует. Ограниченное по времени
 *    переиспользование возможно только со сроком ОТ ИСТОЧНИКА — Р-030,
 *    см. `expiry.ts`;
 *  - **standalone-режима у потребителей нет**. У терминала «нет тенанта →
 *    полный список» законно: `?site=` не задан, юрисдикции нет. Витрина и
 *    кабинет — всегда сторона конкретного тенанта, и незаданный
 *    `CMS_API_URL` означает не «тенанта нет», а «мы не смогли узнать его
 *    разрешения».
 */

/** Почему списка нет. Пять причин, и чинятся они по-разному. */
export type TenantAccessUnavailableReason =
  /** `CMS_API_URL` не задан — потребитель знает заранее, в сеть не ходит.
   *  Видно в отпечатке конфигурации `/api/health` (B-019). */
  | 'not-configured'
  /** CMS ответила не-2xx: жива, но конфиг тенанта не отдала. */
  | 'http-error'
  /** Соединение отклонено, таймаут, мусор вместо JSON — узнали по факту. */
  | 'network'
  /** CMS ответила 2xx, но поля `instruments[]` в ответе нет либо оно не
   *  массив. Источник ничего не сказал — это не пустой список. */
  | 'malformed'
  /** Список получен, но срок его годности — названный ИСТОЧНИКОМ — истёк
   *  (Р-030). Отдельная причина, а не `network`: сеть цела, CMS жива,
   *  просто разрешениям этого возраста верить нельзя. */
  | 'expired';

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

export const UNAVAILABLE: Readonly<Record<TenantAccessUnavailableReason, TenantAccess>> = {
  'not-configured': { state: 'unavailable', reason: 'not-configured' },
  'http-error': { state: 'unavailable', reason: 'http-error' },
  network: { state: 'unavailable', reason: 'network' },
  malformed: { state: 'unavailable', reason: 'malformed' },
  expired: { state: 'unavailable', reason: 'expired' },
};

/**
 * ЕДИНСТВЕННОЕ место, где вычисляется «пропускает ли граница символ».
 *
 * Разрешает только `allowed`. `empty` и `unavailable` запрещают всё —
 * в этом и состоит fail-closed. Потребителям запрещено восстанавливать
 * прежнее поведение выражениями вида `!access || access.has(s)`: именно
 * оно и снимало границу.
 *
 * Тест-растяжка (`access.test.ts`) краснеет от мутации «вернуть fail-open
 * на пустом списке» — то есть барьер проверяется снятием самого барьера,
 * а не косвенным следствием.
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
 * объясняется» живёт здесь одно на все страницы всех потребителей: иначе
 * тикер, список и деталка снова разойдутся — ровно так, как разошлись
 * витрина с кабинетом.
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

/**
 * Разбор поля `instruments[]` из ответа конфига тенанта.
 *
 * Чистая функция: сеть, логи и окружение — снаружи. Здесь только
 * «что сказал источник → что это значит».
 */
export function readAccess(instruments: unknown): TenantAccess {
  // Поля нет либо оно не массив — источник ничего не сказал. Это НЕ пустой
  // список: пустой список говорит «ничего не разрешено», молчание источника
  // не говорит ничего.
  if (!Array.isArray(instruments)) return UNAVAILABLE.malformed;
  if (instruments.length === 0) return { state: 'empty' };
  return { state: 'allowed', symbols: new Set(instruments.map(String)) };
}
