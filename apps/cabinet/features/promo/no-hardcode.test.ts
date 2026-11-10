import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Сторож «ничего не хардкодим» (решения владельца 10.11, сквозной принцип):
 * в вёрстке экранов акций, рефералов, конкурса и условий счетов нет ни одной
 * суммы, процента, плеча — всё приходит из `@broker/promo`/`@broker/money`
 * (админка). Тексты — в словарях без чисел акций.
 *
 * **Что было.** Страница счетов обещала «комиссия $2.5–3, плечо 1:500,
 * 12 000+ инструментов», витринные карточки акций — «бонус 30% до $5 000».
 * Ни одно из этих чисел терминал не исполнял.
 */

const ROOT = path.resolve(__dirname, '../..');
const PROMO_DIR = path.join(ROOT, 'features/promo');
const FILES = [
  ...readdirSync(PROMO_DIR)
    .filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f))
    .map((f) => path.join('features/promo', f)),
  'features/home/PromotionsModule.tsx',
  'app/[locale]/(app)/promotions/page.tsx',
  'app/[locale]/(app)/referrals/page.tsx',
  'app/[locale]/(app)/contest/page.tsx',
  'app/[locale]/(app)/accounts/page.tsx',
];

const BANNED: RegExp[] = [
  /\d[\d\s  .,]*\s?(USDT|USD|EUR)\b/, // сумма с валютой
  /\$\s?\d/, // «$25»
  /\b\d+(?:[.,]\d+)?\s?%/, // «30%», «0,05 %»
  /\b1:\d{2,}/, // плечо «1:500»
  /\d+\s?000\+/, // «12 000+ инструментов»
];

function offending(text: string): string[] {
  const out: string[] = [];
  text.split('\n').forEach((line, i) => {
    const s = line.trim();
    if (s.startsWith('//') || s.startsWith('*') || s.startsWith('/*') || s.startsWith('{/*')) return;
    // Шаблонные литералы Tailwind (`w-[9rem]`, `h-1.5`) и `${v}%` ширины полосы — не заявления.
    const cleaned = line.replace(/`\$\{[^}]+\}%`/g, '');
    if (BANNED.some((re) => re.test(cleaned))) out.push(`${i + 1}: ${s}`);
  });
  return out;
}

const MESSAGES = ['messages/ru.json', 'messages/en.json'];
const PROMO_NAMESPACES = ['promo', 'referrals', 'contest', 'accounts'];

describe('экраны акций — без захардкоженных чисел', () => {
  it('детектор ловит суммы, проценты, плечо', () => {
    expect(offending('<p>Бонус 30% до $5 000</p>')).toHaveLength(1);
    expect(offending("label: 'Плечо 1:500'")).toHaveLength(1);
    expect(offending('<span>25,00 USDT</span>')).toHaveLength(1);
    expect(offending('// пример: 25 USDT')).toHaveLength(0);
    expect(offending('style={{ width: `${v}%` }}')).toHaveLength(0);
  });

  it.each(FILES)('%s', (file) => {
    expect(offending(readFileSync(path.join(ROOT, file), 'utf8'))).toEqual([]);
  });

  it.each(MESSAGES)('%s: подписи акций без чисел (числа — параметры {…})', (file) => {
    const m = JSON.parse(readFileSync(path.join(ROOT, file), 'utf8')) as Record<string, unknown>;
    const strings: string[] = [];
    const walk = (v: unknown) => {
      if (typeof v === 'string') strings.push(v);
      else if (v && typeof v === 'object') Object.values(v).forEach(walk);
    };
    PROMO_NAMESPACES.forEach((ns) => walk(m[ns]));
    expect(strings.length).toBeGreaterThan(0);
    // `{…}` и ICU-ветки (`=0`, `#`) убираем — остальное не должно содержать сумм/процентов/плеча.
    const bad = strings.filter((s) => BANNED.some((re) => re.test(s.replace(/\{[^{}]*\}/g, ''))));
    expect(bad).toEqual([]);
  });
});
