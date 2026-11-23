import { describe, expect, it } from 'vitest';
import {
  consentDocumentsFrom,
  consentRecords,
  decodeShownVersions,
  encodeShownVersions,
} from './legal-consent';

const cms = {
  items: [
    { slug: 'privacy', title: 'Политика конфиденциальности', updatedAt: '2026-06-01', intro: '', sections: [] },
    { slug: 'terms', title: 'Условия использования', updatedAt: '2026-07-15', intro: '', sections: [] },
    { slug: 'kyc-aml', title: 'KYC', updatedAt: '2026-06-01', intro: '', sections: [] },
  ],
};

describe('legal-consent', () => {
  it('берёт из CMS только документы согласия, в фиксированном порядке', () => {
    expect(consentDocumentsFrom(cms)).toEqual([
      { slug: 'terms', title: 'Условия использования', version: '2026-07-15' },
      { slug: 'privacy', title: 'Политика конфиденциальности', version: '2026-06-01' },
      { slug: 'risk-disclosure', title: null, version: null },
    ]);
  });

  it('неразборчивый ответ CMS — null, а не пустой список', () => {
    expect(consentDocumentsFrom(null)).toBeNull();
    expect(consentDocumentsFrom({ items: 'x' })).toBeNull();
  });

  it('показанные редакции кодируются и читаются обратно, мусор отбрасывается', () => {
    const shown = encodeShownVersions(consentDocumentsFrom(cms));
    expect(shown).toBe('terms@2026-07-15;privacy@2026-06-01');
    const decoded = decodeShownVersions(`${shown};evil@x;terms2@1;risk-disclosure@<script>`);
    expect([...decoded.entries()]).toEqual([
      ['terms', '2026-07-15'],
      ['privacy', '2026-06-01'],
    ]);
    expect(decodeShownVersions('x'.repeat(401)).size).toBe(0);
  });

  it('редакция с сервера важнее показанной: скрытым полем её не подменить', () => {
    const records = consentRecords(consentDocumentsFrom(cms), new Map([['terms', '1999-01-01']]));
    expect(records[0]).toEqual({ slug: 'terms', title: 'Условия использования', version: '2026-07-15', source: 'cms' });
  });

  it('CMS не ответила — пишем показанную редакцию, иначе честное unknown', () => {
    const records = consentRecords(null, new Map([['privacy', '2026-06-01']]));
    expect(records.map((r) => [r.slug, r.version, r.source])).toEqual([
      ['terms', 'unknown', 'unknown'],
      ['privacy', '2026-06-01', 'form'],
      ['risk-disclosure', 'unknown', 'unknown'],
    ]);
  });
});
