import { defaultCache } from '@serwist/next/worker';
import type { PrecacheEntry, SerwistGlobalConfig } from 'serwist';
import { Serwist } from 'serwist';

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

const serwist = new Serwist({
  // Статика приложения (JS/CSS/шрифты) прекешируется при установке SW
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  // defaultCache от Serwist: разумные стратегии для next/image, шрифтов,
  // статики и страниц. Котировки идут по WebSocket и в кеш не попадают —
  // устаревшая цена хуже её отсутствия.
  runtimeCaching: defaultCache,
  fallbacks: {
    entries: [
      {
        // Если сети нет и страницы нет в кеше — показываем /offline
        url: '/offline',
        matcher({ request }) {
          return request.destination === 'document';
        },
      },
    ],
  },
});

serwist.addEventListeners();
