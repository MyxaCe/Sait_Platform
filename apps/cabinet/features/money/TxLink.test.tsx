import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MachineValue } from './TxLink';

const HASH = 'c'.repeat(64);

describe('хэш в истории — ссылка на Tronscan', () => {
  it('новая вкладка, noopener noreferrer, адрес по решению владельца', () => {
    render(
      <MachineValue value={HASH} label="Хэш" copyLabel="копировать" copiedLabel="ок" tronscanLabel="Открыть в Tronscan" tx />,
    );
    const link = screen.getByRole('link', { name: 'Открыть в Tronscan' });
    expect(link.getAttribute('href')).toBe(`https://tronscan.org/#/transaction/${HASH}`);
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('адрес получателя — без внешней ссылки', () => {
    render(<MachineValue value="TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t" label="Кому" copyLabel="к" copiedLabel="ок" />);
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByRole('button', { name: 'к' })).toBeTruthy();
  });
});
