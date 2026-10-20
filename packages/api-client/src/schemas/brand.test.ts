import { describe, expect, it } from 'vitest';
import { brandSchema } from './cms';

/**
 * WEB-11: бренд читается ПО ПОЛЯМ и из ОБЕИХ форм ответа.
 *
 * **Дефект, которого здесь больше нет.** Жёсткость потребителя
 * превращается в подмену данных: один негодный слот отвергал **весь**
 * ответ, `cmsFetch` уходил на фикстуру, и витрина показывала чужое имя
 * и чужой логотип **при живой CMS, без единой ошибки на странице**.
 * Нашла команда `terminal` у себя; у нас было то же, просто проверено
 * против одного поля — `primaryColor`, того, на котором обожглись
 * (WEB-14). В `public-brand.v1` обнуляем ВОСЕМЬ полей.
 *
 * **Почему проверка идёт по каждому полю отдельно, а не «ответ с
 * нулями».** Отсутствие одного необязательного поля не доказывает
 * отсутствия остальных: ответ, где обнулено всё сразу, прошёл бы и при
 * схеме, которая роняет бренд от любого одного негодного слота.
 * Вырожденная фикстура даёт зелёный тест вместо проверки.
 */

const MEDIA = {
  url: 'https://cdn.example/logo.svg',
  width: 120,
  height: 32,
  alt: 'Apex',
  mimeType: 'image/svg+xml',
};

const SOCIAL = { name: 'telegram', url: 'https://t.me/apex' };

/** Плоский ответ legacy — то, что контур отдаёт сегодня. */
const legacy = (over: Record<string, unknown> = {}) => ({
  name: 'Apex Capital',
  logo: MEDIA,
  favicon: MEDIA,
  primaryColor: '#d4a437',
  socials: [SOCIAL],
  ...over,
});

/** Вложенный ответ `public-brand.v1` — то, что отдаст v2. */
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

/* ------------------------------------------------------------------ */
/* 1. Каждое обнуляемое поле — по отдельности                           */
/* ------------------------------------------------------------------ */

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
    // Главное утверждение задачи: бренд НЕ подменён фикстурой.
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

/* ------------------------------------------------------------------ */
/* 2. Что осталось жёстким — и это решение, а не недосмотр              */
/* ------------------------------------------------------------------ */

describe('имя бренда остаётся обязательным', () => {
  it('поля нет вовсе → ответ отвергнут целиком', () => {
    // Собирается удалением ключа, а не подстановкой: `{...base, ...{} }`
    // ключ не убирает, и первая версия этого теста прошла бы при любой
    // схеме. Фикстура — тоже часть теста.
    const { name: _dropped, ...withoutName } = legacy();

    expect(brandSchema.safeParse(withoutName).success).toBe(false);
  });

  it.each([
    ['пустая строка', ''],
    ['null', null],
    ['число', 42],
  ])('имя %s → ответ отвергнут целиком, и это правильный исход', (_name, value) => {
    // Бренд без имени нечем показать, и подставлять сюда нечего: уход на
    // фикстуру здесь — верный ответ, а не подмена. Названо тестом, чтобы
    // следующий не «дозакрыл» поле `.catch()` ради единообразия.
    expect(brandSchema.safeParse(legacy({ name: value })).success).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* 3. Соцсети выбрасываются поштучно                                    */
/* ------------------------------------------------------------------ */

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

/* ------------------------------------------------------------------ */
/* 4. Две формы ответа                                                  */
/* ------------------------------------------------------------------ */

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
    // Момент переезда контура и момент нашей выкатки друг другу не
    // подчиняются: знающий одну форму остаётся без бренда либо до
    // переезда, либо после.
    expect(brandSchema.parse(v2())).toEqual({
      name: 'Apex Capital',
      logo: MEDIA,
      favicon: MEDIA,
      primaryColor: '#d4a437',
      socials: [SOCIAL],
    });
  });

  it('РАСТЯЖКА: v2 не проваливается в плоскую ветвь как «бренд без полей»', () => {
    // Проверяется наблюдаемым различием: имя берётся из `site.name`, а
    // логотип из `brand.logoLight` — у плоской ветви их взять неоткуда.
    const parsed = brandSchema.parse(v2());

    expect(parsed.name).toBe('Apex Capital');
    expect(parsed.logo).not.toBeNull();
  });

  /**
   * МУТАЦИЯ, КОТОРУЮ НЕЛЬЗЯ ПОКРАСИТЬ — и это измерено, а не
   * предположено.
   *
   * Перестановка ветвей (`[brandLegacySchema, brandV2Schema]`) красит
   * **ноль** тестов. Причина не в слабости набора: на вложенном ответе
   * плоская ветвь честно отказывает, потому что `name` у неё строгое, а
   * на верхнем уровне v2 никакого `name` нет. То есть сегодня порядок
   * ветвей ни на что не влияет.
   *
   * **Но он влияет завтра, и это тоже измерено.** Снять строгость с
   * `name` И переставить ветви — и четыре теста формы v2 краснеют:
   * плоская ветвь начинает принимать вложенный ответ как «бренд без
   * полей» и молча отдавать пустой бренд. То есть порядок — второй
   * эшелон, который держится на строгости `name`.
   *
   * Названо вслух по двум причинам сразу: чтобы порядок не «упростили»
   * как бессмысленный, и чтобы следующий не писал бесполезную проверку,
   * пытаясь закрыть этот пункт ради полноты. Связь закреплена тестом
   * ниже — он и есть то, что делает зависимость видимой.
   */
  it('строгость `name` — то, на чём держится разбор формы', () => {
    // Снятие строгости здесь сделает значимым порядок ветвей в union.
    // Тот, кто вздумает смягчить `name`, увидит этот тест и вспомнит.
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
    // Дисциплина версионирования: неизвестное поле потребитель
    // отбрасывает и работает дальше, а не падает.
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
