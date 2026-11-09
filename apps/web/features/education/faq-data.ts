export interface FaqItem {
  question: string;
  answer: string;
}

export interface FaqSection {
  title: string;
  items: FaqItem[];
}

const RU: FaqSection[] = [
  {
    title: 'Счёт и регистрация',
    items: [
      {
        question: 'Как открыть торговый счёт?',
        answer:
          'Заполните форму регистрации (2 минуты), подтвердите email и пройдите верификацию в личном кабинете, загрузив документ, удостоверяющий личность. После одобрения — обычно в течение одного рабочего дня — счёт готов к пополнению.',
      },
      {
        question: 'Какой минимальный депозит?',
        answer:
          'От $100 на счёте Standard. Для счетов Pro и ECN Prime минимальный депозит составляет $1 000 и $5 000 соответственно. Демо-счёт бесплатен и не требует пополнения.',
      },
      {
        question: 'Есть ли демо-счёт и чем он отличается от реального?',
        answer:
          'Да, демо-счёт с виртуальными средствами доступен сразу после регистрации. Он работает в том же терминале на тех же котировках — отличается только источник средств.',
      },
      {
        question: 'Нужно ли проходить верификацию (KYC)?',
        answer:
          'Да, для реального счёта верификация обязательна: документ, удостоверяющий личность, загружается в личном кабинете. Это защищает ваш счёт от несанкционированного доступа и вывода средств третьими лицами.',
      },
    ],
  },
  {
    title: 'Торговля',
    items: [
      {
        question: 'Какое кредитное плечо доступно?',
        answer:
          'До 1:500 на счёте Standard, до 1:400 на Pro и до 1:200 на ECN Prime. Плечо можно снизить в настройках кабинета — многие опытные трейдеры сознательно работают с 1:50 и ниже.',
      },
      {
        question: 'Что такое защита от отрицательного баланса?',
        answer:
          'Гарантия того, что вы не потеряете больше средств, чем внесли на счёт. Даже при резком гэпе против вашей позиции отрицательный остаток будет обнулён за счёт компании.',
      },
      {
        question: 'В какое время доступна торговля?',
        answer:
          'Forex, индексы и металлы торгуются круглосуточно с понедельника по пятницу. Криптовалюты — 24/7 без выходных. Акции — в часы работы соответствующих бирж.',
      },
      {
        question: 'Разрешены ли скальпинг и торговые советники?',
        answer:
          'Да, без ограничений: скальпинг, автоматические стратегии и хеджирование разрешены на всех типах счетов.',
      },
    ],
  },
  {
    title: 'Пополнение и вывод',
    items: [
      {
        question: 'Как пополнить счёт и сколько это занимает?',
        answer:
          'В USDT в сети TRC20 из личного кабинета. Средства зачисляются после подтверждения транзакции в сети и её сверки с блокчейном по хэшу.',
      },
      {
        question: 'Сколько выводятся средства?',
        answer:
          'Вывод — в USDT (TRC20) по заявке из личного кабинета. Заявка проходит проверку, а хэш выплаты сверяется с блокчейном.',
      },
      {
        question: 'Где хранятся средства клиентов?',
        answer:
          'Пополнения в USDT поступают на кошелёк площадки в сети TRON. Каждое пополнение и каждая выплата сверяются с блокчейном по хэшу транзакции, а баланс торгового счёта защищён от ухода ниже нуля.',
      },
    ],
  },
];

const EN: FaqSection[] = [
  {
    title: 'Account & registration',
    items: [
      {
        question: 'How do I open a trading account?',
        answer:
          'Fill in the registration form (2 minutes), confirm your email and complete verification in the client area by uploading an identity document. After approval — usually within one business day — the account is ready for funding.',
      },
      {
        question: 'What is the minimum deposit?',
        answer:
          'From $100 on the Standard account. For Pro and ECN Prime the minimum deposit is $1,000 and $5,000 respectively. The demo account is free and requires no funding.',
      },
      {
        question: 'Is there a demo account and how does it differ from a live one?',
        answer:
          'Yes — a demo account with virtual funds is available right after registration. It runs in the same terminal on the same quotes; only the source of funds differs.',
      },
      {
        question: 'Do I need to pass verification (KYC)?',
        answer:
          'Yes, verification is required for a live account: you upload an identity document in the client area. It protects your account from unauthorized access and third-party withdrawals.',
      },
    ],
  },
  {
    title: 'Trading',
    items: [
      {
        question: 'What leverage is available?',
        answer:
          'Up to 1:500 on Standard, up to 1:400 on Pro and up to 1:200 on ECN Prime. You can lower the leverage in your dashboard settings — many experienced traders deliberately work with 1:50 or less.',
      },
      {
        question: 'What is negative balance protection?',
        answer:
          'A guarantee that you will never lose more than you deposited. Even with a sharp gap against your position, any negative balance is reset to zero at the company’s expense.',
      },
      {
        question: 'When can I trade?',
        answer:
          'Forex, indices and metals trade around the clock from Monday to Friday. Crypto — 24/7 with no days off. Stocks — during the corresponding exchange sessions.',
      },
      {
        question: 'Are scalping and expert advisors allowed?',
        answer:
          'Yes, without restrictions: scalping, automated strategies and hedging are allowed on all account types.',
      },
    ],
  },
  {
    title: 'Deposits & withdrawals',
    items: [
      {
        question: 'How do I fund my account and how long does it take?',
        answer:
          'In USDT on the TRC20 network from the client area. Funds are credited once the transaction is confirmed on-chain and matched by its hash.',
      },
      {
        question: 'How long do withdrawals take?',
        answer:
          'Withdrawals are made in USDT (TRC20) on request from the client area. Each request is reviewed, and the payout hash is reconciled with the blockchain.',
      },
      {
        question: 'Where are client funds held?',
        answer:
          'USDT deposits arrive at the platform wallet on the TRON network. Every deposit and payout is reconciled with the blockchain by transaction hash, and the trading account balance is protected from going below zero.',
      },
    ],
  },
];

export function getFaqSections(locale: string): FaqSection[] {
  return locale === 'en' ? EN : RU;
}
