import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { LanguageSwitcher } from './LanguageSwitcher';

const options = [
  { locale: 'ru', label: 'Русский', href: '/instruments' },
  { locale: 'de', label: 'Deutsch', href: '/de/instruments' },
];

describe('LanguageSwitcher', () => {
  it('показывает самоназвания и ведёт на ту же страницу в другом языке', () => {
    render(<LanguageSwitcher current="ru" options={options} label="Язык" />);
    fireEvent.click(screen.getByRole('button', { name: 'Язык' }));
    expect(screen.getByRole('link', { name: /Deutsch/ })).toHaveProperty('pathname', '/de/instruments');
    expect(screen.getByRole('link', { name: /Русский/ }).getAttribute('aria-current')).toBe('true');
  });

  it('один язык — переключателя нет', () => {
    const { container } = render(<LanguageSwitcher current="ru" options={options.slice(0, 1)} label="Язык" />);
    expect(container.innerHTML).toBe('');
  });
});
