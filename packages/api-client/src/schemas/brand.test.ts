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
    });
  });

  it('вложенный v2 приводится к той же форме', () => {
    expect(brandSchema.parse(v2())).toEqual({
      name: 'Apex Capital',
      logo: MEDIA,
      favicon: MEDIA,
      primaryColor: '#d4a437',
      socials: [SOCIAL],
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
