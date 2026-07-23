/**
 * Мок-источник новостей (RU + EN). При подключении CMS/новостного API
 * заменяется на fetch к /v1/news?locale=… — форма данных сохранится.
 */

export type NewsCategory = 'forex' | 'stocks' | 'crypto' | 'economy';

export const NEWS_CATEGORY_LABELS: Record<string, Record<NewsCategory, string>> = {
  ru: { forex: 'Forex', stocks: 'Акции', crypto: 'Криптовалюты', economy: 'Экономика' },
  en: { forex: 'Forex', stocks: 'Stocks', crypto: 'Crypto', economy: 'Economy' },
};

export interface NewsArticle {
  slug: string;
  title: string;
  excerpt: string;
  category: NewsCategory;
  source: string;
  publishedAt: string;
  readingMinutes: number;
  body: string[];
}

const RU: NewsArticle[] = [
  {
    slug: 'fed-signals-rate-path-september',
    title: 'ФРС даёт сигнал о траектории ставки: рынки закладывают снижение в сентябре',
    excerpt:
      'Протокол июльского заседания показал растущее число сторонников смягчения. Доллар ослаб к корзине основных валют, доходности казначейских облигаций снизились.',
    category: 'economy',
    source: 'Аналитический отдел Apex Capital',
    publishedAt: '2026-07-23T08:30:00Z',
    readingMinutes: 4,
    body: [
      'Опубликованный накануне протокол заседания Федеральной резервной системы показал, что большинство членов комитета считает целесообразным начать цикл смягчения уже на сентябрьском заседании, если инфляционная динамика сохранится. Фьючерсы на ставку закладывают вероятность снижения на 25 б.п. в 78%.',
      'Индекс доллара DXY отреагировал снижением на 0.4%, пара EURUSD поднялась к отметке 1.0850. Доходность 10-летних казначейских облигаций опустилась ниже 4.1% — минимума за последние шесть недель.',
      'Для трейдеров ключевым событием недели остаётся публикация базового индекса PCE в пятницу: показатель выше прогноза способен быстро развернуть ожидания рынка и вернуть спрос на доллар.',
    ],
  },
  {
    slug: 'gold-tests-record-highs',
    title: 'Золото тестирует исторические максимумы на фоне слабеющего доллара',
    excerpt:
      'XAUUSD прибавляет третью сессию подряд. Аналитики называют цели в диапазоне $2 450–2 480 при закреплении выше $2 420.',
    category: 'forex',
    source: 'Аналитический отдел Apex Capital',
    publishedAt: '2026-07-23T06:10:00Z',
    readingMinutes: 3,
    body: [
      'Котировки золота обновили недельный максимум и торгуются в районе $2 417 за унцию. Поддержку металлу оказывают ожидания снижения ставки ФРС и продолжающиеся покупки со стороны центральных банков Азии.',
      'Технически цена удерживается выше 20-дневной скользящей средней, а индекс относительной силы ещё не достиг зоны перекупленности. Ближайшее сопротивление — $2 431, далее — исторический максимум.',
      'Риском для быков остаётся сильная макростатистика США: неожиданно высокие данные по занятости или инфляции способны спровоцировать коррекцию к поддержке $2 380.',
    ],
  },
  {
    slug: 'nvidia-earnings-preview',
    title: 'Отчёт NVIDIA: чего ждать рынку от главного бенефициара ИИ-бума',
    excerpt:
      'Консенсус ожидает выручку $37.5 млрд. Опционный рынок закладывает движение акций на ±9% после публикации.',
    category: 'stocks',
    source: 'Аналитический отдел Apex Capital',
    publishedAt: '2026-07-22T15:45:00Z',
    readingMinutes: 5,
    body: [
      'На следующей неделе NVIDIA представит квартальную отчётность, которая традиционно задаёт тон всему технологическому сектору. Консенсус-прогноз аналитиков предполагает выручку $37.5 млрд (+62% год к году) и скорректированную прибыль $0.95 на акцию.',
      'Ключевой вопрос — динамика сегмента дата-центров и комментарии менеджмента о спросе на новое поколение ускорителей. Любой намёк на замедление заказов гиперскейлеров рынок воспримет болезненно: бумага торгуется с мультипликатором P/E выше 45.',
      'Опционный рынок закладывает движение на ±9% в день после отчёта. Для держателей CFD на NVDA это означает повышенные требования к управлению риском: рекомендуем заранее определить уровни выхода и не превышать стандартный размер позиции.',
    ],
  },
  {
    slug: 'bitcoin-etf-inflows-resume',
    title: 'Приток средств в биткоин-ETF возобновился: $850 млн за неделю',
    excerpt:
      'После трёх недель оттока спотовые ETF снова привлекают капитал. BTCUSD консолидируется у $67 500, ключевое сопротивление — $69 000.',
    category: 'crypto',
    source: 'Аналитический отдел Apex Capital',
    publishedAt: '2026-07-22T11:20:00Z',
    readingMinutes: 3,
    body: [
      'Согласно данным провайдеров, чистый приток в американские спотовые биткоин-ETF за прошедшую неделю составил $850 млн — лучший результат за полтора месяца. Основной объём пришёлся на фонды крупнейших управляющих компаний.',
      'Курс биткоина консолидируется в диапазоне $66 000–68 000. Закрепление выше $69 000 откроет дорогу к повторному тесту исторического максимума, тогда как потеря поддержки $64 500 усилит давление продавцов.',
      'Волатильность эфириума остаётся повышенной в преддверии решения регулятора по заявкам на стейкинг в составе ETF — событие способно стать катализатором для всего альткоин-сегмента.',
    ],
  },
  {
    slug: 'ecb-holds-rates-lagarde-comments',
    title: 'ЕЦБ сохранил ставки: Лагард указала на сентябрь как «открытое окно»',
    excerpt:
      'Регулятор ожидаемо взял паузу. Евро укрепился после пресс-конференции: рынок услышал меньше «голубиных» сигналов, чем рассчитывал.',
    category: 'economy',
    source: 'Аналитический отдел Apex Capital',
    publishedAt: '2026-07-21T14:00:00Z',
    readingMinutes: 4,
    body: [
      'Европейский центральный банк оставил ключевые ставки без изменений, взяв паузу после июньского снижения. Решение совпало с ожиданиями рынка, поэтому основное внимание было приковано к риторике главы регулятора.',
      'Кристин Лагард отметила, что сентябрьское заседание остаётся «полностью открытым», а дальнейшие решения будут зависеть от поступающих данных. Отсутствие явных обещаний смягчения рынок расценил как умеренно ястребиный сигнал.',
      'Пара EURUSD прибавила 0.3% на пресс-конференции. Спред между доходностями немецких и американских десятилетних бумаг сузился до минимума с весны, поддерживая единую валюту.',
    ],
  },
  {
    slug: 'oil-inventories-draw-opec-outlook',
    title: 'Запасы нефти в США сокращаются пятую неделю подряд',
    excerpt:
      'Минэнерго отчиталось о снижении запасов на 3.7 млн баррелей. Brent удерживается выше $85 в ожидании отчёта ОПЕК.',
    category: 'economy',
    source: 'Аналитический отдел Apex Capital',
    publishedAt: '2026-07-21T09:05:00Z',
    readingMinutes: 3,
    body: [
      'Коммерческие запасы сырой нефти в США за неделю снизились на 3.7 млн баррелей при прогнозе −1.9 млн. Серия из пяти недель сокращения — самая длинная с прошлого лета и указывает на устойчивый спрос в разгар автомобильного сезона.',
      'Котировки Brent удерживаются выше $85 за баррель, WTI торгуется у $81.6. Трейдеры ожидают ежемесячный отчёт ОПЕК: подтверждение прогноза роста мирового спроса поддержит текущий восходящий импульс.',
      'Сдерживающим фактором остаётся динамика добычи вне картеля: рекордные объёмы из США и Бразилии ограничивают потенциал ралли выше $90 без дополнительных шоков предложения.',
    ],
  },
];

