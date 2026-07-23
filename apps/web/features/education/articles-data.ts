/** Мок обучающих статей (RU + EN). При подключении CMS заменяется на fetch. */

export type ArticleLevel = 'beginner' | 'intermediate';

export interface EducationArticle {
  slug: string;
  title: string;
  excerpt: string;
  level: ArticleLevel;
  readingMinutes: number;
  body: string[];
}

const RU: EducationArticle[] = [
  {
    slug: 'what-is-forex',
    title: 'Что такое Forex и как устроен валютный рынок',
    excerpt:
      'Крупнейший финансовый рынок мира с оборотом $7.5 трлн в день: кто на нём торгует, откуда берётся цена и что означает валютная пара.',
    level: 'beginner',
    readingMinutes: 7,
    body: [
      'Forex (Foreign Exchange) — глобальный внебиржевой рынок обмена валют. В отличие от фондовой биржи у него нет единой площадки: сделки заключаются напрямую между банками, фондами, компаниями и брокерами по всему миру, 24 часа в сутки с понедельника по пятницу.',
      'Базовая единица рынка — валютная пара. Запись EURUSD = 1.0850 означает, что за 1 евро дают 1.0850 доллара. Первая валюта в паре называется базовой, вторая — котируемой. Покупая пару, вы покупаете базовую валюту за котируемую; продавая — наоборот.',
      'Цена формируется потоком заявок крупнейших участников — маркетмейкеров и банков первого эшелона. Брокер агрегирует эти потоки ликвидности и транслирует лучшие цены клиентам. Разница между ценой покупки (Ask) и продажи (Bid) называется спредом — это основная транзакционная издержка трейдера.',
      'Минимальное изменение цены — пункт (pip). Для большинства пар это четвёртый знак после запятой: движение EURUSD с 1.0850 до 1.0851 — один пункт. Стандартный лот равен 100 000 единиц базовой валюты, при этом современные брокеры позволяют торговать от 0.01 лота.',
      'Начинать стоит с демо-счёта: он полностью повторяет реальную торговлю, но без риска для капитала. Отработайте на нём механику ордеров, стоп-лоссов и расчёт размера позиции — и только затем переходите на реальный счёт с суммой, потерю которой вы можете себе позволить.',
    ],
  },
  {
    slug: 'leverage-risk-management',
    title: 'Кредитное плечо: как использовать его без лишнего риска',
    excerpt:
      'Плечо 1:500 может умножить и прибыль, и убыток. Разбираем маржу, свободные средства и главное правило — риск на сделку не более 1–2%.',
    level: 'beginner',
    readingMinutes: 6,
    body: [
      'Кредитное плечо позволяет открывать позиции, превышающие собственный капитал. При плече 1:100 для позиции в 1 лот EURUSD (100 000 €) достаточно залога около 1 000 €. Этот залог называется маржой — он блокируется на счёте, пока позиция открыта.',
      'Важно понимать: плечо умножает не только потенциальную прибыль, но и убыток. Движение цены на 1% против позиции с плечом 1:100 означает потерю 100% маржи. Именно поэтому опытные трейдеры используют лишь малую часть доступного плеча.',
      'Ключевая метрика — уровень маржи: отношение средств к использованной марже. Когда он падает до уровня Margin Call, брокер предупреждает о нехватке средств; на уровне Stop Out позиции начинают закрываться принудительно. Защита от отрицательного баланса гарантирует, что вы не потеряете больше депозита.',
      'Практическое правило: рискуйте в одной сделке не более чем 1–2% депозита. Размер позиции рассчитывается от стоп-лосса, а не наоборот: сначала определите, где ваша идея становится неверной, затем подберите объём так, чтобы убыток при срабатывании стопа не превысил допустимый риск.',
    ],
  },
  {
    slug: 'technical-analysis-basics',
    title: 'Технический анализ: пять базовых инструментов',
    excerpt:
      'Уровни поддержки и сопротивления, тренд, скользящие средние, RSI и объём — минимальный набор, с которого начинается чтение графика.',
    level: 'intermediate',
    readingMinutes: 8,
    body: [
      'Технический анализ исходит из того, что вся доступная информация уже отражена в цене, а поведение толпы повторяется. Его задача — не предсказать будущее, а найти зоны, где соотношение потенциальной прибыли к риску складывается в пользу трейдера.',
      'Уровни поддержки и сопротивления — фундамент анализа. Это ценовые зоны, где ранее разворачивался или тормозил рынок: у продавцов и покупателей там сосредоточены интересы. Чем больше касаний уровня и чем он «старше», тем значимее реакция.',
      'Тренд определяет контекст: последовательность повышающихся максимумов и минимумов — восходящий, понижающихся — нисходящий. Торговля по тренду статистически надёжнее контртрендовых сделок, поэтому первый вопрос к графику — «куда движется рынок на старшем таймфрейме?».',
      'Скользящие средние (MA) сглаживают шум и визуализируют тренд. Популярные периоды — 20, 50 и 200. Цена выше MA200 — глобальный контекст бычий; пересечения быстрых и медленных средних используют как фильтр сигналов, а не как самостоятельную систему.',
      'Индекс относительной силы (RSI) измеряет скорость движения: значения выше 70 указывают на перекупленность, ниже 30 — на перепроданность. В сильном тренде RSI может оставаться в крайних зонах долго, поэтому сигналы индикатора всегда проверяют по уровням и структуре рынка.',
      'Объём подтверждает движение: пробой уровня на растущем объёме заслуживает доверия, тонкий безобъёмный вынос — часто ловушка. Сочетание этих пяти инструментов покрывает 90% потребностей начинающего технического аналитика.',
    ],
  },
  {
    slug: 'trading-psychology',
    title: 'Психология трейдинга: почему дисциплина важнее прогнозов',
    excerpt:
      'Тильт, страх упущенной прибыли и месть рынку разрушают депозиты быстрее плохой стратегии. Как построить процесс, который защищает от самого себя.',
    level: 'intermediate',
    readingMinutes: 6,
    body: [
      'Статистика брокеров показывает: большинство убыточных счетов гибнут не от плохого анализа, а от нарушения собственных правил. Рынок — среда неопределённости, и психика реагирует на неё древними механизмами: страхом, жадностью и стремлением немедленно отыграться.',
      'Тильт — состояние, когда после убытка трейдер увеличивает объёмы и входит в сделки без сетапа, пытаясь «вернуть своё». Единственная рабочая защита — жёсткие лимиты: дневной лимит убытка (например, 3% депозита), после которого торговля прекращается до следующего дня.',
      'Страх упущенной прибыли (FOMO) заставляет догонять уже состоявшееся движение — входить по худшей цене с непонятным стопом. Противоядие: письменный торговый план, где заранее описаны условия входа. Нет условий — нет сделки, сколько бы ни «улетал» график.',
      'Ведите журнал сделок: скриншот входа, причина, эмоциональное состояние, результат. Через 50–100 записей вы увидите собственные систематические ошибки — это самая ценная аналитика, которую не даст ни один индикатор. Дисциплина — не черта характера, а процесс, который можно спроектировать.',
    ],
  },
];

