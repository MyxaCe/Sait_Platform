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
    slug: 'usdt-trc20-deposits-withdrawals',
    title: 'Пополнение и вывод в USDT (TRC20) со сверкой в блокчейне',
    excerpt:
      'Реальный счёт теперь пополняется и выводится в USDT в сети TRON прямо из личного кабинета, а каждая операция сверяется с блокчейном по хэшу транзакции.',
    category: 'product',
    publishedAt: '2026-11-09T10:00:00Z',
    readingMinutes: 3,
    body: [
      'В личном кабинете появились кнопки «Пополнить» и «Вывести» для реального счёта. Расчёты идут в USDT в сети TRON (стандарт TRC20).',
      'Каждое пополнение и каждая выплата сверяются с данными блокчейна по хэшу транзакции: отдельный сервис наблюдает за кошельком площадки и подтверждает операцию только тогда, когда видит её в сети. Ключей от кошелька у этого сервиса нет — он только наблюдает.',
      'Денежные операции доступны после проверки личности. В терминале теперь можно выбрать, каким счётом торговать, — демо или реальным.',
    ],
  },
  {
    slug: 'kyc-in-client-area',
    title: 'Проверка личности — прямо в личном кабинете',
    excerpt:
      'Документы для верификации загружаются в кабинете, а денежные операции открываются после проверки.',
    category: 'product',
    publishedAt: '2026-11-01T09:00:00Z',
    readingMinutes: 2,
    body: [
      'Для реального счёта нужна проверка личности. Теперь документы загружаются прямо в личном кабинете — без писем и сторонних сервисов.',
      'Файлы хранятся в отдельном защищённом хранилище, а проверку проводит оператор площадки. Пока проверка не пройдена, денежные операции по реальному счёту закрыты — это защищает счёт от вывода средств третьими лицами.',
    ],
  },
  {
    slug: 'new-web-platform-pwa',
    title: 'Запускаем новую веб-платформу: PWA, живые котировки и тёмная тема',
    excerpt:
      'Полностью переработанный сайт: установка как приложение в один клик, котировки в реальном времени на каждой странице и скорость загрузки менее секунды.',
    category: 'product',
    publishedAt: '2026-07-20T09:00:00Z',
    readingMinutes: 3,
    body: [
      'Сегодня мы представляем новую веб-платформу Apex Capital. Сайт построен с нуля на современном стеке и проектировался в первую очередь для мобильных устройств.',
      'Главное новшество — установка как приложения в один клик, без магазинов приложений. Нажмите «Установить приложение» на главной странице, и Apex Capital появится на домашнем экране: полноэкранный режим, мгновенный запуск и работа основных разделов даже без сети.',
      'Котировки по инструментам сайта теперь обновляются в реальном времени на каждой странице, а экономический календарь и лента аналитики помогают не пропустить события, которые двигают рынок. Впереди — запуск обновлённого личного кабинета и веб-терминала на этой же технологической базе.',
    ],
  },
];

const EN: BlogPost[] = [
  {
    slug: 'usdt-trc20-deposits-withdrawals',
    title: 'USDT (TRC20) deposits and withdrawals with on-chain reconciliation',
    excerpt:
      'Live accounts can now be funded and withdrawn in USDT on the TRON network straight from the client area, and every operation is reconciled with the blockchain by transaction hash.',
    category: 'product',
    publishedAt: '2026-11-09T10:00:00Z',
    readingMinutes: 3,
    body: [
      'The client area now has “Deposit” and “Withdraw” buttons for the live account. Settlement is in USDT on the TRON network (TRC20 standard).',
      'Every deposit and payout is reconciled with blockchain data by transaction hash: a dedicated service watches the platform wallet and confirms an operation only once it sees it on-chain. That service holds no wallet keys — it only observes.',
      'Money operations are available after identity verification. In the terminal you can now choose which account to trade — demo or live.',
    ],
  },
  {
    slug: 'kyc-in-client-area',
    title: 'Identity verification right in the client area',
    excerpt:
      'Verification documents are uploaded in the client area, and money operations open once the review passes.',
    category: 'product',
    publishedAt: '2026-11-01T09:00:00Z',
    readingMinutes: 2,
    body: [
      'A live account requires identity verification. Documents are now uploaded right in the client area — no emails or third-party services.',
      'Files are kept in a separate protected storage, and the review is done by a platform operator. Until verification passes, money operations on the live account stay closed — this protects the account from third-party withdrawals.',
    ],
  },
  {
    slug: 'new-web-platform-pwa',
    title: 'Launching our new web platform: PWA, live quotes and dark theme',
    excerpt:
      'A completely rebuilt website: one-click app installation, real-time quotes on every page and sub-second load times.',
    category: 'product',
    publishedAt: '2026-07-20T09:00:00Z',
    readingMinutes: 3,
    body: [
      'Today we present the new Apex Capital web platform. The site was rebuilt from scratch on a modern stack and designed mobile-first.',
      'The headline feature is one-click app installation with no app stores. Tap “Install App” on the home page and Apex Capital appears on your home screen: full-screen mode, instant launch and core sections that work even offline.',
      'Quotes for the site’s instruments now update in real time on every page, while the economic calendar and analytics feed help you catch the events that move markets. Next up — the refreshed client area and a web terminal on the same technology base.',
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
