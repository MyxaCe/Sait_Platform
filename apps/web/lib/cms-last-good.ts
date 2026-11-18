import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

export interface LastGood<T> {
  readonly savedAt: string;
  readonly data: T;
}

function storeDir(): string {
  const configured = process.env.CMS_LAST_GOOD_DIR?.trim();
  return configured ? configured : path.join(process.cwd(), '.next', 'cache', 'cms-last-good');
}

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

const written = new Map<string, string>();

export async function saveLastGood(key: string, data: unknown): Promise<void> {
  const json = JSON.stringify(data);
  if (written.get(key) === json) return;
  const dir = storeDir();
  const file = path.join(dir, `${key}.json`);
  const tmp = `${file}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await mkdir(dir, { recursive: true });
    await writeFile(tmp, JSON.stringify({ savedAt: new Date().toISOString(), data }), 'utf8');
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

export function __resetLastGoodMemo(): void {
  written.clear();
}
