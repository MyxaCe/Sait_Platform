import Link from 'next/link';
import { listPortfolios } from '@/lib/leverage/queries';
import { getOperatorSession } from '@/lib/auth/current';
import { formatLeverage } from '@/lib/leverage/resolve';
import { PortfolioEditor } from './_components/PortfolioEditor';

/**
 * Риск/плечо — портфели `/risk/portfolios` (WEB-47/45, Р-446, §3.9).
 *
 * Глобальная смена плеча портфеля (действует на всех клиентов портфеля) и
 * планка класса внутри портфеля (крипта — Р-446). Напоминание «override клиента
 * имеет приоритет» видно на экране.
 *
 * Роль-гейт (§3.9): просмотр — operator+admin (гейт layout/middleware);
 * изменение — только admin (формы рендерятся лишь для admin, fail-closed).
 * Чтение НЕ журналируем; изменения journaled в `admin_action_journal`.
 */
export const dynamic = 'force-dynamic';

export default async function PortfoliosPage() {
  const [portfolios, operator] = await Promise.all([listPortfolios(), getOperatorSession()]);
  const isAdmin = operator?.role === 'admin';

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">Портфели плеча</h1>
        <p className="text-sm text-secondary">
          Плечо — свойство портфеля (Р-446). Смена плеча портфеля действует{' '}
          <span className="text-primary">глобально</span> — на всех его клиентов. Открытые позиции
          защищены снимком плеча на момент открытия и сменой не затрагиваются.
        </p>
        <p className="rounded border border-border bg-elevated px-3 py-2 text-xs text-secondary">
          Приоритет разрешения: <span className="text-primary">override клиента</span> → override
          класса в портфеле → плечо портфеля. Override конкретному клиенту (
          <Link href="/risk/leverage" className="text-accent hover:underline">
            Риск/плечо → override
          </Link>
          ) перекрывает значения этого экрана.
        </p>
      </div>

      {!isAdmin ? (
        <p className="rounded border border-border bg-elevated px-3 py-2 text-sm text-secondary">
          Просмотр. Изменение плеча портфелей — действие администратора.
        </p>
      ) : null}

      <ul className="space-y-4">
        {portfolios.map((p) => (
          <li
            key={p.key}
            className="space-y-3 rounded border border-border bg-elevated px-4 py-4"
            data-portfolio={p.key}
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div className="flex items-baseline gap-3">
                <h2 className="text-lg font-medium text-primary">{p.title}</h2>
                {p.isDefault ? (
                  <span className="rounded bg-accent/15 px-2 py-0.5 text-xs text-accent">по умолчанию</span>
                ) : null}
              </div>
              <span className="tabular-nums text-sm text-secondary">
                плечо <span className="text-primary">{formatLeverage(p.baseLeverage)}</span> · клиентов{' '}
                <span className="text-primary">{p.clientCount}</span>
              </span>
            </div>

            <div className="text-sm text-secondary">
              Планки классов:{' '}
              {Object.keys(p.classOverrides).length === 0 ? (
                <span className="text-primary">нет</span>
              ) : (
                <span className="tabular-nums text-primary">
                  {Object.entries(p.classOverrides)
                    .map(([cls, lev]) => `${cls} ${formatLeverage(lev)}`)
                    .join(' · ')}
                </span>
              )}
            </div>

            {isAdmin ? (
              <PortfolioEditor
                portfolioKey={p.key}
                baseLeverage={p.baseLeverage}
                classOverrides={p.classOverrides}
              />
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
