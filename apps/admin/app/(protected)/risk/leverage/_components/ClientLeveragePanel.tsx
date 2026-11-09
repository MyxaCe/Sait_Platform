'use client';

import { useState } from 'react';
import { useFormState } from 'react-dom';
import { Input, Panel, Select } from '@broker/ui';
import {
  setClientPortfolioAction,
  setClientOverrideAction,
  clearClientOverrideAction,
  type LeverageActionState,
} from '@/lib/leverage/actions';
import { ActionResult, Field, ReasonField, SubmitButton } from '@/components/control/forms';

/**
 * Панель управления плечом клиента (§3.8, admin only). Три формы-с-основанием:
 *  - назначить портфель (WEB-44, атрибут клиента);
 *  - выдать индивидуальное плечо по заявке (WEB-46 — № заявки обязателен);
 *  - снять индивидуальное плечо (вернуть к портфелю).
 * Под каждой формой — что станет в терминале после сохранения (чтобы оператор
 * видел последствие до клика). Server actions прежние.
 */

const MESSAGES: Record<string, string> = {
  forbidden: 'Недостаточно прав: управление плечом — действие администратора.',
  invalidClient: 'Клиент не указан.',
  missingReason: 'Нужно указать основание (для индивидуального плеча — ещё и № заявки).',
  invalidLeverage: 'Плечо — целое число от 1 до 1000 (знаменатель 1:N).',
  noClient: 'Клиент не найден.',
  noPortfolio: 'Портфель не найден (или не задан портфель по умолчанию).',
  noOverride: 'Индивидуального плеча нет — снимать нечего.',
  alreadyInState: 'Клиент уже в этом портфеле — изменений нет.',
  terminalUnavailable:
    'Терминал не ответил — плечо НЕ изменено ни здесь, ни в терминале. Повторите позже.',
  terminalRefused:
    'Терминал отказал в смене плеча — изменение НЕ применено (код — в логе сервера).',
};

interface PortfolioOpt {
  key: string;
  title: string;
  baseLeverage: number;
  /** Планка класса crypto (то, что реально уходит в терминал), или null. */
  cryptoLeverage: number | null;
}

function Outcome({ children }: { children: React.ReactNode }) {
  return <p className="text-secondary text-xs">{children}</p>;
}

