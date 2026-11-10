import type { SVGProps } from 'react';

/**
 * Иконки рельса — инлайновые SVG (без внешних icon-библиотек: лишняя
 * зависимость на операторском периметре не нужна). Монохром, наследуют
 * `currentColor`, 20×20, штрих. Плоский служебный стиль, не витринный.
 */
export type NavIconName =
  | 'dashboard'
  | 'clients'
  | 'kyc'
  | 'money'
  | 'risk'
  | 'journal'
  | 'operators'
  | 'aml'
  | 'settings'
  | 'breakglass'
  | 'promo'
  | 'support';

const PATHS: Record<NavIconName, string> = {
  // сетка плиток
  dashboard: 'M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z',
  // люди
  clients: 'M16 11a4 4 0 1 0-8 0M3 20a7 7 0 0 1 18 0',
  // галочка-щит
  kyc: 'M12 3l7 3v5c0 4-3 7-7 9-4-2-7-5-7-9V6z M9 12l2 2 4-4',
  // монета
  money: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18M12 7v10M9.5 9.5a2.5 2 0 0 1 5 0c0 2.5-5 1.5-5 4a2.5 2 0 0 0 5 0',
  // шкала/датчик риска
  risk: 'M12 3a9 9 0 0 0-9 9h4a5 5 0 0 1 10 0h4a9 9 0 0 0-9-9M12 12l4-2',
  // список строк
  journal: 'M5 4h14v16H5zM8 8h8M8 12h8M8 16h5',
  // люди с шестерёнкой (упрощённо — ключ доступа)
  operators: 'M10 11a4 4 0 1 0-8 0M2 20a6 6 0 0 1 12 0M18 7l3 3-6 6h-3v-3z',
  // щит с лупой (скрининг по спискам)
  aml: 'M12 3l7 3v5c0 4-3 7-7 9-4-2-7-5-7-9V6zM11 11a2 2 0 1 0 .01 0M13 13l2 2',
  // ползунки (настройки)
  settings: 'M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0M14 4v4M8 10v4M16 16v4',
  // восклицание в ромбе (аварийная дверь)
  breakglass: 'M12 2l10 10-10 10L2 12zM12 8v5M12 16.5v.5',
  // подарок (акции и партнёры)
  promo: 'M4 11h16v9H4zM3 7h18v4H3zM12 7v13M12 7c-1.5-3-5-3-5-1s3 1 5 1c2 0 5 1 5-1s-3.5-2-5 1',
  // облачко диалога (поддержка)
  support: 'M4 5h16v11H9l-5 4zM8 9h8M8 12h5',
};

export function NavIcon({ name, ...props }: { name: NavIconName } & SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={20}
      height={20}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...props}
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
