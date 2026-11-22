import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SelfieComparison } from './SelfieComparison';
import type { SelfieCaptureView } from '@/lib/kyc/selfie-view';

const capture: SelfieCaptureView = {
  code: '4821',
  provider: 'ручная проверка оператором',
  issuedText: '22.11.2026, 13:00',
  expiresText: '22.11.2026, 13:02',
  usedText: '22.11.2026, 13:00',
  userAgent: 'Mozilla/5.0 (Android)',
  tasks: ['Лицо прямо в камеру', 'Поднять пальцев: 3', 'Документ рядом с лицом'],
  frames: [
    { index: 0, task: 'Лицо прямо в камеру', capturedText: '22.11.2026, 13:00', offsetText: '+4 с' },
    { index: 1, task: 'Поднять пальцев: 3', capturedText: '22.11.2026, 13:00', offsetText: '+11 с' },
    { index: 2, task: 'Документ рядом с лицом', capturedText: '22.11.2026, 13:00', offsetText: '+19 с' },
  ],
};

const frames = [0, 1, 2].map((i) => ({ index: i, url: `https://signed.example/f${i}` }));

describe('сравнение селфи с документом', () => {
  it('все снимки с заданием и временем, код, браузер и фото документа рядом', () => {
    const html = renderToStaticMarkup(
      <SelfieComparison
        capture={capture}
        frames={frames}
        identity={{ id: 'id', url: 'https://signed.example/id', contentType: 'image/jpeg', submittedAt: '2026-11-20T10:00:00Z' }}
      />,
    );
    for (const [i, f] of capture.frames.entries()) {
      expect(html).toContain(`src="https://signed.example/f${i}" alt="Снимок ${i + 1}: ${f.task}"`);
      expect(html).toContain(f.offsetText);
    }
    expect(html).toContain('src="https://signed.example/id" alt="Документ личности"');
    expect(html).toContain('4821');
    expect(html).toContain('Mozilla/5.0 (Android)');
    expect(html).toContain(capture.tasks.join(' → '));
    expect(html).toContain('решение принимает оператор');
  });

  it('документа личности нет — предупреждение вместо фото', () => {
    const html = renderToStaticMarkup(<SelfieComparison capture={capture} frames={frames} identity={null} />);
    expect(html).toContain('сравнить не с чем');
    expect(html).not.toContain('alt="Документ личности"');
  });
});
