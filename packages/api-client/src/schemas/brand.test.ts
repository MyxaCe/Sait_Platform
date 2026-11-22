import { describe, expect, it } from 'vitest';
import { brandSchema } from './cms';

const MEDIA = {
  url: 'https://cdn.example/logo.svg',
  width: 120,
  height: 32,
  alt: 'Apex',
  mimeType: 'image/svg+xml',
};

const SOCIAL = { name: 'telegram', url: 'https://t.me/apex' };

const legacy = (over: Record<string, unknown> = {}) => ({
  name: 'Apex Capital',
  logo: MEDIA,
  favicon: MEDIA,
  primaryColor: '#d4a437',
  socials: [SOCIAL],
  ...over,
});

const v2 = (brandOver: Record<string, unknown> = {}) => ({
  contract: 'v1',
  site: { slug: 'apex-ru', name: 'Apex Capital' },
  brand: {
    logoLight: MEDIA,
    logoDark: null,
    logoMono: null,
    logoMark: null,
    favicon: MEDIA,
    emailLogo: null,
    primaryColor: '#d4a437',
    socials: [SOCIAL],
    ...brandOver,
  },
});

describe('негодный слот теряет СЕБЯ, а не весь бренд', () => {
  const brokenValues: [string, unknown][] = [
    ['null по контракту', null],
    ['строка вместо объекта', 'https://cdn.example/logo.svg'],
    ['объект без размеров', { url: 'https://cdn.example/l.svg', alt: 'x', mimeType: 'image/svg+xml' }],
    ['относительный адрес', { ...MEDIA, url: '/logo.svg' }],
    ['нулевая ширина', { ...MEDIA, width: 0 }],
  ];

  it.each(brokenValues)('logo: %s → logo = null, имя и остальное целы', (_name, value) => {
    const parsed = brandSchema.parse(legacy({ logo: value }));

    expect(parsed.logo).toBeNull();
    expect(parsed.name).toBe('Apex Capital');
    expect(parsed.favicon).toEqual(MEDIA);
    expect(parsed.primaryColor).toBe('#d4a437');
    expect(parsed.socials).toEqual([SOCIAL]);
  });

  it.each(brokenValues)('favicon: %s → favicon = null, логотип цел', (_name, value) => {
    const parsed = brandSchema.parse(legacy({ favicon: value }));

    expect(parsed.favicon).toBeNull();
    expect(parsed.logo).toEqual(MEDIA);
    expect(parsed.name).toBe('Apex Capital');
  });

  it.each([
    ['null по контракту', null],
    ['не hex', 'красный'],
    ['три знака', '#abc'],
    ['число', 0xd4a437],
  ])('primaryColor: %s → цвет не задан, бренд цел', (_name, value) => {
    const parsed = brandSchema.parse(legacy({ primaryColor: value }));

    expect(parsed.primaryColor).toBeNull();
    expect(parsed.name).toBe('Apex Capital');
    expect(parsed.logo).toEqual(MEDIA);
  });

  it('негодны СРАЗУ все слоты — остаётся имя, а не фикстура', () => {
    const parsed = brandSchema.parse(
      legacy({ logo: 'нет', favicon: 42, primaryColor: 'нет', socials: 'нет' }),
    );

    expect(parsed).toEqual({
      name: 'Apex Capital',
      logo: null,
      favicon: null,
      primaryColor: null,
      socials: [],
      legalEntity: null,
    });
  });
});

describe('имя бренда остаётся обязательным', () => {
  it('поля нет вовсе → ответ отвергнут целиком', () => {
    const { name: _dropped, ...withoutName } = legacy();

    expect(brandSchema.safeParse(withoutName).success).toBe(false);
  });

  it.each([
    ['пустая строка', ''],
    ['null', null],
    ['число', 42],
  ])('имя %s → ответ отвергнут целиком, и это правильный исход', (_name, value) => {
    expect(brandSchema.safeParse(legacy({ name: value })).success).toBe(false);
  });
});

