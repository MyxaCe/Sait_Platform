// Медиа CMS (логотип, обложки, постеры, документы лицензий) отдаём через сам сайт: /media/<файл>.
// Хост cms. закрыт фильтром по IP, поэтому прямые ссылки https://cms.<домен>/api/media/file/<файл>
// у клиентов не открываются. Здесь — переписывание ссылок из ответов CMS и проверка имени файла;
// сам прокси — в ./media-proxy (только сервер).

export const MEDIA_PROXY_PREFIX = '/media/';

const CMS_MEDIA_PATH = /^\/api\/media\/file\/([^/]+)$/;

/** Имя файла из пути `/media/<имя>`; null — недопустимое имя (обход каталогов, управляющие символы и т. п.). */
export function safeMediaName(raw: string): string | null {
  let name: string;
  try {
    name = decodeURIComponent(raw);
  } catch {
    return null;
  }
  if (name.length === 0 || name.length > 255) return null;
  if (name.startsWith('.') || name.includes('..')) return null;
  if (/[\\/\u0000-\u001f\u007f?#%]/.test(name)) return null;
  return name;
}

/** Ссылка CMS на медиа-файл → относительный путь сайта; чужие ссылки возвращаются как есть. */
export function toProxiedMediaUrl(url: string): string {
  if (!/^https?:\/\//i.test(url)) return url;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  const match = CMS_MEDIA_PATH.exec(parsed.pathname);
  if (!match) return url;
  const name = safeMediaName(match[1]!);
  return name === null ? url : `${MEDIA_PROXY_PREFIX}${encodeURIComponent(name)}`;
}

/** Абсолютная ссылка на прокси-медиа (для OG, JSON-LD, терминала); прочие ссылки не трогает. */
export function absoluteMediaUrl(url: string, origin: string | null | undefined): string {
  if (!origin || !url.startsWith(MEDIA_PROXY_PREFIX)) return url;
  try {
    return new URL(url, origin).toString();
  } catch {
    return url;
  }
}

/** Глубоко переписывает все строки-ссылки на медиа CMS в ответе (бренд, статьи, юрлицо, Lexical). */
export function rewriteMediaUrls<T>(value: T): T {
  if (typeof value === 'string') return toProxiedMediaUrl(value) as T;
  if (Array.isArray(value)) {
    let changed = false;
    const out = value.map((item) => {
      const next = rewriteMediaUrls(item);
      if (next !== item) changed = true;
      return next;
    });
    return (changed ? out : value) as T;
  }
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    let changed = false;
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      const next = rewriteMediaUrls(item);
      if (next !== item) changed = true;
      out[key] = next;
    }
    return (changed ? out : value) as T;
  }
  return value;
}
