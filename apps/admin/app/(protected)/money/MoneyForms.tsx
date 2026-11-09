'use client';

import { useState, type ReactNode } from 'react';
import { Input, Money } from '@broker/ui';
import { bindUnidentifiedAction, withdrawalDecisionAction } from '@/lib/crypto/actions';
import { ActionForm, ConfirmFacts } from '../_money/ActionForm';
import { GroupedMono, TronRef } from '../_money/tron';

/**
 * Формы раздела «Деньги» (только вид; actions, имена полей и решения —
 * прежние: `withdrawalDecisionAction` с `decision` = approve | reject | sent |
 * settle, `bindUnidentifiedAction` с `depositId` + `client`). Каждое денежное
 * действие — два шага: на втором крупно сумма, адрес и клиент.
 */

export interface WithdrawalFacts {
  id: string;
  status: string;
  debitState: string;
  amountMinor: number;
  clientName: string;
  clientEmail: string;
  toAddress: string;
}

function Section({
  title,
  hint,
  danger,
  children,
}: {
  title: string;
  hint?: ReactNode;
  danger?: boolean;
  children: ReactNode;
}) {
  return (
    <section
      className={
        danger ? 'border-negative/25 space-y-3 border-t pt-4' : 'space-y-3'
      }
    >
      <div>
        <h3 className={danger ? 'text-negative text-[13px] font-semibold' : 'text-primary text-[13px] font-semibold'}>
          {title}
        </h3>
        {hint ? <p className="text-muted mt-0.5 text-xs">{hint}</p> : null}
      </div>
      {children}
    </section>
  );
}

const BigMoney = ({ minor }: { minor: number }) => (
  <Money minor={minor} currency="USDT" className="text-xl font-semibold" />
);

function clientFact(w: WithdrawalFacts): [string, ReactNode] {
  return [
    'Клиент',
    <>
      {w.clientName}
      <span className="text-secondary block text-xs font-normal">{w.clientEmail}</span>
    </>,
  ];
}

function addressFact(w: WithdrawalFacts): [string, ReactNode] {
  return ['Адрес получателя (TRON)', <GroupedMono key="a" value={w.toAddress} className="text-[15px]" />];
}

function Hidden({ id, decision }: { id: string; decision: string }) {
  return (
    <>
      <input type="hidden" name="withdrawalId" value={id} />
      <input type="hidden" name="decision" value={decision} />
    </>
  );
}

/* ─── Подана: одобрить / отклонить ─────────────────────────────────── */

function ApproveForm({ w }: { w: WithdrawalFacts }) {
  return (
    <ActionForm
      action={withdrawalDecisionAction}
      submitLabel="Одобрить вывод"
      okText="Вывод одобрен. Отправьте USDT с кошелька биржи и внесите хэш."
      reasonPlaceholder="Напр.: KYC подтверждён, адрес проверен, лимиты соблюдены"
      confirm={{
        tone: 'primary',
        title: 'Одобрить вывод?',
        summary: (
          <ConfirmFacts
            rows={[['Сумма', <BigMoney key="m" minor={w.amountMinor} />], clientFact(w), addressFact(w)]}
          />
        ),
        consequence: (
          <>
            Одобрение само деньги не отправляет. Дальше вы отправляете ровно эту сумму с кошелька
            биржи на этот адрес и вносите хэш транзакции.
            {w.debitState === 'pending'
              ? ' Списание в терминале ещё не подтверждено — оно будет повторено перед одобрением (повтор безопасен).'
              : null}
          </>
        ),
        confirmLabel: 'Да, одобрить вывод',
      }}
    >
      <Hidden id={w.id} decision="approve" />
    </ActionForm>
  );
}

