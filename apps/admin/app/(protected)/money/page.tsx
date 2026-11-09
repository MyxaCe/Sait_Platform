import Link from 'next/link';
import { notFound } from 'next/navigation';
import { formatUsdtRaw } from '@broker/money';
import { getOperatorSession } from '@/lib/auth/current';
import { canOperateMoney, exchangeTronAddress } from '@/lib/crypto/runtime';
import { listDeposits, listUnidentified, listWithdrawals } from '@/lib/crypto/queries';
import {
  centsText,
  DEBIT_STATE,
  DEPOSIT_REJECT,
  DEPOSIT_STATUS,
  WITHDRAWAL_STATUS,
} from '@/lib/crypto/labels';
import { BindForm, WithdrawalActions } from './MoneyForms';

/**
 * Раздел «Деньги» (дизайн §4): депозиты, неопознанные поступления, очередь
 * выводов. Роли — admin и finance_operator (без второго аппрува). Ключей на
 * сервере нет: USDT на вывод отправляет владелец вручную и вносит хэш здесь.
 */
export const dynamic = 'force-dynamic';

const TABS = [
  { key: 'withdrawals', label: 'Выводы' },
  { key: 'deposits', label: 'Депозиты' },
  { key: 'unidentified', label: 'Неопознанные' },
] as const;
type Tab = (typeof TABS)[number]['key'];

function dateFmt(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' }) : '—';
}

const short = (s: string | null, n = 10) => (s ? `${s.slice(0, n)}…${s.slice(-4)}` : '—');

function TronLink({ hash }: { hash: string }) {
  return (
    <a
      href={`https://tronscan.org/#/transaction/${hash}`}
      target="_blank"
      rel="noreferrer"
      className="font-mono text-xs text-accent hover:underline"
      title={hash}
    >
      {short(hash)}
    </a>
  );
}

function ClientCell({ userId, name, email }: { userId: string | null; name: string | null; email: string | null }) {
  if (!userId) return <span className="text-secondary/60">—</span>;
  return (
    <Link href={`/clients/${userId}`} className="block hover:text-accent">
      <span className="block truncate text-primary">{name}</span>
      <span className="block truncate text-xs text-secondary">{email}</span>
    </Link>
  );
}

export default async function MoneyPage({ searchParams }: { searchParams: { tab?: string } }) {
  const operator = await getOperatorSession();
  if (!canOperateMoney(operator?.role)) notFound();
  const tab: Tab = TABS.some((t) => t.key === searchParams.tab) ? (searchParams.tab as Tab) : 'withdrawals';
  const address = exchangeTronAddress();

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">Деньги · USDT TRC20</h1>
        <p className="text-sm text-secondary">
          Кошелёк биржи:{' '}
          {address ? <span className="font-mono text-primary">{address}</span> : <span className="text-negative">не задан</span>}
          {' · '}реальный счёт клиента, курс 1 USDT = 1 USD
        </p>
      </div>

      <nav className="flex gap-2 border-b border-border">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={`/money?tab=${t.key}`}
            className={`-mb-px border-b-2 px-3 py-2 text-sm ${
              t.key === tab ? 'border-accent text-primary' : 'border-transparent text-secondary hover:text-primary'
            }`}
          >
            {t.label}
          </Link>
        ))}
      </nav>

      {tab === 'withdrawals' ? <Withdrawals /> : tab === 'deposits' ? <Deposits /> : <Unidentified />}
    </div>
  );
}

