/** Мок вебинаров (RU + EN): даты считаются от текущего дня, чтобы расписание выглядело живым. */

export interface Webinar {
  id: string;
  title: string;
  speaker: string;
  speakerRole: string;
  datetime: string;
  durationMinutes: number;
  level: string;
  description: string;
  isPast: boolean;
}

interface WebinarText {
  title: string;
  speaker: string;
  speakerRole: string;
  level: string;
  description: string;
}

interface WebinarTemplate {
  dayOffset: number;
  hour: number;
  durationMinutes: number;
  ru: WebinarText;
  en: WebinarText;
}

const TEMPLATES: WebinarTemplate[] = [
  {
    dayOffset: 1,
    hour: 19,
    durationMinutes: 60,
    ru: {
      title: 'Первые шаги на Forex: от демо-счёта к первой сделке',
      speaker: 'Дмитрий Соколов',
      speakerRole: 'Ведущий аналитик',
      level: 'Новичок',
      description:
        'Устройство рынка, типы ордеров, расчёт позиции и типичные ошибки первых месяцев. Живой разбор платформы и ответы на вопросы.',
    },
    en: {
      title: 'First steps in Forex: from demo account to your first trade',
      speaker: 'Dmitry Sokolov',
      speakerRole: 'Lead Analyst',
      level: 'Beginner',
      description:
        'How the market works, order types, position sizing and the typical mistakes of the first months. A live platform walkthrough and Q&A.',
    },
  },
  {
    dayOffset: 3,
    hour: 18,
    durationMinutes: 90,
    ru: {
      title: 'Торговля на новостях: стратегия работы с экономическим календарём',
      speaker: 'Анна Верещагина',
      speakerRole: 'Руководитель аналитического отдела',
      level: 'Средний',
      description:
        'Какие релизы двигают рынок, как читать отклонение факта от прогноза и где ставить стопы, когда волатильность вырастает в разы.',
    },
    en: {
      title: 'News trading: a strategy for working with the economic calendar',
      speaker: 'Anna Vereshchagina',
      speakerRole: 'Head of Research',
      level: 'Intermediate',
      description:
        'Which releases move the market, how to read the actual-vs-forecast deviation and where to place stops when volatility multiplies.',
    },
  },
  {
    dayOffset: 8,
    hour: 19,
    durationMinutes: 75,
    ru: {
      title: 'Управление капиталом: портфель стратегий вместо одной «граальной»',
      speaker: 'Марат Гареев',
      speakerRole: 'Портфельный управляющий',
      level: 'Продвинутый',
      description:
        'Диверсификация по стратегиям и инструментам, корреляции позиций, просадка как метрика и расчёт риска на уровне портфеля.',
    },
    en: {
      title: 'Money management: a portfolio of strategies instead of one “holy grail”',
      speaker: 'Marat Gareev',
      speakerRole: 'Portfolio Manager',
      level: 'Advanced',
      description:
        'Diversification across strategies and instruments, position correlations, drawdown as a metric and portfolio-level risk calculation.',
    },
  },
  {
    dayOffset: -6,
    hour: 19,
    durationMinutes: 60,
    ru: {
      title: 'Технический анализ золота: уровни, от которых торгует рынок',
      speaker: 'Анна Верещагина',
      speakerRole: 'Руководитель аналитического отдела',
      level: 'Средний',
      description:
        'Разбор структуры рынка XAUUSD: ключевые уровни, поведение цены вокруг исторического максимума и сценарии до конца квартала.',
    },
    en: {
      title: 'Technical analysis of gold: the levels the market trades from',
      speaker: 'Anna Vereshchagina',
      speakerRole: 'Head of Research',
      level: 'Intermediate',
      description:
        'A breakdown of XAUUSD market structure: key levels, price behavior around the all-time high and scenarios through the end of the quarter.',
    },
  },
  {
    dayOffset: -13,
    hour: 18,
    durationMinutes: 60,
    ru: {
      title: 'Психология трейдинга: как перестать нарушать собственные правила',
      speaker: 'Дмитрий Соколов',
      speakerRole: 'Ведущий аналитик',
      level: 'Новичок',
      description:
        'Тильт, FOMO и месть рынку: механика срывов и практические техники — лимиты, журнал сделок, чек-лист перед входом.',
    },
    en: {
      title: 'Trading psychology: how to stop breaking your own rules',
      speaker: 'Dmitry Sokolov',
      speakerRole: 'Lead Analyst',
      level: 'Beginner',
      description:
        'Tilt, FOMO and revenge trading: the mechanics of breakdowns and practical techniques — limits, a trade journal, a pre-entry checklist.',
    },
  },
];

export function getWebinars(now = new Date(), locale = 'ru'): Webinar[] {
  return TEMPLATES.map((t, i) => {
    const date = new Date(now);
    date.setDate(date.getDate() + t.dayOffset);
    date.setHours(t.hour, 0, 0, 0);
    const text = locale === 'en' ? t.en : t.ru;
    return {
      id: `web-${i}`,
      title: text.title,
      speaker: text.speaker,
      speakerRole: text.speakerRole,
      datetime: date.toISOString(),
      durationMinutes: t.durationMinutes,
      level: text.level,
      description: text.description,
      isPast: date.getTime() < now.getTime(),
    };
  }).sort((a, b) => a.datetime.localeCompare(b.datetime));
}
