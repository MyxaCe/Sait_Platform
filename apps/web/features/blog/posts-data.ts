/** Мок пресс-центра/блога компании (RU + EN). При подключении CMS заменяется на fetch. */

export type BlogCategory = 'company' | 'product' | 'events';

export interface BlogPost {
  slug: string;
  title: string;
  excerpt: string;
  category: BlogCategory;
  publishedAt: string;
  readingMinutes: number;
  body: string[];
}

const RU: BlogPost[] = [
  {
    slug: 'new-web-platform-pwa',
    title: 'Запускаем новую веб-платформу: PWA, живые котировки и тёмная тема',
    excerpt:
      'Полностью переработанный сайт: установка как приложение в один клик, котировки в реальном времени на каждой странице и скорость загрузки менее секунды.',
    category: 'product',
    publishedAt: '2026-07-20T09:00:00Z',
    readingMinutes: 3,
    body: [
      'Сегодня мы представляем новую веб-платформу Apex Capital. Сайт построен с нуля на современном стеке и проектировался в первую очередь для мобильных устройств — именно с них к нам приходит каждый второй клиент.',
      'Главное новшество — установка как приложения в один клик, без магазинов приложений. Нажмите «Установить приложение» на главной странице, и Apex Capital появится на домашнем экране: полноэкранный режим, мгновенный запуск и работа основных разделов даже без сети.',
      'Котировки по 33 инструментам теперь обновляются в реальном времени на каждой странице, а экономический календарь и лента аналитики помогают не пропустить события, которые двигают рынок. Впереди — запуск обновлённого личного кабинета и веб-терминала на этой же технологической базе.',
    ],
  },
  {
    slug: 'q2-2026-results',
    title: 'Итоги II квартала 2026: рекордный оборот и 90 000 новых счетов',
    excerpt:
      'Квартальный оборот превысил $260 млрд, среднее время исполнения снизилось до 14 мс, а автоматическая обработка выводов достигла 92%.',
    category: 'company',
    publishedAt: '2026-07-08T10:00:00Z',
    readingMinutes: 4,
    body: [
      'Второй квартал 2026 года стал самым результативным в истории компании. Совокупный торговый оборот составил $261 млрд — на 18% больше, чем кварталом ранее. Клиенты открыли 90 000 новых счетов, а число активных трейдеров превысило 1.24 миллиона.',
      'Инвестиции в инфраструктуру дали измеримый результат: среднее время исполнения ордера снизилось с 21 до 14 мс, а доля заявок на вывод, обрабатываемых автоматически за считанные минуты, выросла до 92%.',
      'В третьем квартале мы сосредоточимся на запуске обновлённой экосистемы: новый личный кабинет, веб-терминал и расширение линейки инструментов до 15 000 позиций.',
    ],
  },
  {
    slug: 'new-instruments-summer-2026',
    title: '120 новых инструментов: азиатские акции и товарные CFD',
    excerpt:
      'В линейке появились акции бирж Токио и Гонконга, а также CFD на какао, кофе и пшеницу — по запросам клиентов.',
    category: 'product',
    publishedAt: '2026-06-24T08:30:00Z',
    readingMinutes: 3,
    body: [
      'Мы расширили торговую линейку на 120 инструментов. Самый крупный блок — акции азиатского региона: 70 бумаг с Токийской биржи и 30 с Гонконгской, включая Toyota, Sony, Alibaba и Tencent.',
      'Вторая группа — сельскохозяйственные товарные CFD: какао, кофе арабика, сахар и пшеница. Товарный сегмент показал в этом году рекордную волатильность, и трейдеры просили дать к нему доступ чаще всего.',
      'Все новые инструменты доступны на всех типах счетов с сегодняшнего дня. Полный список — в разделе «Торговые инструменты».',
    ],
  },
  {
    slug: 'apex-forex-expo-2026',
    title: 'Apex Capital на Forex Expo Dubai 2026: приходите на стенд A-12',
    excerpt:
      '14–15 октября встречаемся на крупнейшей выставке индустрии: живые разборы рынка, встречи с аналитиками и специальные условия для посетителей.',
    category: 'events',
    publishedAt: '2026-06-10T12:00:00Z',
    readingMinutes: 2,
    body: [
      '14–15 октября команда Apex Capital будет работать на Forex Expo Dubai — крупнейшей выставке трейдинговой индустрии региона. Наш стенд A-12 находится в центральном зале World Trade Centre.',
      'В программе — живые торговые разборы от руководителя аналитического отдела Анны Верещагиной, консультации по партнёрской программе и презентация новой веб-платформы. Для посетителей стенда действуют специальные условия открытия счёта.',
      'Вход на выставку бесплатный по предварительной регистрации на сайте организатора. До встречи в Дубае!',
    ],
  },
];