function RefundForm({
  w,
  label,
  title,
  consequence,
  okText,
}: {
  w: WithdrawalFacts;
  label: string;
  title: string;
  consequence: ReactNode;
  okText: string;
}) {
  return (
    <ActionForm
      action={withdrawalDecisionAction}
      submitLabel={label}
      okText={okText}
      reasonPlaceholder="Причина — попадёт в журнал"
      confirm={{
        tone: 'danger',
        title,
        summary: (
          <ConfirmFacts
            rows={[['Вернуть на счёт клиента', <BigMoney key="m" minor={w.amountMinor} />], clientFact(w)]}
          />
        ),
        consequence,
        confirmLabel: `Да, ${label.toLowerCase()}`,
      }}
    >
      <Hidden id={w.id} decision="reject" />
    </ActionForm>
  );
}

/* ─── Одобрена: внести хэш отправки ────────────────────────────────── */

const HASH_RE = /^[0-9a-fA-F]{64}$/;

function SentForm({ w }: { w: WithdrawalFacts }) {
  const [hash, setHash] = useState('');
  const h = hash.trim();
  const looksValid = HASH_RE.test(h);
  return (
    <ActionForm
      action={withdrawalDecisionAction}
      submitLabel="Внести хэш отправки"
      okText="Хэш внесён — наблюдатель сверит получателя и сумму в сети."
      extraValid={h.length > 0}
      disarmOn={h}
      reasonPlaceholder="Напр.: отправлено с кошелька биржи"
      confirm={{
        tone: 'primary',
        title: 'Внести хэш отправки?',
        summary: (
          <ConfirmFacts
            rows={[
              [
                'Хэш транзакции',
                looksValid ? (
                  <span className="block space-y-1">
                    <GroupedMono value={h.toLowerCase()} className="text-[13px]" />
                    <TronRef kind="tx" value={h.toLowerCase()} middle={6} copy={false} className="text-xs font-normal" />
                  </span>
                ) : (
                  <GroupedMono value={h} className="text-[13px]" />
                ),
              ],
              ['Должно уйти', <BigMoney key="m" minor={w.amountMinor} />],
              addressFact(w),
            ]}
          />
        ),
        consequence:
          'Наблюдатель сверит в сети получателя и сумму. Сошлось — заявка исполнена; не сошлось — уйдёт на проверку, автоматического возврата нет.',
        confirmLabel: 'Да, внести хэш',
      }}
    >
      <Hidden id={w.id} decision="sent" />
      <div className="space-y-1.5">
        <label htmlFor={`hash-${w.id}`} className="text-muted block text-xs">
          Хэш транзакции отправки USDT
        </label>
        <Input
          id={`hash-${w.id}`}
          name="txHash"
          controlSize="compact"
          value={hash}
          onChange={(e) => setHash(e.target.value)}
          placeholder="64 шестнадцатеричных символа"
          autoComplete="off"
          spellCheck={false}
          invalid={h.length > 0 && !looksValid}
          className="font-mono text-[13px]"
        />
        {h.length > 0 && !looksValid ? (
          <p className="text-negative text-xs">
            Хэш TRON — 64 шестнадцатеричных символа (сейчас {h.length}). Скопируйте его из кошелька
            целиком.
          </p>
        ) : (
          <p className="text-muted text-xs">Из кошелька, с которого вы отправили USDT.</p>
        )}
      </div>
    </ActionForm>
  );
}

/* ─── На проверке: исполнена вручную ──────────────────────────────── */

function SettleForm({ w }: { w: WithdrawalFacts }) {
  return (
    <ActionForm
      action={withdrawalDecisionAction}
      submitLabel="Отметить исполненной"
      variant="secondary"
      okText="Вывод отмечен исполненным."
      reasonPlaceholder="Что проверено в Tronscan и почему расхождение не ошибка"
      confirm={{
        tone: 'primary',
        title: 'Отметить вывод исполненным вручную?',
        summary: (
          <ConfirmFacts rows={[['Сумма', <BigMoney key="m" minor={w.amountMinor} />], clientFact(w), addressFact(w)]} />
        ),
        consequence:
          'Вы подтверждаете, что клиент получил эти USDT на этот адрес — сверка сетью при этом не выполняется. Списанное со счёта клиента не вернётся.',
        confirmLabel: 'Да, исполнена',
      }}
    >
      <Hidden id={w.id} decision="settle" />
    </ActionForm>
  );
}

