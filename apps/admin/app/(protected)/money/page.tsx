import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Callout, KpiTile, Money, PageHeader, Tabs } from '@broker/ui';
import { getOperatorSession } from '@/lib/auth/current';
import { canOperateMoney, exchangeTronAddress } from '@/lib/crypto/runtime';
import { listDeposits, listUnidentified, listWithdrawals } from '@/lib/crypto/queries';
import { fmtAge, fmtDateTime } from '@/lib/ui/format';
import { TronRef } from '../_money/tron';
import { chainCents } from '../_money/amount';
import { awaitsOperator, isOpenWithdrawal, moneyHref, sumMinor, type MoneyTab } from './view';
import { WithdrawalsView } from './WithdrawalsView';
import { DepositsView } from './DepositsView';
import { UnidentifiedView } from './UnidentifiedView';

/**
 * Раздел «Деньги» (дизайн §4, концепция §7.1/§7.4): очередь выводов (таблица
 * + панель решения справа), депозиты, неопознанные поступления. Деньги
 * реальные — USDT в сети TRON (TRC20). Роли — admin и finance_operator (без
 * второго аппрува); у остальных раздела нет (404, пункта в рельсе нет).
 * Ключей на сервере нет: USDT на вывод отправляет владелец вручную со своего
 * кошелька и вносит хэш здесь.
 *
 * Фаза 2 — только представление: чтения, server actions, переходы статусов и
 * роль-гейт прежние. Выбор заявки и фильтры — в URL (работают без JS).
 */
export const dynamic = 'force-dynamic';

const TAB_KEYS: MoneyTab[] = ['withdrawals', 'deposits', 'unidentified'];

function OpenLink({ href, children = 'Открыть →' }: { href: string; children?: React.ReactNode }) {
  return (
    <Link href={href} className="text-accent font-medium hover:underline">
      {children}
    </Link>
  );
}

export default async function MoneyPage({
  searchParams,
}: {
  searchParams: { tab?: string; f?: string; ds?: string; w?: string; u?: string };
}) {
  const operator = await getOperatorSession();
  if (!canOperateMoney(operator?.role)) notFound();
  const tab: MoneyTab = TAB_KEYS.includes(searchParams.tab as MoneyTab)
    ? (searchParams.tab as MoneyTab)
    : 'withdrawals';
  const address = exchangeTronAddress();

  const [withdrawals, deposits, unidentified] = await Promise.all([
    listWithdrawals(),
    listDeposits(),
    listUnidentified(),
  ]);

  const waiting = withdrawals.filter((w) => awaitsOperator(w.status));
  const oldestWaiting = waiting.reduce<string | null>(
    (m, w) => (m === null || w.requestedAt < m ? w.requestedAt : m),
    null,
  );
  const approved = withdrawals.filter((w) => w.status === 'approved');
  const sent = withdrawals.filter((w) => w.status === 'sent');
  const unidentifiedMinor = unidentified.reduce((s, d) => s + (chainCents(d.amountMinor, d.amountRaw) ?? 0), 0);
  const openWithdrawals = withdrawals.filter((w) => isOpenWithdrawal(w.status)).length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Деньги"
        description="Ввод и вывод USDT в сети TRON (TRC20) на реальный счёт клиента, 1 USDT = 1 USD. Деньги реальные: каждое решение — с основанием, в журнал."
        meta={
          <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
            {address ? (
              <span className="inline-flex items-center gap-1.5">
                Кошелёк биржи
                <TronRef kind="address" value={address} middle={10} className="text-[13px]" />
              </span>
            ) : null}
            {address ? <span aria-hidden>·</span> : null}
            <span className="tabular-nums">Срез на {fmtDateTime(new Date())}</span>
          </span>
        }
      />

      {!address ? (
        <Callout tone="warning" title="Кошелёк биржи не задан">
          Переменная окружения <code className="font-mono text-[0.92em]">EXCHANGE_TRON_ADDRESS</code> пуста:
          кабинет не показывает клиентам реквизиты для пополнения, наблюдатель не видит
          поступлений. Адрес задаётся только в окружении сервера, не в админке.
        </Callout>
      ) : null}

      <section aria-label="Очереди денег" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiTile
          label="Ждут решения"
          value={waiting.length}
          tone={waiting.length > 0 ? 'warning' : 'default'}
          hint={
            waiting.length > 0 ? (
              <>
                <Money minor={sumMinor(waiting)} currency="USDT" />
                {oldestWaiting ? ` · старейшая ${fmtAge(oldestWaiting)}` : ''}
              </>
            ) : (
              'очередь пуста'
            )
          }
          action={<OpenLink href={moneyHref({ tab: 'withdrawals' })} />}
        />
        <KpiTile
          label="Ждут отправки"
          value={approved.length}
          hint={
            approved.length > 0 ? (
              <>
                <Money minor={sumMinor(approved)} currency="USDT" /> · одобрены, нужен хэш
              </>
            ) : (
              'отправлять нечего'
            )
          }
          action={<OpenLink href={moneyHref({ tab: 'withdrawals' })} />}
        />
        <KpiTile
          label="Сверка в сети"
          value={sent.length}
          hint={
            sent.length > 0 ? (
              <>
                <Money minor={sumMinor(sent)} currency="USDT" /> · отправлены
              </>
            ) : (
              'в пути ничего нет'
            )
          }
        />
        <KpiTile
          label="Неопознанные"
          value={unidentified.length}
          tone={unidentified.length > 0 ? 'warning' : 'default'}
          hint={
            unidentified.length > 0 ? (
              <>
                <Money minor={unidentifiedMinor} currency="USDT" /> · без хэша
              </>
            ) : (
              'всё опознано'
            )
          }
          action={<OpenLink href={moneyHref({ tab: 'unidentified' })} />}
        />
      </section>

      <Tabs
        linkComponent={Link}
        active={tab}
        aria-label="Разделы денег"
        items={[
          {
            key: 'withdrawals',
            label: 'Выводы',
            href: moneyHref({ tab: 'withdrawals' }),
            count: openWithdrawals,
            countTone: waiting.length > 0 ? 'warning' : 'default',
          },
          {
            key: 'deposits',
            label: 'Депозиты',
            href: moneyHref({ tab: 'deposits' }),
          },
          {
            key: 'unidentified',
            label: 'Неопознанные',
            href: moneyHref({ tab: 'unidentified' }),
            count: unidentified.length,
            countTone: unidentified.length > 0 ? 'warning' : 'default',
          },
        ]}
      />

      {tab === 'withdrawals' ? (
        <WithdrawalsView rows={withdrawals} filterParam={searchParams.f} selectedId={searchParams.w} />
      ) : tab === 'deposits' ? (
        <DepositsView rows={deposits} filterParam={searchParams.ds} />
      ) : (
        <UnidentifiedView rows={unidentified} identified={deposits} selectedId={searchParams.u} />
      )}
    </div>
  );
}
