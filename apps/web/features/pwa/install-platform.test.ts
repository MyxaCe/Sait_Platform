import { describe, expect, it } from 'vitest';
import { detectInstallPlatform, INSTALL_STEPS } from './install-platform';

const UA = {
  androidChrome104: 'Mozilla/5.0 (Linux; Android 13; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/104.0.0.0 Mobile Safari/537.36',
  iphoneSafari: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  ipadDesktopMode: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
  samsung: 'Mozilla/5.0 (Linux; Android 13; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/24.0 Chrome/117.0.0.0 Mobile Safari/537.36',
  androidWebView: 'Mozilla/5.0 (Linux; Android 13; K; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/116.0.0.0 Mobile Safari/537.36',
  iosTelegram: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Telegram-iOS/10.0',
  instagram: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 300.0.0',
  desktopChrome: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
};

describe('платформа установки приложения', () => {
  it.each([
    [UA.androidChrome104, 0, 'android'],
    [UA.iphoneSafari, 5, 'ios'],
    [UA.ipadDesktopMode, 5, 'ios'],
    [UA.ipadDesktopMode, 0, 'desktop'],
    [UA.samsung, 5, 'samsung'],
    [UA.androidWebView, 5, 'inApp'],
    [UA.iosTelegram, 5, 'inApp'],
    [UA.instagram, 5, 'inApp'],
    [UA.desktopChrome, 0, 'desktop'],
    ['', 0, 'desktop'],
  ] as const)('%s → %s', (ua, touch, expected) => {
    expect(detectInstallPlatform(ua, touch)).toBe(expected);
  });

  it('у каждой платформы есть шаги', () => {
    for (const n of Object.values(INSTALL_STEPS)) expect(n).toBeGreaterThan(0);
  });
});
