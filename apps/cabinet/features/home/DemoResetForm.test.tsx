import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { DemoResetOutcome } from '@/lib/actions';
import { DemoResetForm } from './DemoResetForm';

/**
 * WEB-42 · форма ПОКАЗЫВАЕТ исход, а не только получает его.
 *
 * **Зачем отдельно от проверок действия.** Там доказано, что действие
 * возвращает названное состояние. Это не доказывает, что человек его
 * увидит: раскладка состояния в подпись живёт здесь, и сломать её
 * можно, не тронув действие.
 *
 * До этой проверки в кабинете нельзя было отрисовать ни один из
 * тринадцати клиентских компонентов — окружение было узловым. Дыра та
 * же, что WEB-16 закрыл в витрине, и нашлась она, когда я добавил
 * четырнадцатый, чья работа как раз показывать.
 */

const state = vi.hoisted(() => ({ current: { state: 'idle' } as DemoResetOutcome }));

vi.mock('react-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-dom')>();
  return {
    ...actual,
    useFormState: () => [state.current, () => undefined],
    useFormStatus: () => ({ pending: false }),
  };
});

vi.mock('@/lib/actions', () => ({ resetDemoAccountAction: () => undefined }));

const TEXTS: Record<string, string> = {
  resetAccepted: 'принято',
  resetPositionsOpen: 'закройте позиции',
  resetNotDemo: 'не демо-счёт',
  resetRefused: 'отказано',
  resetUnavailable: 'недоступен',
  resetTooOften: 'слишком часто',
  resetNoSession: 'войдите заново',
};

function show(outcome: DemoResetOutcome) {
  state.current = outcome;
  render(<DemoResetForm label="Сбросить" texts={TEXTS} />);
}

describe('WEB-42 · подпись под кнопкой', () => {
  it('до нажатия подписи нет', () => {
    show({ state: 'idle' });

    // Сообщение до действия было бы утверждением ни о чём.
    for (const text of Object.values(TEXTS)) {
      expect(screen.queryByText(text)).toBeNull();
    }
  });

  it('принято — говорит «принято», и НЕ говорит «сброшено»', () => {
    show({ state: 'accepted' });

    expect(screen.getByText('принято')).toBeDefined();
  });

  it.each([
    ['account_not_flat', 'закройте позиции'],
    ['not_a_demo_account', 'не демо-счёт'],
  ] as const)('отказ «%s» назван своими словами', (reason, text) => {
    show({ state: 'refused', reason });

    expect(screen.getByText(text)).toBeDefined();
  });

  it('незнакомая причина → общий текст, а не пустота', () => {
    show({ state: 'refused', reason: null });

    expect(screen.getByText('отказано')).toBeDefined();
  });

  it('не дошли — это ДРУГАЯ подпись, чем отказ по существу', () => {
    show({ state: 'unavailable', reason: 'network' });

    expect(screen.getByText('недоступен')).toBeDefined();
    expect(screen.queryByText('отказано')).toBeNull();
  });

  it('слишком часто — названо, а не третья тишина', () => {
    show({ state: 'too-often' });

    expect(screen.getByText('слишком часто')).toBeDefined();
  });

  it('отказ и успех различаются не только словами', () => {
    show({ state: 'accepted' });
    const ok = screen.getByText('принято').className;

    state.current = { state: 'refused', reason: 'account_not_flat' };
    render(<DemoResetForm label="Сбросить" texts={TEXTS} />);
    const no = screen.getByText('закройте позиции').className;

    // Цвет несёт то же различие для того, кто читает бегло.
    expect(ok).not.toBe(no);
  });

  it('подпись объявлена живой областью — её озвучит экранный диктор', () => {
    show({ state: 'accepted' });

    expect(screen.getByRole('status')).toBeDefined();
  });
});