const EN: BlogPost[] = [
  {
    slug: 'new-web-platform-pwa',
    title: 'Launching our new web platform: PWA, live quotes and dark theme',
    excerpt:
      'A completely rebuilt website: one-click app installation, real-time quotes on every page and sub-second load times.',
    category: 'product',
    publishedAt: '2026-07-20T09:00:00Z',
    readingMinutes: 3,
    body: [
      'Today we present the new Apex Capital web platform. The site was rebuilt from scratch on a modern stack and designed mobile-first — every second client comes to us from a phone.',
      'The headline feature is one-click app installation with no app stores. Tap “Install App” on the home page and Apex Capital appears on your home screen: full-screen mode, instant launch and core sections that work even offline.',
      'Quotes for 33 instruments now update in real time on every page, while the economic calendar and analytics feed help you catch the events that move markets. Next up — the refreshed client area and a web terminal on the same technology base.',
    ],
  },
  {
    slug: 'q2-2026-results',
    title: 'Q2 2026 results: record volume and 90,000 new accounts',
    excerpt:
      'Quarterly volume exceeded $260bn, average execution time dropped to 14 ms and automated withdrawal processing reached 92%.',
    category: 'company',
    publishedAt: '2026-07-08T10:00:00Z',
    readingMinutes: 4,
    body: [
      'The second quarter of 2026 was the most productive in company history. Total trading volume reached $261bn — 18% more than the previous quarter. Clients opened 90,000 new accounts, and active traders now exceed 1.24 million.',
      'Infrastructure investments delivered measurable results: average order execution fell from 21 to 14 ms, and the share of withdrawal requests processed automatically within minutes grew to 92%.',
      'In Q3 we will focus on launching the refreshed ecosystem: a new client area, a web terminal and expanding the instrument lineup to 15,000 positions.',
    ],
  },
  {
    slug: 'new-instruments-summer-2026',
    title: '120 new instruments: Asian stocks and commodity CFDs',
    excerpt:
      'The lineup now includes Tokyo and Hong Kong listed stocks, plus CFDs on cocoa, coffee and wheat — by client request.',
    category: 'product',
    publishedAt: '2026-06-24T08:30:00Z',
    readingMinutes: 3,
    body: [
      'We expanded the trading lineup by 120 instruments. The largest block is Asian equities: 70 stocks from the Tokyo exchange and 30 from Hong Kong, including Toyota, Sony, Alibaba and Tencent.',
      'The second group is agricultural commodity CFDs: cocoa, arabica coffee, sugar and wheat. The commodity segment showed record volatility this year, and access to it was traders’ most frequent request.',
      'All new instruments are available on all account types starting today. See the full list in the Trading Instruments section.',
    ],
  },
  {
    slug: 'apex-forex-expo-2026',
    title: 'Apex Capital at Forex Expo Dubai 2026: visit us at booth A-12',
    excerpt:
      'October 14–15 at the industry’s largest expo: live market breakdowns, meetings with analysts and special terms for visitors.',
    category: 'events',
    publishedAt: '2026-06-10T12:00:00Z',
    readingMinutes: 2,
    body: [
      'On October 14–15 the Apex Capital team will be at Forex Expo Dubai — the region’s largest trading industry exhibition. Our booth A-12 is in the central hall of the World Trade Centre.',
      'The program includes live trading breakdowns by Head of Research Anna Vereshchagina, partner program consultations and a presentation of the new web platform. Special account opening terms apply for booth visitors.',
      'Entry to the expo is free with advance registration on the organizer’s website. See you in Dubai!',
    ],
  },
];

export function getBlogPosts(locale: string): BlogPost[] {
  return locale === 'en' ? EN : RU;
}

export function findBlogPost(slug: string, locale: string): BlogPost | undefined {
  return getBlogPosts(locale).find((p) => p.slug === slug);
}

export const BLOG_SLUGS = RU.map((p) => p.slug);
export const BLOG_POSTS = RU;
