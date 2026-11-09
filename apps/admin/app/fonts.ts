import localFont from 'next/font/local';

/**
 * Шрифт центра управления — Inter (SIL OFL 1.1, © The Inter Project Authors),
 * вариативный (wght 100–900), подмножества latin + cyrillic. Self-hosted: файлы
 * лежат в репозитории (`app/fonts/*.woff2`) и раздаются с нашего origin —
 * внешних CDN на рантайме нет (CSP периметра).
 *
 * Два семейства с собственным `unicode-range`, склеенные в `--font-sans`
 * (globals.css): браузер берёт глиф из подходящего подмножества и грузит
 * кириллицу только когда она есть на странице. Метрический fallback отключён,
 * иначе Arial перехватил бы кириллицу раньше второго подмножества.
 */
export const interLatin = localFont({
  src: './fonts/inter-latin-var.woff2',
  weight: '100 900',
  style: 'normal',
  display: 'swap',
  variable: '--font-inter-latin',
  adjustFontFallback: false,
  fallback: [],
  declarations: [
    {
      prop: 'unicode-range',
      value:
        'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD',
    },
  ],
});

export const interCyrillic = localFont({
  src: './fonts/inter-cyrillic-var.woff2',
  weight: '100 900',
  style: 'normal',
  display: 'swap',
  variable: '--font-inter-cyrillic',
  adjustFontFallback: false,
  fallback: [],
  declarations: [
    { prop: 'unicode-range', value: 'U+0301, U+0400-045F, U+0490-0491, U+04B0-04B1, U+2116' },
  ],
});
