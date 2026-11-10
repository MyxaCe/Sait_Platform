/*
 * Точка запуска сервера витрины: 503 вместо 500, когда CMS недоступна и
 * показать нечего (решение владельца 10.11, `lib/cms-outage.ts`).
 *
 * App Router не умеет вернуть из страницы код 503 — брошенная ошибка
 * рендера даёт 500. Здесь на каждый запрос заводится хранилище
 * AsyncLocalStorage под глобальным символом; `getCms`, не найдя ни CMS,
 * ни сохранённой версии, отмечает в нём отказ, а мы переписываем ответ:
 *   500 → 503, Retry-After, X-Robots-Tag: noindex, no-store, и своё
 *   статическое тело «Контент временно недоступен» (без бренда и контента).
 * Остальные 500 (настоящие ошибки кода) не трогаются.
 *
 * Запуск: `node server-entry.cjs <скрипт сервера> [аргументы]`, например
 *   node apps/web/server-entry.cjs apps/web/server.js          (standalone, Docker)
 *   node server-entry.cjs node_modules/next/dist/bin/next start (локально)
 * Скрипт загружается в ЭТОМ ЖЕ процессе: обёртка ставится на
 * http.createServer до того, как Next создаст сервер.
 */
'use strict';

const { AsyncLocalStorage } = require('node:async_hooks');
const http = require('node:http');
const path = require('node:path');

const OUTAGE = Symbol.for('broker.web.cmsOutage');
const RETRY_AFTER_SECONDS = process.env.CMS_OUTAGE_RETRY_AFTER || '120';

const storage = new AsyncLocalStorage();
globalThis[OUTAGE] = storage;

/**
 * Тело ответа 503 — своё, статическое: у Next при отказе корневого layout
 * в теле оказывается «500: Internal Server Error», а при отказе страницы —
 * пустая оболочка, которую дорисовывает клиент. Здесь нет ни бренда, ни
 * контента: показать нечего, и страница честно говорит именно это.
 */
function outageHtml(url) {
  const en = /^\/en(\/|$|\?)/.test(url || '');
  const title = en ? 'Content is temporarily unavailable' : 'Контент временно недоступен';
  const text = en
    ? 'We could not load this page. Please try again in a couple of minutes.'
    : 'Не удалось загрузить содержимое страницы. Попробуйте обновить её через пару минут.';
  const retry = en ? 'Try again' : 'Обновить';
  return (
    `<!DOCTYPE html><html lang="${en ? 'en' : 'ru'}"><head><meta charset="utf-8">` +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    `<meta name="robots" content="noindex"><title>${title}</title>` +
    '<style>body{margin:0;min-height:100svh;display:grid;place-items:center;background:#08090c;' +
    'color:#e8e9ec;font-family:system-ui,sans-serif;text-align:center;padding:2rem}' +
    'p{color:#9aa0aa;max-width:28rem;line-height:1.5}a{color:inherit}</style></head>' +
    `<body><main data-testid="cms-unavailable"><h1>${title}</h1><p>${text}</p>` +
    `<p><a href="">${retry}</a></p></main></body></html>`
  );
}

function wrapListener(listener) {
  return function cmsOutageAware(req, res) {
    const store = {};
    let replaced = false;
    const writeHead = res.writeHead;
    const write = res.write;
    const end = res.end;

    res.writeHead = function patchedWriteHead(statusCode, ...rest) {
      if (statusCode === 500 && store.outage && !replaced) {
        replaced = true;
        statusCode = 503;
        // Тело заменяется целиком: снимаем всё, что описывало прежнее
        for (const name of ['content-length', 'content-encoding', 'etag', 'vary']) {
          this.removeHeader(name);
        }
        this.setHeader('Content-Type', 'text/html; charset=utf-8');
        this.setHeader('Retry-After', RETRY_AFTER_SECONDS);
        this.setHeader('X-Robots-Tag', 'noindex');
        this.setHeader('Cache-Control', 'no-store');
        // Заголовки аргументом writeHead сильнее setHeader — выравниваем и их
        const last = rest[rest.length - 1];
        if (last && typeof last === 'object' && !Array.isArray(last)) {
          for (const key of Object.keys(last)) {
            if (/^(content-length|content-encoding|content-type|etag|cache-control)$/i.test(key)) {
              delete last[key];
            }
          }
        }
        if (typeof rest[0] === 'string') rest[0] = 'Service Unavailable';
      }
      return writeHead.call(this, statusCode, ...rest);
    };
    // Первый write/end без явного writeHead шлёт заголовки неявно — до
    // нашей проверки. Поэтому решение о замене принимаем раньше Node.
    const decideBeforeBody = () => {
      if (!res.headersSent && res.statusCode === 500 && store.outage) res.writeHead(500);
    };
    res.write = function patchedWrite(...args) {
      decideBeforeBody();
      if (replaced) return true; // тело Next не нужно — своё отдадим в end
      return write.apply(this, args);
    };
    res.end = function patchedEnd(...args) {
      decideBeforeBody();
      if (replaced) {
        const cb = args.find((a) => typeof a === 'function');
        return end.call(this, outageHtml(req.url), 'utf8', cb);
      }
      return end.apply(this, args);
    };
    return storage.run(store, () => listener(req, res));
  };
}

const createServer = http.createServer;
http.createServer = function patchedCreateServer(...args) {
  const index = args.findIndex((a) => typeof a === 'function');
  if (index !== -1) args[index] = wrapListener(args[index]);
  const server = createServer.apply(this, args);
  // Слушатель может прийти позже — через server.on('request', …)
  const on = server.on;
  server.on = function patchedOn(event, listener) {
    if (event === 'request' && typeof listener === 'function') {
      return on.call(this, event, wrapListener(listener));
    }
    return on.call(this, event, listener);
  };
  server.addListener = server.on;
  return server;
};

const [, , target, ...rest] = process.argv;
if (!target) {
  console.error('[server-entry] не указан скрипт сервера: node server-entry.cjs <server.js> [args]');
  process.exit(2);
}
const resolved = path.resolve(target);
process.argv = [process.argv[0], resolved, ...rest];
require(resolved);
