import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Tour } from './Tour';

const labels = { back: 'Назад', next: 'Далее', skip: 'Пропустить', done: 'Готово', help: 'Экскурсия', stepOf: 'Шаг {current} из {total}' };
const steps = [
  { anchor: 'a', title: 'Баланс', body: 'Здесь деньги' },
  { anchor: 'missing', title: 'Нет на экране', body: '—' },
  { anchor: 'b', title: 'Торговля', body: 'Здесь терминал' },
];

function el(): HTMLElement {
  const node = document.createElement('div');
  node.getBoundingClientRect = () => ({ top: 100, left: 100, width: 200, height: 40, right: 300, bottom: 140, x: 100, y: 100, toJSON: () => ({}) });
  node.scrollIntoView = () => {};
  document.body.appendChild(node);
  return node;
}

let nodes: Record<string, HTMLElement>;
beforeEach(() => {
  nodes = { a: el(), b: el() };
});
afterEach(() => {
  document.body.innerHTML = '';
});

const resolve = (anchor: string) => nodes[anchor] ?? null;

describe('экскурсия', () => {
  it('листает, пропускает шаг без элемента, на последнем — «Готово»', () => {
    const onClose = vi.fn();
    render(<Tour steps={steps} labels={labels} resolve={resolve} onClose={onClose} />);
    expect(screen.getByRole('dialog', { name: 'Баланс' })).toBeTruthy();
    expect(screen.getByText('Шаг 1 из 3')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Назад' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Далее' }));
    expect(screen.getByRole('dialog', { name: 'Торговля' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Готово' }));
    expect(onClose).toHaveBeenCalledWith('done', true);
  });

  it('Esc — пропустить; стрелки листают', () => {
    const onClose = vi.fn();
    render(<Tour steps={steps} labels={labels} resolve={resolve} onClose={onClose} />);
    act(() => {
      fireEvent.keyDown(window, { key: 'ArrowRight' });
    });
    expect(screen.getByRole('dialog', { name: 'Торговля' })).toBeTruthy();
    act(() => {
      fireEvent.keyDown(window, { key: 'ArrowLeft' });
    });
    expect(screen.getByRole('dialog', { name: 'Баланс' })).toBeTruthy();
    act(() => {
      fireEvent.keyDown(window, { key: 'Escape' });
    });
    expect(onClose).toHaveBeenCalledWith('skipped', true);
  });

  it('ни одного элемента на экране — закрывается, отметку не ставит', () => {
    const onClose = vi.fn();
    render(<Tour steps={steps} labels={labels} resolve={() => null} onClose={onClose} />);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(onClose).toHaveBeenCalledWith('done', false);
  });
});
