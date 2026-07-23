/**
 * Правовые документы (RU + EN). В проде контент ведёт юридический отдел —
 * тексты ниже являются структурным каркасом и подлежат замене
 * согласованными формулировками.
 */

export interface LegalSection {
  heading: string;
  paragraphs: string[];
}

export interface LegalDocument {
  slug: string;
  title: string;
  updatedAt: string;
  intro: string;
  sections: LegalSection[];
}

const RU: LegalDocument[] = [
  {
    slug: 'privacy',
    title: 'Политика конфиденциальности',
    updatedAt: '2026-06-01',
    intro:
      'Настоящая политика описывает, какие персональные данные собирает Apex Capital, для каких целей они обрабатываются и какими правами обладает субъект данных.',
    sections: [
      {
        heading: '1. Какие данные мы собираем',
        paragraphs: [
          'При регистрации и верификации мы собираем идентификационные данные (ФИО, дата рождения, гражданство), контактные данные (email, телефон, адрес), копии документов, необходимые по требованиям KYC/AML, а также технические данные об использовании сервиса (IP-адрес, тип устройства, действия в кабинете).',
          'Финансовые данные — история операций, источники средств, платёжные реквизиты — обрабатываются исключительно для исполнения договора и требований законодательства.',
        ],
      },
      {
        heading: '2. Цели и правовые основания обработки',
        paragraphs: [
          'Данные обрабатываются для заключения и исполнения клиентского соглашения, выполнения требований регуляторов (идентификация, противодействие отмыванию средств), обеспечения безопасности счёта и — при наличии отдельного согласия — для маркетинговых коммуникаций.',
          'Отозвать согласие на маркетинговые коммуникации можно в любой момент в настройках кабинета или по запросу в поддержку; это не влияет на обслуживание счёта.',
        ],
      },
      {
        heading: '3. Хранение и передача данных',
        paragraphs: [
          'Данные хранятся в зашифрованном виде в дата-центрах на территории ЕС. Срок хранения определяется требованиями законодательства (как правило, 5 лет после прекращения отношений).',
          'Передача третьим лицам возможна только поставщикам, задействованным в оказании услуги (платёжные провайдеры, верификационные сервисы), на основании договоров обработки, а также регуляторам по законному запросу.',
        ],
      },
      {
        heading: '4. Ваши права',
        paragraphs: [
          'Вы вправе запросить доступ к своим данным, их исправление, удаление (с учётом обязательных сроков хранения), ограничение обработки и перенос данных. Запросы направляются в поддержку и исполняются в течение 30 дней.',
        ],
      },
    ],
  },
  {
    slug: 'terms',
    title: 'Условия использования',
    updatedAt: '2026-06-01',
    intro:
      'Настоящие условия регулируют использование сайта и сервисов Apex Capital. Открывая счёт, вы подтверждаете согласие с клиентским соглашением в полном объёме.',
    sections: [
      {
        heading: '1. Услуги',
        paragraphs: [
          'Компания предоставляет доступ к маржинальной торговле производными финансовыми инструментами (CFD) на валюты, металлы, индексы, акции, криптовалюты и энергоносители, а также сопутствующие аналитические и обучающие материалы.',
          'Аналитические материалы носят информационный характер и не являются индивидуальной инвестиционной рекомендацией.',
        ],
      },
      {
        heading: '2. Требования к клиенту',
        paragraphs: [
          'Услуги доступны дееспособным лицам, достигшим 18 лет, прошедшим процедуру идентификации. Компания вправе отказать в обслуживании резидентам юрисдикций, где предоставление услуг ограничено законодательством.',
          'Клиент обязуется предоставлять достоверные данные, не передавать доступ к счёту третьим лицам и использовать сервис только в законных целях.',
        ],
      },
      {
        heading: '3. Ответственность',
        paragraphs: [
          'Компания не несёт ответственности за убытки, вызванные рыночными движениями, перебоями связи на стороне клиента или действиями третьих лиц, за исключением случаев, прямо предусмотренных клиентским соглашением.',
          'Совокупная ответственность компании ограничена размером средств клиента на счёте.',
        ],
      },
      {
        heading: '4. Изменение условий',
        paragraphs: [
          'Компания вправе изменять настоящие условия с уведомлением клиентов не менее чем за 10 рабочих дней через кабинет и email. Продолжение использования сервиса означает согласие с изменениями.',
        ],
      },
    ],
  },
  {
    slug: 'risk-disclosure',
    title: 'Уведомление о рисках',
    updatedAt: '2026-06-01',
    intro:
      'Торговля маржинальными продуктами сопряжена с высоким уровнем риска и подходит не всем инвесторам. Внимательно ознакомьтесь с настоящим уведомлением до начала торговли.',
    sections: [
      {
        heading: '1. Риск кредитного плеча',
        paragraphs: [
          'Кредитное плечо многократно увеличивает как потенциальную прибыль, так и убыток. Относительно небольшое движение рынка может привести к потере всех средств на счёте. Никогда не торгуйте на средства, потерю которых вы не можете себе позволить.',
        ],
      },
      {
        heading: '2. Рыночные риски',
        paragraphs: [
          'Цены финансовых инструментов подвержены резким изменениям под влиянием экономических событий, новостей и ликвидности. В моменты повышенной волатильности исполнение может происходить по цене, отличающейся от запрошенной (проскальзывание), а гэпы могут привести к срабатыванию стоп-приказов по худшей цене.',
          'Прошлые результаты не гарантируют будущей доходности. Криптовалютные инструменты отличаются повышенной волатильностью относительно традиционных рынков.',
        ],
      },
      {
        heading: '3. Технологические риски',
        paragraphs: [
          'Торговля через интернет сопряжена с рисками сбоев связи, оборудования и программного обеспечения. Компания прилагает разумные усилия для обеспечения непрерывности сервиса, однако не может гарантировать отсутствие перерывов.',
        ],
      },
      {
        heading: '4. Защита от отрицательного баланса',
        paragraphs: [
          'Компания гарантирует, что убыток клиента не превысит средств, размещённых на торговом счёте: отрицательный баланс, возникший в результате рыночного гэпа, обнуляется за счёт компании.',
        ],
      },
    ],
  },
  {
    slug: 'kyc-aml',
    title: 'Политика KYC/AML',
    updatedAt: '2026-06-01',
    intro:
      'Компания соблюдает международные стандарты противодействия отмыванию денег (AML) и финансированию терроризма (CFT), включая рекомендации FATF и требования применимых регуляторов.',
    sections: [
      {
        heading: '1. Идентификация клиентов (KYC)',
        paragraphs: [
          'До начала обслуживания клиент проходит идентификацию: предоставляет документ, удостоверяющий личность, подтверждение адреса проживания и, при необходимости, сведения об источнике средств. Компания вправе запросить дополнительные документы на любом этапе обслуживания.',
        ],
      },
      {
        heading: '2. Мониторинг операций',
        paragraphs: [
          'Компания осуществляет постоянный мониторинг операций на предмет необычной активности. Операции, не соответствующие профилю клиента, могут быть приостановлены до выяснения обстоятельств.',
          'Пополнение и вывод средств возможны только с собственных счетов и карт клиента: платежи третьих лиц не принимаются и возвращаются отправителю.',
        ],
      },
      {
        heading: '3. Отказ в обслуживании',
        paragraphs: [
          'Компания вправе отказать в открытии счёта, приостановить или прекратить обслуживание при непрохождении процедур идентификации, предоставлении недостоверных сведений или выявлении признаков противоправной деятельности, с уведомлением уполномоченных органов в предусмотренных законом случаях.',
        ],
      },
    ],
  },
];

