import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SiteFooter } from './SiteFooter';
import { footerLegalLines, type LegalLabels } from './legal';

const LABELS: LegalLabels = {
  regNumber: (n) => `рег. № ${n}`,
  license: (n) => (n ? `Лицензия № ${n}` : 'Лицензия'),
};

const ENTITY = {
  name: 'Example Ltd',
  registrationNumber: 'EX-000000',
  address: '1 Example Street, Example City',
  licenses: [
    {
      number: 'LIC-0001',
      activity: 'Брокерская деятельность',
      regulator: 'Example Financial Authority',
      verifyUrl: 'https://register.example.test/firms/LIC-0001',
    },
    { number: 'LIC-0002', activity: null, regulator: null, verifyUrl: null },
  ],
};

const BASE = { columns: [], riskWarning: 'Риск', brandName: 'Brand', copyright: '© Brand' };

describe('footerLegalLines', () => {
  it('строка юрлица и строки лицензий собираются только из заполненного', () => {
    expect(footerLegalLines(ENTITY, LABELS)).toEqual({
      entity: 'Example Ltd, рег. № EX-000000, 1 Example Street, Example City',
      licenses: [
        {
          text: 'Лицензия № LIC-0001 (Брокерская деятельность), Example Financial Authority',
          verifyUrl: 'https://register.example.test/firms/LIC-0001',
        },
        { text: 'Лицензия № LIC-0002', verifyUrl: null },
      ],
    });
  });

  it('частично заполненное — без пустых подписей и лишних запятых', () => {
    expect(
      footerLegalLines(
        { name: null, registrationNumber: 'EX-1', address: null, licenses: [] },
        LABELS,
      ),
    ).toEqual({ entity: 'рег. № EX-1', licenses: [] });
    expect(
      footerLegalLines(
        {
          name: null,
          registrationNumber: null,
          address: null,
          licenses: [{ number: null, activity: null, regulator: 'Example Authority', verifyUrl: null }],
        },
        LABELS,
      ),
    ).toEqual({ entity: null, licenses: [{ text: 'Лицензия, Example Authority', verifyUrl: null }] });
  });

  it('ничего не заполнено — null', () => {
    expect(footerLegalLines(null, LABELS)).toBeNull();
    expect(footerLegalLines(undefined, LABELS)).toBeNull();
    expect(
      footerLegalLines(
        {
          name: null,
          registrationNumber: null,
          address: null,
          licenses: [{ number: null, activity: null, regulator: null, verifyUrl: 'https://register.example.test/x' }],
        },
        LABELS,
      ),
    ).toBeNull();
  });
});

describe('SiteFooter · юрлицо и лицензии', () => {
  it('выводит строки и ссылку «Проверить лицензию» в новой вкладке', () => {
    const lines = footerLegalLines(ENTITY, LABELS)!;
    render(<SiteFooter {...BASE} legal={{ ...lines, verifyLabel: 'Проверить лицензию' }} />);
    expect(screen.getByText('Example Ltd, рег. № EX-000000, 1 Example Street, Example City')).toBeTruthy();
    const links = screen.getAllByRole('link', { name: 'Проверить лицензию' });
    expect(links).toHaveLength(1);
    expect(links[0]!.getAttribute('href')).toBe('https://register.example.test/firms/LIC-0001');
    expect(links[0]!.getAttribute('target')).toBe('_blank');
    expect(links[0]!.getAttribute('rel')).toBe('noopener noreferrer');
    expect(screen.getByText('Лицензия № LIC-0002')).toBeTruthy();
  });

  it('без данных юр-блока нет', () => {
    const { container } = render(<SiteFooter {...BASE} legal={null} />);
    expect(container.querySelector('[data-testid="footer-legal"]')).toBeNull();
    expect(container.textContent).not.toMatch(/Лиценз|рег\. №/);
  });
});
