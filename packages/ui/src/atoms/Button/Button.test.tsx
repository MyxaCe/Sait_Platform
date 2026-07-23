import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Button } from './Button';

describe('Button', () => {
  it('рендерит текст и обрабатывает клик', () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Открыть счёт</Button>);
    const button = screen.getByRole('button', { name: 'Открыть счёт' });
    button.click();
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('в состоянии loading заблокирована и показывает спиннер', () => {
    const onClick = vi.fn();
    render(
      <Button loading onClick={onClick}>
        Отправить
      </Button>,
    );
    const button = screen.getByRole('button');
    expect(button).toHaveProperty('disabled', true);
    button.click();
    expect(onClick).not.toHaveBeenCalled();
  });

  it('применяет вариант danger', () => {
    render(<Button variant="danger">Удалить</Button>);
    expect(screen.getByRole('button').className).toContain('bg-negative');
  });
});