describe('одна сломанная ссылка не уносит остальные', () => {
  it('негодный элемент выброшен, годные сохранены', () => {
    const good2 = { name: 'x', url: 'https://x.com/apex' };
    const parsed = brandSchema.parse(
      legacy({ socials: [SOCIAL, { name: 'vk', url: 'не-url' }, good2] }),
    );

    expect(parsed.socials).toEqual([SOCIAL, good2]);
  });

  it('не список вовсе → пусто, остальной бренд цел', () => {
    const parsed = brandSchema.parse(legacy({ socials: { name: 'x', url: 'https://x' } }));

    expect(parsed.socials).toEqual([]);
    expect(parsed.name).toBe('Apex Capital');
  });
});

describe('читаются обе формы: legacy и public-brand.v1', () => {
  it('плоский legacy разбирается как прежде', () => {
    expect(brandSchema.parse(legacy())).toEqual({
      name: 'Apex Capital',
      logo: MEDIA,
      favicon: MEDIA,
      primaryColor: '#d4a437',
      socials: [SOCIAL],
      legalEntity: null,
    });
  });

  it('вложенный v2 приводится к той же форме', () => {
    expect(brandSchema.parse(v2())).toEqual({
      name: 'Apex Capital',
      logo: MEDIA,
      favicon: MEDIA,
      primaryColor: '#d4a437',
      socials: [SOCIAL],
      legalEntity: null,
    });
  });

  it('РАСТЯЖКА: v2 не проваливается в плоскую ветвь как «бренд без полей»', () => {
    const parsed = brandSchema.parse(v2());

    expect(parsed.name).toBe('Apex Capital');
    expect(parsed.logo).not.toBeNull();
  });

  it('строгость `name` — то, на чём держится разбор формы', () => {
    const flatWithoutName = { logo: MEDIA, favicon: MEDIA, primaryColor: null, socials: [] };

    expect(brandSchema.safeParse(flatWithoutName).success).toBe(false);
  });

  it('у v2 обнуляемые слоты работают так же поштучно', () => {
    const parsed = brandSchema.parse(v2({ logoLight: null, primaryColor: null }));

    expect(parsed.logo).toBeNull();
    expect(parsed.primaryColor).toBeNull();
    expect(parsed.name).toBe('Apex Capital');
    expect(parsed.favicon).toEqual(MEDIA);
  });

  it('лишние слоты v2 отбрасываются и не ломают разбор', () => {
    const parsed = brandSchema.parse(v2({ logoDark: MEDIA, emailLogo: MEDIA, somethingNew: 1 }));

    expect(parsed.name).toBe('Apex Capital');
    expect(parsed).not.toHaveProperty('logoDark');
  });

  it('v2 без имени сайта отвергается, как и legacy без имени', () => {
    const broken = v2();
    (broken.site as { name?: string }).name = '';

    expect(brandSchema.safeParse(broken).success).toBe(false);
  });
});

describe('heroBackground — необязательное поле бренда', () => {
  it.each([
    ['legacy', (v: unknown) => legacy({ heroBackground: v })],
    ['v2', (v: unknown) => v2({ heroBackground: v })],
  ])('%s: "off" и "quotes" доходят как есть', (_name, make) => {
    expect(brandSchema.parse(make('off')).heroBackground).toBe('off');
    expect(brandSchema.parse(make('quotes')).heroBackground).toBe('quotes');
  });

  it.each([
    ['legacy', (v: unknown) => legacy({ heroBackground: v })],
    ['v2', (v: unknown) => v2({ heroBackground: v })],
  ])('%s: мусор не роняет бренд, поле просто не задано', (_name, make) => {
    for (const junk of ['video', 1, null, {}]) {
      const parsed = brandSchema.parse(make(junk));
      expect(parsed.name).toBe('Apex Capital');
      expect(parsed.heroBackground).toBeUndefined();
    }
  });

  it('старые ответы без поля по-прежнему валидны', () => {
    for (const raw of [legacy(), v2()]) {
      const parsed = brandSchema.parse(raw);
      expect(parsed.name).toBe('Apex Capital');
      expect(parsed.heroBackground).toBeUndefined();
    }
  });
});