function PortfolioForm({
  userId,
  portfolios,
  assignedKey,
  override,
}: {
  userId: string;
  portfolios: PortfolioOpt[];
  assignedKey: string | null;
  override: number | null;
}) {
  const [state, action] = useFormState<LeverageActionState, FormData>(setClientPortfolioAction, {});
  const [key, setKey] = useState(assignedKey ?? portfolios[0]?.key ?? '');
  const [reason, setReason] = useState('');
  const changed = key !== '' && key !== assignedKey;
  const target = portfolios.find((p) => p.key === key);
  const terminal = override ?? target?.cryptoLeverage ?? target?.baseLeverage ?? null;

  return (
    <form action={action} className="space-y-3">
      <ActionResult
        state={state}
        okText="Портфель назначен, плечо отправлено в терминал, запись в журнале."
        messages={MESSAGES}
      />
      <input type="hidden" name="userId" value={userId} />
      <Field label="Портфель" htmlFor="portfolioKey">
        <Select
          id="portfolioKey"
          name="portfolioKey"
          controlSize="compact"
          value={key}
          onChange={(e) => setKey(e.target.value)}
        >
          {portfolios.map((p) => (
            <option key={p.key} value={p.key}>
              {p.title} — 1:{p.cryptoLeverage ?? p.baseLeverage}
              {p.key === assignedKey ? ' (текущий)' : ''}
            </option>
          ))}
        </Select>
      </Field>
      <ReasonField id="portfolio-reason" value={reason} onChange={setReason} />
      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton variant="secondary" disabled={!changed || reason.trim().length === 0}>
          Назначить портфель
        </SubmitButton>
        {changed && terminal ? (
          <Outcome>
            В терминале станет <span className="text-primary font-medium">1:{terminal}</span>
            {override ? ' (индивидуальное плечо сохранится)' : ''}
          </Outcome>
        ) : null}
      </div>
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
    <form action={action} className="space-y-3">
      <ActionResult
        state={state}
        okText="Индивидуальное плечо выдано, отправлено в терминал, запись в журнале."
        messages={MESSAGES}
      />
      <input type="hidden" name="userId" value={userId} />
      <div className="grid gap-3 sm:grid-cols-[9rem_minmax(0,1fr)]">
        <Field label="Плечо" htmlFor="ov-leverage" hint="от 1 до 1000">
          <span className="relative block">
            <span className="text-muted pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm">
              1:
            </span>
            <Input
              id="ov-leverage"
              name="leverage"
              inputMode="numeric"
              controlSize="compact"
              value={lev}
              onChange={(e) => setLev(e.target.value.replace(/[^\d]/g, ''))}
              className="pl-7 tabular-nums"
              placeholder="200"
            />
          </span>
        </Field>
        <Field label="№ заявки клиента" htmlFor="ov-ticket">
          <Input
            id="ov-ticket"
            name="ticket"
            controlSize="compact"
            value={ticket}
            onChange={(e) => setTicket(e.target.value)}
            placeholder="например, REQ-2026-114"
          />
        </Field>
      </div>
      <ReasonField id="override-reason" value={reason} onChange={setReason} />
      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton disabled={!ready}>Выдать плечо</SubmitButton>
        {lev ? (
          <Outcome>
            В терминале станет <span className="text-primary font-medium">1:{lev}</span> — поверх
            портфеля
          </Outcome>
        ) : null}
      </div>
    </form>
  );
}

function ClearForm({ userId, fallback }: { userId: string; fallback: number | null }) {
  const [state, action] = useFormState<LeverageActionState, FormData>(clearClientOverrideAction, {});
  const [reason, setReason] = useState('');

  return (
    <form action={action} className="space-y-3">
      <ActionResult
        state={state}
        okText="Индивидуальное плечо снято — клиент вернулся к портфелю, запись в журнале."
        messages={MESSAGES}
      />
      <input type="hidden" name="userId" value={userId} />
      <ReasonField id="clear-reason" value={reason} onChange={setReason} label="Основание снятия" />
      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton variant="secondary" disabled={reason.trim().length === 0}>
          Снять индивидуальное плечо
        </SubmitButton>
        {fallback ? (
          <Outcome>
            В терминале станет <span className="text-primary font-medium">1:{fallback}</span> — по
            портфелю
          </Outcome>
        ) : null}
      </div>
    </form>
  );
}

export function ClientLeveragePanel({
  userId,
  portfolios,
  assignedKey,
  override,
}: {
  userId: string;
  portfolios: PortfolioOpt[];
  assignedKey: string | null;
  override: { leverage: number; ticket: string } | null;
}) {
  const current = portfolios.find((p) => p.key === assignedKey);
  const fallback = current ? (current.cryptoLeverage ?? current.baseLeverage) : null;
  return (
    <div className="space-y-5">
      <Panel title="Портфель клиента" description="Плечо клиента следует за портфелем, если нет индивидуального.">
        <PortfolioForm
          userId={userId}
          portfolios={portfolios}
          assignedKey={assignedKey}
          override={override?.leverage ?? null}
        />
      </Panel>
      {override ? (
        <Panel
          title="Снять индивидуальное плечо"
          description={`Сейчас 1:${override.leverage} по заявке ${override.ticket}.`}
        >
          <ClearForm userId={userId} fallback={fallback} />
        </Panel>
      ) : (
        <Panel
          title="Индивидуальное плечо по заявке"
          description="Только по письменной заявке клиента. Перекрывает портфель и планку класса."
        >
          <OverrideForm userId={userId} />
        </Panel>
      )}
    </div>
  );
}