/** Действия по заявке на вывод — только допустимые из текущего состояния. */
export function WithdrawalActions({ w }: { w: WithdrawalFacts }) {
  if (w.status === 'requested') {
    return (
      <>
        <Section title="Одобрить" hint="Проверьте клиента и адрес получателя.">
          <ApproveForm w={w} />
        </Section>
        <Section title="Отклонить" danger>
          <RefundForm
            w={w}
            label="Отклонить с возвратом"
            title="Отклонить заявку и вернуть деньги?"
            okText="Заявка отклонена, деньги возвращены на счёт клиента."
            consequence="Сумма вернётся на реальный счёт клиента, заявка закроется со статусом «Отклонена»."
          />
        </Section>
      </>
    );
  }
  if (w.status === 'approved') {
    return (
      <>
        <Section title="Внести хэш отправки" hint="После того как USDT ушли с кошелька биржи.">
          <SentForm w={w} />
        </Section>
        <Section title="Отменить" danger>
          <RefundForm
            w={w}
            label="Отменить с возвратом"
            title="Отменить одобренную заявку и вернуть деньги?"
            okText="Заявка отменена, деньги возвращены на счёт клиента."
            consequence="Если USDT уже отправлены — не отменяйте, внесите хэш: иначе клиент получит деньги дважды."
          />
        </Section>
      </>
    );
  }
  if (w.status === 'needs_review') {
    return (
      <>
        <Section title="Исполнена" hint="Если в Tronscan видно, что клиент получил деньги.">
          <SettleForm w={w} />
        </Section>
        <Section title="Отменить" danger>
          <RefundForm
            w={w}
            label="Отменить с возвратом"
            title="Отменить заявку и вернуть деньги?"
            okText="Заявка отменена, деньги возвращены на счёт клиента."
            consequence="Если USDT фактически ушли на адрес клиента, возврат даст ему деньги дважды. Сначала проверьте хэш в Tronscan."
          />
        </Section>
      </>
    );
  }
  return null;
}

/* ─── Неопознанное поступление: привязать к клиенту ───────────────── */

export function BindForm({
  depositId,
  amountMinor,
  fromAddress,
}: {
  depositId: string;
  amountMinor: number | null;
  fromAddress: string | null;
}) {
  const [client, setClient] = useState('');
  const c = client.trim();
  return (
    <ActionForm
      action={bindUnidentifiedAction}
      submitLabel="Зачислить клиенту"
      okText="Поступление зачислено на реальный счёт клиента."
      extraValid={c.length > 0}
      disarmOn={c}
      reasonPlaceholder="Напр.: клиент прислал хэш в поддержку, обращение №…"
      confirm={{
        tone: 'primary',
        title: 'Зачислить поступление клиенту?',
        summary: (
          <ConfirmFacts
            rows={[
              ['Сумма', <Money key="m" minor={amountMinor} currency="USDT" className="text-xl font-semibold" />],
              ['Клиент (точное совпадение)', <span key="c" className="font-mono text-[14px]">{c}</span>],
              fromAddress ? ['Отправитель (TRON)', <GroupedMono key="f" value={fromAddress} className="text-[15px]" />] : null,
            ]}
          />
        ),
        consequence:
          'Сумма зачислится на реальный счёт клиента, найденного по точному email, UID или id. Обратного действия в админке нет.',
        confirmLabel: 'Да, зачислить',
      }}
    >
      <input type="hidden" name="depositId" value={depositId} />
      <div className="space-y-1.5">
        <label htmlFor={`client-${depositId}`} className="text-muted block text-xs">
          Клиент
        </label>
        <Input
          id={`client-${depositId}`}
          name="client"
          controlSize="compact"
          value={client}
          onChange={(e) => setClient(e.target.value)}
          placeholder="Email, UID или id клиента"
          autoComplete="off"
          spellCheck={false}
        />
        <p className="text-muted text-xs">Точное совпадение; частичный поиск не используется.</p>
      </div>
    </ActionForm>
  );
}
