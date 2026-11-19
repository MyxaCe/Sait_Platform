import { describe, expect, it } from 'vitest';
import { accountOffers, promotionOffers } from './catalog';
import type { LivePortfolio, LivePromotion } from './snapshot';

const portfolio = (key: string, title: string): LivePortfolio => ({
  key,
  title,
  baseLeverage: 20,
  classOverrides: {},
  markupBps: 0,
  commissionBps: 0,
  isDefault: false,
  isPublic: true,
  sortOrder: 0,
  instruments: null,
  description: 'из админки',
});

describe('тарифы: портфели + тексты CMS', () => {
  const portfolios = [portfolio('standard', 'Standard'), portfolio('pro', 'Pro')];
  const plans = [
    { id: 'pro', description: 'Для активных', featured: true, features: [{ label: 'Поддержка', value: 'личный менеджер' }] },
    { id: 'gold', description: 'Нет такого портфеля', featured: false, features: [] },
  ];

  it('порядок и набор — из портфелей, тексты — по ключу', () => {
    const out = accountOffers(portfolios, plans);
    expect(out.map((o) => o.portfolio.key)).toEqual(['standard', 'pro']);
    expect(out[1]).toMatchObject({ description: 'Для активных', featured: true, features: [{ label: 'Поддержка', value: 'личный менеджер' }] });
  });

  it('портфель без описания в CMS показывается без описания', () => {
    expect(accountOffers(portfolios, plans)[0]).toMatchObject({ description: null, featured: false, features: [] });
    expect(accountOffers(portfolios, null).map((o) => o.description)).toEqual([null, null]);
  });

  it('portfolioKey важнее id: тариф ecn сопоставлен с портфелем enc_prime', () => {
    const out = accountOffers([portfolio('enc_prime', 'ECN Prime')], [
      { id: 'ecn', portfolioKey: 'enc_prime', description: 'Для профи' },
      { id: 'enc_prime', description: 'не тот' },
    ]);
    expect(out[0]!.description).toBe('Для профи');
  });

  it('тариф CMS без портфеля не показывается', () => {
    expect(accountOffers(portfolios, plans).some((o) => o.portfolio.key === 'gold')).toBe(false);
  });
});

describe('акции: движок + тексты CMS', () => {
  const promo = (over: Partial<LivePromotion>): LivePromotion => ({
    id: 'uuid-1',
    slug: 'cashback',
    type: 'cashback',
    cmsPromoId: null,
    startsAt: null,
    endsAt: null,
    texts: { ru: { title: 'Кешбэк', summary: 'Возврат', terms: 'Условия' }, en: { title: 'Cashback', summary: 'Back', terms: 'Terms' } },
    ...over,
  });
  const cms = [
    { id: 'cms-1', badge: 'Хит', title: 'Кешбэк из CMS', description: 'Описание CMS', terms: 'Условия CMS', ctaLabel: 'Участвовать', ctaHref: '/register?promo=cashback', featured: true, image: { url: '/a.png' } },
    { id: 'off', badge: 'x', title: 'Выключенная в движке', description: '', terms: '', ctaLabel: '', ctaHref: '', featured: false },
  ];

  it('набор — из движка; CMS по идентификатору акции', () => {
    const out = promotionOffers([promo({ cmsPromoId: 'cms-1' })], cms, 'ru');
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ title: 'Кешбэк из CMS', badge: 'Хит', featured: true, image: { url: '/a.png' } });
  });

  it('связь только через cms_promo_id: совпадение слага или id не считается', () => {
    const [o] = promotionOffers([promo({ slug: 'cms-1', id: 'cms-1' })], cms, 'ru');
    expect(o).toMatchObject({ title: 'Кешбэк', image: null, badge: null });
  });

  it('cms_promo_id без элемента CMS — название из движка, без картинки, акция не скрыта', () => {
    const out = promotionOffers([promo({ cmsPromoId: 'promo-404' })], cms, 'ru');
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ title: 'Кешбэк', image: null });
  });

  it('без текста в CMS — тексты из админки на языке страницы, ссылка на регистрацию с акцией', () => {
    const [o] = promotionOffers([promo({})], cms, 'de');
    expect(o).toMatchObject({ title: 'Cashback', description: 'Back', badge: null, ctaLabel: null, ctaHref: '/register?promo=cashback' });
  });

  it('текст CMS у акции, выключенной в движке, не показывается', () => {
    expect(promotionOffers([], cms, 'ru')).toEqual([]);
  });
});