const EN: EducationArticle[] = [
  {
    slug: 'what-is-forex',
    title: 'What is Forex and how the currency market works',
    excerpt:
      "The world's largest financial market with $7.5 trillion in daily turnover: who trades on it, where the price comes from and what a currency pair means.",
    level: 'beginner',
    readingMinutes: 7,
    body: [
      'Forex (Foreign Exchange) is the global over-the-counter currency market. Unlike a stock exchange it has no single venue: deals are struck directly between banks, funds, companies and brokers around the world, 24 hours a day from Monday to Friday.',
      'The basic unit of the market is the currency pair. EURUSD = 1.0850 means one euro buys 1.0850 dollars. The first currency in the pair is called the base currency, the second — the quote currency. Buying the pair means buying the base currency with the quote currency; selling is the opposite.',
      'The price is formed by the order flow of the largest participants — market makers and top-tier banks. A broker aggregates these liquidity streams and passes the best prices to clients. The difference between the buy (Ask) and sell (Bid) price is the spread — the main transaction cost for a trader.',
      "The minimum price increment is a pip. For most pairs it's the fourth decimal place: a move in EURUSD from 1.0850 to 1.0851 is one pip. A standard lot equals 100,000 units of the base currency, while modern brokers let you trade from 0.01 lots.",
      "Start with a demo account: it fully replicates live trading with zero risk to your capital. Practice order mechanics, stop losses and position sizing there — and only then move to a live account with an amount you can afford to lose.",
    ],
  },
  {
    slug: 'leverage-risk-management',
    title: 'Leverage: how to use it without unnecessary risk',
    excerpt:
      '1:500 leverage can multiply both profit and loss. We break down margin, free equity and the main rule — risk no more than 1–2% per trade.',
    level: 'beginner',
    readingMinutes: 6,
    body: [
      'Leverage lets you open positions larger than your own capital. With 1:100 leverage, a 1-lot EURUSD position (€100,000) requires only about €1,000 of collateral. That collateral is called margin — it is locked on your account while the position is open.',
      'Understand this clearly: leverage multiplies not only potential profit but also loss. A 1% price move against a position at 1:100 leverage means losing 100% of the margin. That is exactly why experienced traders use only a small part of the available leverage.',
      'The key metric is margin level: equity divided by used margin. When it falls to the Margin Call level the broker warns you about insufficient funds; at the Stop Out level positions start closing forcibly. Negative balance protection guarantees you will never lose more than your deposit.',
      'A practical rule: risk no more than 1–2% of your deposit per trade. Position size is derived from the stop loss, not the other way round: first decide where your idea becomes invalid, then choose a volume so that the loss at your stop does not exceed your risk allowance.',
    ],
  },
  {
    slug: 'technical-analysis-basics',
    title: 'Technical analysis: five essential tools',
    excerpt:
      'Support and resistance, trend, moving averages, RSI and volume — the minimal toolkit that chart reading starts with.',
    level: 'intermediate',
    readingMinutes: 8,
    body: [
      "Technical analysis assumes that all available information is already reflected in the price and that crowd behavior repeats. Its job is not to predict the future but to find zones where the reward-to-risk ratio favors the trader.",
      'Support and resistance levels are the foundation. These are price zones where the market previously reversed or stalled: buyer and seller interest is concentrated there. The more touches a level has and the “older” it is, the more significant the reaction.',
      'The trend defines context: a sequence of higher highs and higher lows is an uptrend; lower highs and lower lows — a downtrend. Trading with the trend is statistically more reliable than counter-trend trades, so the first question to any chart is: “where is the market going on the higher timeframe?”',
      'Moving averages (MA) smooth out noise and visualize the trend. Popular periods are 20, 50 and 200. Price above the MA200 means the global context is bullish; crossovers of fast and slow averages are used as a signal filter, not as a standalone system.',
      'The Relative Strength Index (RSI) measures momentum: readings above 70 suggest overbought conditions, below 30 — oversold. In a strong trend the RSI can stay in extreme zones for a long time, so indicator signals are always cross-checked against levels and market structure.',
      'Volume confirms the move: a breakout on rising volume deserves trust, while a thin, volume-less spike is often a trap. Together these five tools cover 90% of a beginning technical analyst’s needs.',
    ],
  },
  {
    slug: 'trading-psychology',
    title: 'Trading psychology: why discipline beats predictions',
    excerpt:
      'Tilt, fear of missing out and revenge trading destroy deposits faster than a bad strategy. How to build a process that protects you from yourself.',
    level: 'intermediate',
    readingMinutes: 6,
    body: [
      'Broker statistics show that most losing accounts die not from bad analysis but from breaking one’s own rules. The market is an environment of uncertainty, and the mind reacts to it with ancient mechanisms: fear, greed and the urge to win it back immediately.',
      'Tilt is the state where, after a loss, a trader increases size and enters trades without a setup, trying to “get their money back”. The only working protection is hard limits: a daily loss limit (for example, 3% of the deposit) after which trading stops until the next day.',
      'Fear of missing out (FOMO) makes you chase a move that has already happened — entering at a worse price with an unclear stop. The antidote is a written trading plan that defines entry conditions in advance. No conditions — no trade, no matter how far the chart “flies away”.',
      'Keep a trade journal: entry screenshot, reason, emotional state, result. After 50–100 entries you will see your own systematic mistakes — the most valuable analytics no indicator can give you. Discipline is not a character trait but a process you can engineer.',
    ],
  },
];

export function getEducationArticles(locale: string): EducationArticle[] {
  return locale === 'en' ? EN : RU;
}

export function findEducationArticle(slug: string, locale: string): EducationArticle | undefined {
  return getEducationArticles(locale).find((a) => a.slug === slug);
}

export const EDUCATION_SLUGS = RU.map((a) => a.slug);
export const EDUCATION_ARTICLES = RU;