async function Withdrawals() {
  const rows = await listWithdrawals();
  if (rows.length === 0) return <Empty text="Заявок на вывод нет." />;
  return (
    <ul className="space-y-3">
      {rows.map((w) => (
        <li key={w.id} className="grid gap-3 rounded border border-border bg-elevated p-4 lg:grid-cols-[1fr_22rem]">
          <div className="space-y-1 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-lg font-semibold tabular-nums">{centsText(w.amountMinor)}</span>
              <span className="rounded bg-card px-2 py-0.5 text-xs">{WITHDRAWAL_STATUS[w.status] ?? w.status}</span>
              <span className="text-xs text-secondary">{DEBIT_STATE[w.debitState] ?? w.debitState}</span>
              {w.refunded ? <span className="text-xs text-positive">возвращено на счёт</span> : null}
            </div>
            <ClientCell userId={w.userId} name={w.clientName} email={w.clientEmail} />
            <p className="text-xs text-secondary">
              Куда: <span className="break-all font-mono text-primary">{w.toAddress}</span>
            </p>
            <p className="text-xs text-secondary">Подана {dateFmt(w.requestedAt)} · id {w.id.slice(0, 8)}</p>
            {w.payoutTxHash ? (
              <p className="text-xs text-secondary">
                Хэш отправки: <TronLink hash={w.payoutTxHash} />
              </p>
            ) : null}
            {w.rejectReason ? <p className="text-xs text-negative">Причина: {w.rejectReason}</p> : null}
            {w.reviewReason ? <p className="text-xs text-negative">Не сошлось: {w.reviewReason}</p> : null}
            {w.checkNote ? <p className="text-xs text-secondary">Наблюдатель: {w.checkNote}</p> : null}
          </div>
          <WithdrawalActions id={w.id} status={w.status} debitState={w.debitState} />
        </li>
      ))}
    </ul>
  );
}

async function Deposits() {
  const rows = await listDeposits();
  if (rows.length === 0) return <Empty text="Заявок на ввод нет." />;
  return (
    <div className="overflow-x-auto rounded border border-border">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-elevated text-left text-xs uppercase text-secondary">
            <th className="px-3 py-2 font-medium">Клиент</th>
            <th className="px-3 py-2 font-medium">Хэш</th>
            <th className="px-3 py-2 font-medium">Отправитель</th>
            <th className="px-3 py-2 text-right font-medium">Сумма</th>
            <th className="px-3 py-2 font-medium">Статус</th>
            <th className="px-3 py-2 font-medium">Заявлен</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((d) => (
            <tr key={d.id} className="border-b border-border last:border-0">
              <td className="px-3 py-2">
                <ClientCell userId={d.userId} name={d.clientName} email={d.clientEmail} />
              </td>
              <td className="px-3 py-2">
                <TronLink hash={d.txHash} />
              </td>
              <td className="px-3 py-2 font-mono text-xs" title={d.fromAddress ?? ''}>
                {short(d.fromAddress, 8)}
              </td>
              <td className="px-3 py-2 text-right tabular-nums">
                {d.amountMinor !== null ? centsText(d.amountMinor) : d.amountRaw ? `${formatUsdtRaw(d.amountRaw)} USDT` : '—'}
                {d.dustRaw && d.dustRaw !== '0' ? (
                  <span className="block text-xs text-secondary">остаток {formatUsdtRaw(d.dustRaw)} не зачислен</span>
                ) : null}
              </td>
              <td className="px-3 py-2">
                {DEPOSIT_STATUS[d.status] ?? d.status}
                {d.rejectReason ? (
                  <span className="block text-xs text-negative">{DEPOSIT_REJECT[d.rejectReason] ?? d.rejectReason}</span>
                ) : null}
                {d.status === 'claimed' && d.checkNote ? (
                  <span className="block text-xs text-secondary">{d.checkNote}</span>
                ) : null}
              </td>
              <td className="px-3 py-2 tabular-nums text-xs text-secondary">{dateFmt(d.claimedAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

async function Unidentified() {
  const rows = await listUnidentified();
  if (rows.length === 0) {
    return <Empty text="Неопознанных поступлений нет: на каждый входящий USDT кто-то заявил хэш." />;
  }
  return (
    <ul className="space-y-3">
      {rows.map((d) => (
        <li key={d.id} className="grid gap-3 rounded border border-border bg-elevated p-4 lg:grid-cols-[1fr_22rem]">
          <div className="space-y-1 text-sm">
            <p className="text-lg font-semibold tabular-nums">
              {d.amountRaw ? `${formatUsdtRaw(d.amountRaw)} USDT` : '—'}
            </p>
            <p className="text-xs text-secondary">
              Отправитель: <span className="break-all font-mono text-primary">{d.fromAddress ?? '—'}</span>
            </p>
            <p className="text-xs text-secondary">
              Хэш: <TronLink hash={d.txHash} /> · в сети {dateFmt(d.blockTime)}
            </p>
          </div>
          <BindForm depositId={d.id} />
        </li>
      ))}
    </ul>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="rounded border border-border bg-elevated px-4 py-6 text-center text-secondary">{text}</p>;
}
