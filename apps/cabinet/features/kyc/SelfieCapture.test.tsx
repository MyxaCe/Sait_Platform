import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import messages from '@/messages/ru.json';

const start = vi.hoisted(() => vi.fn());
vi.mock('@/lib/kyc-liveness-actions', () => ({ startSelfieChallengeAction: start, submitSelfieCaptureAction: vi.fn() }));
vi.mock('@/lib/kyc-actions', () => ({ submitKycDocumentAction: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {} }) }));
vi.mock('qrcode', () => ({ default: { toString: async () => '<svg data-qr="1"></svg>' } }));
vi.mock('react-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-dom')>();
  return { ...actual, useFormState: (_a: unknown, init: unknown) => [init, () => undefined], useFormStatus: () => ({ pending: false }) };
});

const { SelfieCapture, cameraUnavailableReason } = await import('./SelfieCapture');
const { KycUploadForm } = await import('./KycUploadForm');

const wrap = (ui: ReactNode) =>
  render(
    <NextIntlClientProvider locale="ru" messages={messages} timeZone="UTC">
      {ui}
    </NextIntlClientProvider>,
  );

const setMedia = (getUserMedia: (() => Promise<unknown>) | undefined) => {
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: getUserMedia ? { getUserMedia } : undefined,
  });
};

beforeEach(() => {
  start.mockReset();
});

afterEach(() => {
  setMedia(undefined);
});

describe('селфи: только камера', () => {
  it('на шаге нет поля загрузки файла', () => {
    const { container } = wrap(<SelfieCapture />);
    expect(container.querySelector('input[type="file"]')).toBeNull();
    expect(screen.getByText(/загрузить фото из галереи нельзя/i)).toBeTruthy();
  });

  it('без камеры в браузере — понятное сообщение, подсказка про телефон и QR; задание не запрашивается', async () => {
    setMedia(undefined);
    wrap(<SelfieCapture />);
    fireEvent.click(screen.getByRole('button', { name: 'Включить камеру' }));
    expect(await screen.findByText('Этот браузер не даёт доступа к камере.')).toBeTruthy();
    expect(screen.getByText(/Сделайте этот шаг с телефона/)).toBeTruthy();
    await waitFor(() => expect(screen.getByRole('img', { name: /QR-код/ })).toBeTruthy());
    expect(start).not.toHaveBeenCalled();
  });

  it('доступ к камере запрещён — сообщение про разрешение', async () => {
    setMedia(() => Promise.reject(Object.assign(new Error('denied'), { name: 'NotAllowedError' })));
    wrap(<SelfieCapture />);
    fireEvent.click(screen.getByRole('button', { name: 'Включить камеру' }));
    expect(await screen.findByText(/Нет доступа к камере/)).toBeTruthy();
    expect(start).not.toHaveBeenCalled();
  });

  it('причины недоступности камеры', () => {
    expect(cameraUnavailableReason({ name: 'NotAllowedError' })).toBe('denied');
    expect(cameraUnavailableReason({ name: 'NotFoundError' })).toBe('nocamera');
    expect(cameraUnavailableReason({ name: 'NotReadableError' })).toBe('error');
  });

  it('камера есть — задание показано с кодом', async () => {
    const stop = vi.fn();
    setMedia(() => Promise.resolve({ getTracks: () => [{ stop }] }));
    start.mockResolvedValue({
      ok: true,
      challenge: { id: 'c1', code: '4821', tasks: [{ kind: 'face_front' }, { kind: 'show_fingers', count: 3 }, { kind: 'turn_left' }], ttlMs: 120_000 },
    });
    HTMLMediaElement.prototype.play = vi.fn(() => Promise.resolve());
    wrap(<SelfieCapture />);
    fireEvent.click(screen.getByRole('button', { name: 'Включить камеру' }));
    expect(await screen.findByTestId('selfie-task')).toBeTruthy();
    expect(screen.getByText('Код 4821')).toBeTruthy();
    expect(screen.getByText('Снимок 1 из 3')).toBeTruthy();
    expect(screen.getByTestId('selfie-task').textContent).toMatch(/Смотрите прямо в камеру/);
  });
});

describe('загрузка файлом — только для документов, не для селфи', () => {
  it('форма документа отдаёт фиксированный вид без выбора селфи', () => {
    const { container } = wrap(<KycUploadForm kind="identity" />);
    expect(container.querySelector('select')).toBeNull();
    expect((container.querySelector('input[name="kind"]') as HTMLInputElement).value).toBe('identity');
  });
});
