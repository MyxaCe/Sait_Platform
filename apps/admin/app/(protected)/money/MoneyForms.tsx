'use client';

import { useState } from 'react';
import { bindUnidentifiedAction, withdrawalDecisionAction } from '@/lib/crypto/actions';
import { ActionForm } from '../_money/ActionForm';

const inputCls =
  'w-full rounded border border-border bg-base px-2 py-1 text-sm text-primary outline-none focus:border-accent';

/** Привязать неопознанное поступление к клиенту (терминал deposit tron:<hash>). */
export function BindForm({ depositId }: { depositId: string }) {
  const [client, setClient] = useState('');
  return (
    <ActionForm
      action={bindUnidentifiedAction}
      submitLabel="Зачислить клиенту"
      okText="Зачислено на реальный счёт клиента."
      extraValid={client.trim().length > 0}
      danger
    >
      <input type="hidden" name="depositId" value={depositId} />
      <input
        name="client"
        value={client}
        onChange={(e) => setClient(e.target.value)}
        placeholder="Email, UID или id клиента"
        className={inputCls}
      />
    </ActionForm>
  );
}

function Decision({ id, decision, label, okText, variant, danger }: {
  id: string;
  decision: string;
  label: string;
  okText: string;
  variant?: 'primary' | 'secondary' | 'danger';
  danger?: boolean;
}) {
  return (
    <ActionForm
      action={withdrawalDecisionAction}
      submitLabel={label}
      okText={okText}
      variant={variant}
      danger={danger}
    >
      <input type="hidden" name="withdrawalId" value={id} />
      <input type="hidden" name="decision" value={decision} />
    </ActionForm>
  );
}

function SentForm({ id }: { id: string }) {
  const [hash, setHash] = useState('');
  return (
    <ActionForm
      action={withdrawalDecisionAction}
      submitLabel="Внести хэш отправки"
      okText="Хэш внесён — наблюдатель сверит получателя и сумму."
      extraValid={hash.trim().length > 0}
    >
      <input type="hidden" name="withdrawalId" value={id} />
      <input type="hidden" name="decision" value="sent" />
      <input
        name="txHash"
        value={hash}
        onChange={(e) => setHash(e.target.value)}
        placeholder="Хэш транзакции отправки USDT"
        className={`${inputCls} font-mono`}
      />
    </ActionForm>
  );
}

/** Действия по заявке на вывод — только допустимые из текущего состояния. */
export function WithdrawalActions({ id, status, debitState }: { id: string; status: string; debitState: string }) {
  if (status === 'requested') {
    return (
      <div className="space-y-3">
        {debitState === 'pending' ? (
          <p className="text-xs text-secondary">
            Списание не подтверждено терминалом — «Одобрить» сначала повторит его (безопасно).
          </p>
        ) : null}
        <Decision id={id} decision="approve" label="Одобрить" okText="Одобрено. Отправьте USDT и внесите хэш." />
        <Decision
          id={id}
          decision="reject"
          label="Отклонить с возвратом"
          okText="Отклонено, деньги возвращены на счёт."
          danger
        />
      </div>
    );
  }
  if (status === 'approved') {
    return (
      <div className="space-y-3">
        <SentForm id={id} />
        <Decision id={id} decision="reject" label="Отменить с возвратом" okText="Отменено, деньги возвращены." danger />
      </div>
    );
  }
  if (status === 'needs_review') {
    return (
      <div className="space-y-3">
        <p className="text-xs text-negative">
          Сверка не сошлась. Автоматического возврата нет — решает человек.
        </p>
        <Decision id={id} decision="settle" label="Отметить исполненной" okText="Отмечено исполненной." variant="secondary" />
        <Decision id={id} decision="reject" label="Отменить с возвратом" okText="Отменено, деньги возвращены." danger />
      </div>
    );
  }
  return <p className="text-xs text-secondary">Действий нет.</p>;
}