const EN: NewsArticle[] = [
  {
    slug: 'fed-signals-rate-path-september',
    title: 'Fed signals its rate path: markets price in a September cut',
    excerpt:
      'The July meeting minutes revealed a growing number of easing supporters. The dollar weakened against major currencies and Treasury yields declined.',
    category: 'economy',
    source: 'Apex Capital Research Desk',
    publishedAt: '2026-07-23T08:30:00Z',
    readingMinutes: 4,
    body: [
      'The Federal Reserve meeting minutes published yesterday showed that most committee members consider it appropriate to begin the easing cycle as early as the September meeting, provided inflation dynamics hold. Rate futures now price a 78% probability of a 25 bp cut.',
      'The DXY dollar index reacted with a 0.4% decline while EURUSD climbed toward 1.0850. The 10-year Treasury yield slipped below 4.1% — a six-week low.',
      "For traders, the key event of the week remains Friday's core PCE release: a print above forecast could quickly reverse market expectations and bring demand back to the dollar.",
    ],
  },
  {
    slug: 'gold-tests-record-highs',
    title: 'Gold tests record highs as the dollar weakens',
    excerpt:
      'XAUUSD gains for a third consecutive session. Analysts see targets in the $2,450–2,480 range if the price holds above $2,420.',
    category: 'forex',
    source: 'Apex Capital Research Desk',
    publishedAt: '2026-07-23T06:10:00Z',
    readingMinutes: 3,
    body: [
      'Gold refreshed its weekly high and trades around $2,417 per ounce. The metal is supported by expectations of a Fed rate cut and continued purchases by Asian central banks.',
      'Technically, the price holds above the 20-day moving average, and the RSI has not yet reached overbought territory. Nearest resistance sits at $2,431, followed by the all-time high.',
      'The main risk for bulls remains strong US macro data: unexpectedly high employment or inflation numbers could trigger a correction toward support at $2,380.',
    ],
  },
  {
    slug: 'nvidia-earnings-preview',
    title: "NVIDIA earnings preview: what to expect from the AI boom's biggest beneficiary",
    excerpt:
      'Consensus expects $37.5bn in revenue. The options market prices a ±9% move in the shares after the release.',
    category: 'stocks',
    source: 'Apex Capital Research Desk',
    publishedAt: '2026-07-22T15:45:00Z',
    readingMinutes: 5,
    body: [
      'Next week NVIDIA reports quarterly results that traditionally set the tone for the entire tech sector. The analyst consensus calls for $37.5bn in revenue (+62% YoY) and adjusted EPS of $0.95.',
      'The key question is data-center momentum and management commentary on demand for the new generation of accelerators. Any hint of slowing hyperscaler orders would be taken badly: the stock trades at a P/E above 45.',
      'The options market prices a ±9% move the day after the report. For NVDA CFD holders this means elevated risk management requirements: define exit levels in advance and avoid exceeding your standard position size.',
    ],
  },
  {
    slug: 'bitcoin-etf-inflows-resume',
    title: 'Bitcoin ETF inflows resume: $850M in a week',
    excerpt:
      'After three weeks of outflows, spot ETFs are attracting capital again. BTCUSD consolidates near $67,500 with key resistance at $69,000.',
    category: 'crypto',
    source: 'Apex Capital Research Desk',
    publishedAt: '2026-07-22T11:20:00Z',
    readingMinutes: 3,
    body: [
      'According to provider data, net inflows into US spot bitcoin ETFs reached $850M over the past week — the best result in a month and a half. Most of the volume went to funds run by the largest asset managers.',
      'Bitcoin consolidates in the $66,000–68,000 range. A break above $69,000 would open the way to a retest of the all-time high, while losing support at $64,500 would strengthen selling pressure.',
      "Ethereum volatility remains elevated ahead of the regulator's decision on staking within ETFs — an event that could become a catalyst for the entire altcoin segment.",
    ],
  },
  {
    slug: 'ecb-holds-rates-lagarde-comments',
    title: 'ECB holds rates: Lagarde points to September as an “open window”',
    excerpt:
      'The regulator paused as expected. The euro strengthened after the press conference: the market heard fewer dovish signals than it had hoped for.',
    category: 'economy',
    source: 'Apex Capital Research Desk',
    publishedAt: '2026-07-21T14:00:00Z',
    readingMinutes: 4,
    body: [
      "The European Central Bank left key rates unchanged, pausing after June's cut. The decision matched market expectations, so attention focused on the president's rhetoric.",
      'Christine Lagarde noted that the September meeting remains “wide open” and that further decisions will depend on incoming data. The absence of explicit easing promises was read by the market as a mildly hawkish signal.',
      'EURUSD added 0.3% during the press conference. The spread between German and US 10-year yields narrowed to its tightest since spring, supporting the single currency.',
    ],
  },
  {
    slug: 'oil-inventories-draw-opec-outlook',
    title: 'US oil inventories fall for a fifth straight week',
    excerpt:
      'The EIA reported a 3.7M-barrel draw. Brent holds above $85 ahead of the OPEC report.',
    category: 'economy',
    source: 'Apex Capital Research Desk',
    publishedAt: '2026-07-21T09:05:00Z',
    readingMinutes: 3,
    body: [
      'US commercial crude inventories fell by 3.7 million barrels last week against a forecast of −1.9M. Five consecutive weeks of draws — the longest streak since last summer — point to robust demand at the peak of driving season.',
      'Brent holds above $85 per barrel while WTI trades near $81.6. Traders await the monthly OPEC report: confirmation of the global demand growth forecast would support the current upward impulse.',
      'Non-OPEC supply remains the limiting factor: record output from the US and Brazil caps the potential for a rally above $90 without additional supply shocks.',
    ],
  },
];

export function getNewsArticles(locale: string): NewsArticle[] {
  return locale === 'en' ? EN : RU;
}

export function findArticle(slug: string, locale: string): NewsArticle | undefined {
  return getNewsArticles(locale).find((a) => a.slug === slug);
}

/** Слаги одинаковы для всех локалей — для generateStaticParams и sitemap */
export const NEWS_SLUGS = RU.map((a) => a.slug);
export const NEWS_ARTICLES = RU;