describe('legalEntity — юрлицо и лицензии из CMS', () => {
  const ENTITY = {
    name: 'Example Ltd',
    registrationNumber: 'EX-000000',
    address: '1 Example Street, Example City',
    licenses: [
      {
        number: 'LIC-0001',
        activity: 'Брокерская деятельность',
        regulator: 'Example Financial Authority',
        regulatorCountry: 'Exampleland',
        verifyUrl: 'https://register.example.test/firms/LIC-0001',
        document: {
          url: 'https://cms.example.test/api/media/file/license.pdf',
          filename: 'license.pdf',
          mimeType: 'application/pdf',
        },
      },
    ],
  };

  it('старая CMS без поля → null (строк в подвале нет)', () => {
    expect(brandSchema.parse(legacy()).legalEntity).toBeNull();
    expect(brandSchema.parse(v2()).legalEntity).toBeNull();
  });

  it('заполненное юрлицо разбирается целиком', () => {
    expect(brandSchema.parse(legacy({ legalEntity: ENTITY })).legalEntity).toEqual(ENTITY);
  });

  it.each([
    ['http', 'http://register.example.test/firms/1'],
    ['javascript:', 'javascript:alert(1)'],
    ['относительный', '/firms/1'],
    ['без точки в хосте', 'https://localhost/firms/1'],
    ['с учёткой', 'https://user:pass@register.example.test/'],
  ])('ссылка «Проверить лицензию» %s → null, лицензия остаётся', (_name, verifyUrl) => {
    const parsed = brandSchema.parse(
      legacy({ legalEntity: { ...ENTITY, licenses: [{ ...ENTITY.licenses[0], verifyUrl }] } }),
    );
    expect(parsed.legalEntity?.licenses[0]?.verifyUrl).toBeNull();
    expect(parsed.legalEntity?.licenses[0]?.number).toBe('LIC-0001');
  });

  it('не-PDF вместо файла лицензии → document = null', () => {
    const parsed = brandSchema.parse(
      legacy({
        legalEntity: {
          ...ENTITY,
          licenses: [{ ...ENTITY.licenses[0], document: { ...ENTITY.licenses[0]!.document, mimeType: 'image/png' } }],
        },
      }),
    );
    expect(parsed.legalEntity?.licenses[0]?.document).toBeNull();
  });

  it('пустые строки и пустые лицензии не дают юрлица', () => {
    const parsed = brandSchema.parse(
      legacy({
        legalEntity: {
          name: '  ',
          registrationNumber: '',
          address: null,
          licenses: [{ number: '', activity: null, regulator: '', verifyUrl: 'https://register.example.test/x' }],
        },
      }),
    );
    expect(parsed.legalEntity).toBeNull();
  });

  it('мусор вместо юрлица не роняет бренд', () => {
    for (const legalEntity of ['Example Ltd', 42, [], { licenses: 'LIC-0001' }]) {
      const parsed = brandSchema.parse(legacy({ legalEntity }));
      expect(parsed.name).toBe('Apex Capital');
      expect(parsed.socials).toEqual([SOCIAL]);
    }
    expect(brandSchema.parse(legacy({ legalEntity: { licenses: 'LIC-0001' } })).legalEntity).toBeNull();
  });

  it('битая лицензия выброшена, годные сохранены', () => {
    const parsed = brandSchema.parse(
      legacy({ legalEntity: { ...ENTITY, licenses: ['LIC', null, ENTITY.licenses[0]] } }),
    );
    expect(parsed.legalEntity?.licenses).toEqual(ENTITY.licenses);
  });
});
