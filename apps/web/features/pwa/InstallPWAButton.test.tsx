import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InstallPWAButton } from './InstallPWAButton';

vi.mock('next-intl', () => ({
  useTranslations: (ns: string) => (key: string) => `${ns}.${key}`,
}));

const ANDROID = 'Mozilla/5.0 (Linux; Android 13; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/104.0.0.0 Mobile Safari/537.36';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const TELEGRAM = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Telegram-iOS/10.0';

function setUa(ua: string) {
  Object.defineProperty(window.navigator, 'userAgent', { value: ua, configurable: true });
}

function fireInstallPrompt(outcome: 'accepted' | 'dismissed', opts: { delayMs?: number; throws?: boolean } = {}) {
  const event = new Event('beforeinstallprompt') as Event & {
    prompt: () => Promise<void>;
    userChoice: Promise<{ outcome: string }>;
  };
  event.prompt = vi.fn(async () => {
    if (opts.throws) throw new Error('NotAllowedError');
  });
  event.userChoice = new Promise((resolve) => setTimeout(() => resolve({ outcome }), opts.delayMs ?? 0));
  act(() => {
    window.dispatchEvent(event);
  });
  return event;
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  window.matchMedia = vi.fn().mockReturnValue({ matches: false }) as unknown as typeof window.matchMedia;
});
afterEach(() => {
  vi.useRealTimers();
});

const button = () => screen.getByRole('button', { name: /pwa\.install/ });

describe('кнопка «Установить приложение» никогда не мёртвая', () => {
  it('без системного окна (iOS) открывает шаги для iPhone', async () => {
    setUa(IPHONE);
    render(<InstallPWAButton />);
    await act(async () => fireEvent.click(button()));
    const dialog = screen.getByRole('dialog');
    expect(dialog.textContent).toContain('pwa.sheet.ios.1');
    expect(dialog.textContent).toContain('pwa.sheet.ios.3');
  });

  it('сразу после загрузки (событие ещё не пришло) — не молчит, а показывает шаги Android', async () => {
    setUa(ANDROID);
    render(<InstallPWAButton />);
    await act(async () => fireEvent.click(button()));
    expect(screen.getByRole('dialog').textContent).toContain('pwa.sheet.android.2');
  });

  it('системное окно есть — показываем его, инструкцию не открываем', async () => {
    setUa(ANDROID);
    render(<InstallPWAButton />);
    const ev = fireInstallPrompt('dismissed', { delayMs: 2000 });
    await act(async () => {
      fireEvent.click(button());
      await vi.advanceTimersByTimeAsync(2500);
    });
    expect(ev.prompt).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('окно «закрылось» мгновенно (браузер его не показал) — открываем инструкцию', async () => {
    setUa(ANDROID);
    render(<InstallPWAButton />);
    fireInstallPrompt('dismissed', { delayMs: 0 });
    await act(async () => {
      fireEvent.click(button());
      await vi.advanceTimersByTimeAsync(50);
    });
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('вызов окна упал — открываем инструкцию, а не глотаем ошибку', async () => {
    setUa(ANDROID);
    render(<InstallPWAButton />);
    fireInstallPrompt('dismissed', { throws: true });
    await act(async () => fireEvent.click(button()));
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('установили — вместо кнопки отметка', async () => {
    setUa(ANDROID);
    render(<InstallPWAButton />);
    fireInstallPrompt('accepted', { delayMs: 1000 });
    await act(async () => {
      fireEvent.click(button());
      await vi.advanceTimersByTimeAsync(1500);
    });
    expect(screen.getByText('pwa.installed')).toBeTruthy();
  });

  it('встроенный браузер (Telegram): объясняем и даём скопировать ссылку; Escape закрывает', async () => {
    setUa(TELEGRAM);
    render(<InstallPWAButton />);
    await act(async () => fireEvent.click(button()));
    const dialog = screen.getByRole('dialog');
    expect(dialog.textContent).toContain('pwa.sheet.inApp.1');
    expect(screen.getByRole('button', { name: 'pwa.sheet.copy' })).toBeTruthy();
    await act(async () => fireEvent.keyDown(document, { key: 'Escape' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