const EN: LegalDocument[] = [
  {
    slug: 'privacy',
    title: 'Privacy Policy',
    updatedAt: '2026-06-01',
    intro:
      'This policy describes what personal data Apex Capital collects, the purposes for which it is processed and the rights of the data subject.',
    sections: [
      {
        heading: '1. What data we collect',
        paragraphs: [
          'During registration and verification we collect identification data (full name, date of birth, citizenship), contact data (email, phone, address), copies of documents required under KYC/AML rules, and technical data about your use of the service (IP address, device type, dashboard activity).',
          'Financial data — transaction history, source of funds, payment details — is processed solely to perform the agreement and meet legal requirements.',
        ],
      },
      {
        heading: '2. Purposes and legal grounds for processing',
        paragraphs: [
          'Data is processed to conclude and perform the client agreement, meet regulatory requirements (identification, anti-money-laundering), secure the account and — subject to separate consent — for marketing communications.',
          'You may withdraw consent to marketing communications at any time in the dashboard settings or via support; this does not affect account servicing.',
        ],
      },
      {
        heading: '3. Storage and transfer of data',
        paragraphs: [
          'Data is stored in encrypted form in EU data centers. The retention period is determined by legal requirements (as a rule, 5 years after the relationship ends).',
          'Transfers to third parties are possible only to providers involved in delivering the service (payment providers, verification services) under data processing agreements, and to regulators upon lawful request.',
        ],
      },
      {
        heading: '4. Your rights',
        paragraphs: [
          'You have the right to request access to your data, its correction, deletion (subject to mandatory retention periods), restriction of processing and data portability. Requests are sent to support and fulfilled within 30 days.',
        ],
      },
    ],
  },
  {
    slug: 'terms',
    title: 'Terms of Use',
    updatedAt: '2026-06-01',
    intro:
      'These terms govern the use of the Apex Capital website and services. By opening an account you confirm full acceptance of the client agreement.',
    sections: [
      {
        heading: '1. Services',
        paragraphs: [
          'The company provides access to leveraged trading in derivative financial instruments (CFDs) on currencies, metals, indices, stocks, cryptocurrencies and energies, together with related analytical and educational materials.',
          'Analytical materials are for information purposes only and do not constitute individual investment advice.',
        ],
      },
      {
        heading: '2. Client requirements',
        paragraphs: [
          'Services are available to legally capable persons aged 18 or over who have completed identification. The company may refuse service to residents of jurisdictions where the provision of services is restricted by law.',
          'The client undertakes to provide accurate data, not to give third parties access to the account, and to use the service only for lawful purposes.',
        ],
      },
      {
        heading: '3. Liability',
        paragraphs: [
          'The company is not liable for losses caused by market movements, connectivity failures on the client side or actions of third parties, except in cases expressly provided for in the client agreement.',
          "The company's aggregate liability is limited to the amount of the client's funds on the account.",
        ],
      },
      {
        heading: '4. Changes to the terms',
        paragraphs: [
          'The company may amend these terms with at least 10 business days’ notice to clients via the dashboard and email. Continued use of the service constitutes acceptance of the changes.',
        ],
      },
    ],
  },
  {
    slug: 'risk-disclosure',
    title: 'Risk Disclosure',
    updatedAt: '2026-06-01',
    intro:
      'Trading leveraged products involves a high level of risk and is not suitable for all investors. Read this notice carefully before you start trading.',
    sections: [
      {
        heading: '1. Leverage risk',
        paragraphs: [
          'Leverage multiplies both potential profit and loss. A relatively small market move can lead to the loss of all funds on the account. Never trade with money you cannot afford to lose.',
        ],
      },
      {
        heading: '2. Market risks',
        paragraphs: [
          'Prices of financial instruments are subject to sharp changes driven by economic events, news and liquidity. During periods of elevated volatility, execution may occur at a price different from the requested one (slippage), and gaps may cause stop orders to fill at a worse price.',
          'Past performance does not guarantee future returns. Cryptocurrency instruments are more volatile than traditional markets.',
        ],
      },
      {
        heading: '3. Technology risks',
        paragraphs: [
          'Trading over the internet carries risks of connectivity, hardware and software failures. The company makes reasonable efforts to ensure service continuity but cannot guarantee the absence of interruptions.',
        ],
      },
      {
        heading: '4. Negative balance protection',
        paragraphs: [
          "The company guarantees that a client's loss will not exceed the funds placed on the trading account: any negative balance resulting from a market gap is reset to zero at the company's expense.",
        ],
      },
    ],
  },
  {
    slug: 'kyc-aml',
    title: 'KYC/AML Policy',
    updatedAt: '2026-06-01',
    intro:
      'The company complies with international anti-money-laundering (AML) and counter-terrorist-financing (CFT) standards, including FATF recommendations and the requirements of applicable regulators.',
    sections: [
      {
        heading: '1. Client identification (KYC)',
        paragraphs: [
          'Before servicing begins, the client completes identification: providing an identity document, proof of residence address and, where necessary, information on the source of funds. The company may request additional documents at any stage of servicing.',
        ],
      },
      {
        heading: '2. Transaction monitoring',
        paragraphs: [
          "The company continuously monitors transactions for unusual activity. Transactions inconsistent with the client's profile may be suspended pending clarification.",
          'Deposits and withdrawals are possible only from the client’s own accounts and cards: third-party payments are not accepted and are returned to the sender.',
        ],
      },
      {
        heading: '3. Refusal of service',
        paragraphs: [
          'The company may refuse to open an account, or suspend or terminate service, if identification procedures are not completed, inaccurate information is provided or signs of unlawful activity are detected, notifying the competent authorities where required by law.',
        ],
      },
    ],
  },
];

export function getLegalDocuments(locale: string): LegalDocument[] {
  return locale === 'en' ? EN : RU;
}

export function findLegalDocument(slug: string, locale: string): LegalDocument | undefined {
  return getLegalDocuments(locale).find((d) => d.slug === slug);
}

export const LEGAL_SLUGS = RU.map((d) => d.slug);
export const LEGAL_DOCUMENTS = RU;
