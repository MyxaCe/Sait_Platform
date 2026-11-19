'use client';

import { useState, type ReactNode } from 'react';
import { Input, Money } from '@broker/ui';
import { parseUsdtAmountToCents } from '@broker/money/amounts';
import {
  approveCreditAction,
  declineCreditAction,
  manualCreditAction,
  retryCreditAction,
} from '@/lib/money/credit-actions';
import { ActionForm, ConfirmFacts } from './ActionForm';

export interface CreditFacts {
  commandId: string;
  userId: string;
  clientName: string;
  clientEmail: string;
  amountMinor: number;
  basis: string;
  initiatorName: string;
}

const BigMoney = ({ minor }: { minor: number | null }) => (
  <Money minor={minor} currency="USDT" className="text-xl font-semibold" />
);

function clientFact(name: string, email: string): [string, ReactNode] {
  return [
    'Клиент',
    <>
      {name}
      <span className="text-secondary block text-xs font-normal">{email}</span>
    </>,
  ];
}

const ACCOUNT_FACT: [string, ReactNode] = ['Счёт', 'Реальный счёт клиента, USDT (демо-счёт не затрагивается)'];

const CONSEQUENCE =
  'Сумма зачислится на реальный счёт клиента в терминале. Обратного действия нет — только списание отдельной командой.';

export function ManualCreditForm({
  userId,
  clientName,
  clientEmail,
}: {
  userId: string;
  clientName: string;
  clientEmail: string;
}) {
  const [amount, setAmount] = useState('');
  const raw = amount.trim();
  const parsed = raw ? parseUsdtAmountToCents(raw) : null;
  const cents = parsed && parsed.ok ? parsed.cents : null;
  return (
    <ActionForm
      action={manualCreditAction}
      submitLabel="Зачислить вручную"
      okText="Зачислено на реальный счёт клиента."
      extraValid={cents !== null}
      disarmOn={raw}
      reasonPlaceholder="Напр.: клиент оплатил банковским переводом, платёжка №…"
      reasonHint="Обязательно. Пишется в неизменяемый журнал и в команду вместе с вашим логином."
      confirm={{
        tone: 'primary',
        title: 'Зачислить деньги клиенту вручную?',
        summary: (
          <ConfirmFacts rows={[clientFact(clientName, clientEmail), ['Сумма', <BigMoney key="m" minor={cents} />], ACCOUNT_FACT]} />
        ),
        consequence: CONSEQUENCE,
        confirmLabel: 'Да, зачислить',
      }}
    >
      <input type="hidden" name="userId" value={userId} />
      <div className="space-y-1.5">
        <label htmlFor={`credit-amount-${userId}`} className="text-muted block text-xs">
          Сумма, USDT
        </label>
        <Input
          id={`credit-amount-${userId}`}
          name="amount"
          controlSize="compact"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="Напр.: 250.00"
          inputMode="decimal"
          autoComplete="off"
          invalid={raw.length > 0 && cents === null}
          className="w-48 text-right tabular-nums"
        />
        {raw.length > 0 && cents === null ? (
          <p className="text-negative text-xs">Положительная сумма, не больше двух знаков после запятой.</p>
        ) : (
          <p className="text-muted text-xs">1 USDT = 1 USD. Зачисление проходит через денежную команду с подписью.</p>
        )}
      </div>
    </ActionForm>
  );
}

function Hidden({ c }: { c: CreditFacts }) {
  return (
    <>
      <input type="hidden" name="commandId" value={c.commandId} />
      <input type="hidden" name="userId" value={c.userId} />
    </>
  );
}

function commandFacts(c: CreditFacts): Array<[string, ReactNode]> {
  return [
    clientFact(c.clientName, c.clientEmail),
    ['Сумма', <BigMoney key="m" minor={c.amountMinor} />],
    ACCOUNT_FACT,
    ['Основание инициатора', c.basis],
    ['Инициатор', c.initiatorName],
  ];
}

export function ApproveCreditForm({ c }: { c: CreditFacts }) {
  return (
    <ActionForm
      action={approveCreditAction}
      submitLabel="Подтвердить и зачислить"
      okText="Подтверждено и зачислено на реальный счёт клиента."
      reasonLabel="Основание подтверждения"
      reasonPlaceholder="Что проверено: платёжка, сумма, клиент"
      confirm={{
        tone: 'primary',
        title: 'Подтвердить ручное зачисление?',
        summary: <ConfirmFacts rows={commandFacts(c)} />,
        consequence: CONSEQUENCE,
        confirmLabel: 'Да, подтвердить и зачислить',
      }}
    >
      <Hidden c={c} />
    </ActionForm>
  );
}

export function DeclineCreditForm({ c }: { c: CreditFacts }) {
  return (
    <ActionForm
      action={declineCreditAction}
      submitLabel="Отклонить"
      okText="Команда отклонена, деньги не двигались."
      reasonLabel="Причина отказа"
      reasonPlaceholder="Почему зачисление не проводится"
      confirm={{
        tone: 'danger',
        title: 'Отклонить ручное зачисление?',
        summary: <ConfirmFacts rows={[clientFact(c.clientName, c.clientEmail), ['Сумма', <BigMoney key="m" minor={c.amountMinor} />]]} />,
        consequence: 'Команда закроется со статусом «Отклонено», деньги клиенту не зачисляются.',
        confirmLabel: 'Да, отклонить',
      }}
    >
      <Hidden c={c} />
    </ActionForm>
  );
}

export function RetryCreditForm({ c }: { c: CreditFacts }) {
  return (
    <ActionForm
      action={retryCreditAction}
      submitLabel="Повторить отправку в терминал"
      variant="secondary"
      okText="Терминал подтвердил зачисление."
      reasonLabel="Комментарий к повтору"
      reasonPlaceholder="Напр.: терминал снова доступен"
      confirm={{
        tone: 'primary',
        title: 'Повторить зачисление в терминале?',
        summary: <ConfirmFacts rows={[clientFact(c.clientName, c.clientEmail), ['Сумма', <BigMoney key="m" minor={c.amountMinor} />], ACCOUNT_FACT]} />,
        consequence:
          'Повтор идёт с тем же ключом команды: если терминал уже провёл зачисление, второй раз деньги не придут.',
        confirmLabel: 'Да, повторить',
      }}
    >
      <Hidden c={c} />
    </ActionForm>
  );
}
