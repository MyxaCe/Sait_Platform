'use client';

import { useState } from 'react';
import { useFormState, useFormStatus } from 'react-dom';
import { Button } from '@broker/ui';
import {
  setClientPortfolioAction,
  setClientOverrideAction,
  clearClientOverrideAction,
  type LeverageActionState,
} from '@/lib/leverage/actions';

/**
 * Панель управления плечом клиента (§3.8, admin only). Три формы-с-основанием:
 *  - назначить портфель (WEB-44, атрибут клиента);
 *  - выдать override по заявке (WEB-46 — № заявки обязателен, journaled);
 *  - снять override (вернуть к портфелю).
 * Локальные формы (анти-коллизия: из @broker/ui — только Button). Тёмная тема.
 */

const MESSAGES: Record<string, string> = {
  forbidden: 'Недостаточно прав: управление плечом — действие администратора.',
  invalidClient: 'Клиент не указан.',
  missingReason: 'Нужно указать основание (для override — ещё и № заявки).',
  invalidLeverage: 'Плечо должно быть целым числом ≥ 1 (знаменатель 1:N).',
  noClient: 'Клиент не найден.',
  noPortfolio: 'Портфель не найден (или не задан портфель по умолчанию).',
  noOverride: 'У клиента нет override — снимать нечего.',
  alreadyInState: 'Клиент уже в этом портфеле — изменений нет.',
};

function Feedback({ state, okText }: { state: LeverageActionState; okText: string }) {
  if (state.error) {
    return (
      <p role="alert" className="rounded border border-negative/40 bg-negative/10 px-3 py-2 text-sm text-negative">
        {MESSAGES[state.error] ?? 'Действие не выполнено.'}
      </p>
    );
  }
  if (state.ok) {
    return (
      <p role="status" className="rounded border border-positive/40 bg-positive/10 px-3 py-2 text-sm text-positive">
        {okText}
      </p>
    );
  }
  return null;
}

const fieldCls =
  'w-full rounded border border-border bg-base px-3 py-2 text-sm text-primary outline-none focus:border-accent';
const numCls =
  'w-28 rounded border border-border bg-base px-2 py-1 text-sm tabular-nums text-primary outline-none focus:border-accent';

function Submit({ label, disabled, variant = 'primary' }: { label: string; disabled: boolean; variant?: 'primary' | 'danger' | 'secondary' }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant={variant} disabled={pending || disabled}>
      {pending ? '…' : label}
    </Button>
  );
}

interface PortfolioOpt {
  key: string;
  title: string;
  baseLeverage: number;
}

function PortfolioForm({ userId, portfolios, assignedKey }: { userId: string; portfolios: PortfolioOpt[]; assignedKey: string | null }) {
  const [state, action] = useFormState<LeverageActionState, FormData>(setClientPortfolioAction, {});
  const [key, setKey] = useState(assignedKey ?? portfolios[0]?.key ?? '');
  const [reason, setReason] = useState('');
  const ready = key !== '' && key !== assignedKey && reason.trim().length > 0;

  return (
    <form action={action} className="space-y-3 rounded border border-border bg-elevated p-4">
      <h3 className="text-sm font-medium text-primary">Портфель клиента</h3>
      <Feedback state={state} okText="Портфель клиента изменён." />
      <input type="hidden" name="userId" value={userId} />
      <select name="portfolioKey" value={key} onChange={(e) => setKey(e.target.value)} className={fieldCls}>
        {portfolios.map((p) => (
          <option key={p.key} value={p.key}>
            {p.title} (1:{p.baseLeverage})
          </option>
        ))}
      </select>
      <input
        name="reason"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        className={fieldCls}
        placeholder="Основание (обязательно)"
      />
      <Submit label="Назначить портфель" disabled={!ready} variant="secondary" />
    </form>
  );
}

function OverrideForm({ userId }: { userId: string }) {
  const [state, action] = useFormState<LeverageActionState, FormData>(setClientOverrideAction, {});
  const [lev, setLev] = useState('');
  const [ticket, setTicket] = useState('');
  const [reason, setReason] = useState('');
  const ready = lev.trim() !== '' && ticket.trim().length > 0 && reason.trim().length > 0;

  return (
    <form action={action} className="space-y-3 rounded border border-accent/30 bg-accent/5 p-4">
      <h3 className="text-sm font-medium text-primary">Выдать override по заявке</h3>
      <Feedback state={state} okText="Override выдан и записан в журнал." />
      <input type="hidden" name="userId" value={userId} />
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <label className="text-secondary">Плечо 1:</label>
        <input
          name="leverage"
          inputMode="numeric"
          value={lev}
          onChange={(e) => setLev(e.target.value.replace(/[^\d]/g, ''))}
          className={numCls}
        />
        <input
          name="ticket"
          value={ticket}
          onChange={(e) => setTicket(e.target.value)}
          className={`${fieldCls} flex-1`}
          placeholder="№ заявки (обязательно)"
        />
      </div>
      <input
        name="reason"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        className={fieldCls}
        placeholder="Основание (обязательно)"
      />
      <Submit label="Выдать override" disabled={!ready} variant="primary" />
      <p className="text-xs text-secondary">
        Override «не тихо в базе» (Р-446): без № заявки и основания не выдаётся. Приоритет над
        портфелем и планкой класса.
      </p>
    </form>
  );
}

function ClearForm({ userId }: { userId: string }) {
  const [state, action] = useFormState<LeverageActionState, FormData>(clearClientOverrideAction, {});
  const [reason, setReason] = useState('');

  return (
    <form action={action} className="space-y-3 rounded border border-border bg-elevated p-4">
      <h3 className="text-sm font-medium text-primary">Снять override</h3>
      <Feedback state={state} okText="Override снят — клиент вернулся к портфелю." />
      <input type="hidden" name="userId" value={userId} />
      <input
        name="reason"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        className={fieldCls}
        placeholder="Основание снятия (обязательно)"
      />
      <Submit label="Снять override" disabled={reason.trim().length === 0} variant="secondary" />
    </form>
  );
}

export function ClientLeveragePanel({
  userId,
  portfolios,
  assignedKey,
  hasOverride,
}: {
  userId: string;
  portfolios: PortfolioOpt[];
  assignedKey: string | null;
  hasOverride: boolean;
}) {
  return (
    <div className="space-y-4">
      <PortfolioForm userId={userId} portfolios={portfolios} assignedKey={assignedKey} />
      {hasOverride ? <ClearForm userId={userId} /> : <OverrideForm userId={userId} />}
    </div>
  );
}
