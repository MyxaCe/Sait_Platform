export type InstallPlatform = 'ios' | 'android' | 'samsung' | 'inApp' | 'desktop';

/**
 * Где открыт сайт — от этого зависят шаги установки, когда браузер сам окно
 * установки не показывает (iOS его не умеет вовсе, встроенные браузеры
 * Telegram/Instagram ставить не дают, Samsung Internet — своим меню).
 */
export function detectInstallPlatform(userAgent: string, maxTouchPoints = 0): InstallPlatform {
  const ua = userAgent || '';
  if (/Telegram|Instagram|FBAN|FBAV|FB_IAB|\bLine\/|VKClient|; wv\)/i.test(ua)) return 'inApp';
  if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && maxTouchPoints > 1)) return 'ios';
  if (/SamsungBrowser/.test(ua)) return 'samsung';
  if (/Android/.test(ua)) return 'android';
  return 'desktop';
}

/** Сколько шагов у инструкции платформы; тексты — `pwa.sheet.<платформа>.<номер>`. */
export const INSTALL_STEPS: Record<InstallPlatform, number> = {
  ios: 3,
  android: 3,
  samsung: 2,
  inApp: 2,
  desktop: 2,
};

/**
 * Окно установки «закрылось» быстрее, чем человек успел бы нажать «Отмена», —
 * значит, браузер его не показал (ранее отклонено, политика браузера).
 * Тогда показываем инструкцию, а не молчим.
 */
export const SILENT_DISMISS_MS = 400;
