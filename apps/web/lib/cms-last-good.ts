import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * Последний удачный ответ CMS — на диске (решение владельца 10.11).
 *
 * **Зачем свой слой, если у Next есть data-cache.** Data-cache Next держит
 * ответ fetch, но:
 *  - после `revalidateTag` запись считается ОТСУТСТВУЮЩЕЙ, а не устаревшей
 *    (Next 14.2, `FileSystemCache.get`): вебхук или прогрев в момент, когда
 *    CMS легла, стёр бы последнюю версию;
 *  - формат и семантика — внутренности Next, меняются между версиями.
 * Здесь же правило одно и проверяется тестом: удачный ответ CMS
 * записывается, отказ CMS читает последний записанный. Ничего, кроме
 * пришедшего ОТ CMS, сюда не попадает — это не запасной контент из кода.
 *
 * **Где лежит.** `CMS_LAST_GOOD_DIR`, по умолчанию `.next/cache/cms-last-good`
 * рядом с data-cache. На стенде `.next/cache` — постоянный том (см.
 * `deploy/vps/README.md`, «Кэш витрины»), поэтому версия переживает и
 * рестарт, и пересоздание контейнера при деплое.
 *
 * Ошибки диска не роняют страницу: отказ записи — строка в лог, отказ
 * чтения — «сохранённой версии нет».
 */

export interface LastGood<T> {
  readonly savedAt: string;
  readonly data: T;
}

function storeDir(): string {
  const configured = process.env.CMS_LAST_GOOD_DIR?.trim();
  return configured ? configured : path.join(process.cwd(), '.next', 'cache', 'cms-last-good');
}

/** Ключ = ресурс + сайт + локаль + параметры. Имя файла читаемо глазами. */
export function lastGoodKey(
  resource: string,
  site: string,
  locale: string,
  params: Record<string, string>,
): string {
  const sorted = Object.keys(params)
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join('&');
  const hash = createHash('sha256').update(`${site}|${locale}|${sorted}`).digest('hex').slice(0, 16);
  return `${resource.replace(/[^a-z0-9-]/gi, '_')}.${site.replace(/[^a-z0-9-]/gi, '_')}.${locale}.${hash}`;
}

/** Что уже лежит на диске — чтобы не переписывать файл на каждый рендер. */
const written = new Map<string, string>();

export async function saveLastGood(key: string, data: unknown): Promise<void> {
  const json = JSON.stringify(data);
  if (written.get(key) === json) return;
  const dir = storeDir();
  const file = path.join(dir, `${key}.json`);
  // Уникальный tmp на КАЖДУЮ запись: параллельные рендеры одного ключа в ту же
  // миллисекунду писали в один tmp — второй rename падал ENOENT, а одновременная
  // запись в общий файл могла склеить содержимое до переименования.
  const tmp = `${file}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await mkdir(dir, { recursive: true });
    await writeFile(tmp, JSON.stringify({ savedAt: new Date().toISOString(), data }), 'utf8');
    // rename атомарен в пределах тома: читатель не увидит полузаписанный файл
    await rename(tmp, file);
    written.set(key, json);
  } catch (error) {
    console.error(`[cms] не удалось сохранить последнюю версию ${key} в ${dir}`, error);
  }
}

export async function loadLastGood(key: string): Promise<LastGood<unknown> | null> {
  try {
    const raw = await readFile(path.join(storeDir(), `${key}.json`), 'utf8');
    const parsed = JSON.parse(raw) as { savedAt?: unknown; data?: unknown };
    if (typeof parsed.savedAt !== 'string' || parsed.data === undefined) return null;
    return { savedAt: parsed.savedAt, data: parsed.data };
  } catch {
    return null;
  }
}

/** Только для unit-тестов */
export function __resetLastGoodMemo(): void {
  written.clear();
}
