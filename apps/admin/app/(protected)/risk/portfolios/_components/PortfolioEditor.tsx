'use client';

import { useState } from 'react';
import { useFormState, useFormStatus } from 'react-dom';
import { Button } from '@broker/ui';
import {
  changePortfolioLeverageAction,
  setClassOverrideAction,
  type LeverageActionState,
} from '@/lib/leverage/actions';

/**
 * Редактор портфеля (§3.9, admin only). Две формы-с-основанием:
 *  - база портфеля — danger-подтверждение (массовый эффект, WEB-47);
 *  - планка класса — задать/снять (WEB-45).
 * Таблицы/форма — ЛОКАЛЬНО (анти-коллизия: `packages/ui` не трогаем, берём
 * только `Button` из токенов @broker/ui). Тёмная тема, без витринных анимаций.
 */

const MESSAGES: Record<string, string> = {
  forbidden: 'Недостаточно прав: изменение плеча — действие администратора.',
  missingReason: 'Нужно указать основание.',
  invalidLeverage: 'Плечо должно быть целым числом от 1 до 1000 (знаменатель 1:N).',
  noPortfolio: 'Портфель не найден.',
  alreadyInState: 'Значение не изменилось — записывать нечего.',
  terminalUnavailable: 'Терминал не ответил — плечо НЕ изменено ни на сайте, ни в терминале. Повторите позже.',
  terminalRefused: 'Терминал отказал в смене плеча — изменение НЕ применено (код — в логе сервера).',
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

const inputCls =
  'w-24 rounded border border-border bg-base px-2 py-1 text-sm tabular-nums text-primary outline-none focus:border-accent';
const textCls =
  'w-full rounded border border-border bg-base px-2 py-1 text-sm text-primary outline-none focus:border-accent';

function Submit({ label, disabled, variant = 'primary' }: { label: string; disabled: boolean; variant?: 'primary' | 'danger' | 'secondary' }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant={variant} disabled={pending || disabled}>
      {pending ? '…' : label}
    </Button>
  );
}

function BaseLeverageForm({ portfolioKey, baseLeverage }: { portfolioKey: string; baseLeverage: number }) {
  const [state, action] = useFormState<LeverageActionState, FormData>(changePortfolioLeverageAction, {});
  const [value, setValue] = useState(String(baseLeverage));
  const [reason, setReason] = useState('');
  const [confirming, setConfirming] = useState(false);
  const changed = value.trim() !== '' && Number(value) !== baseLeverage;
  const ready = changed && reason.trim().length > 0;

  return (
    <form action={action} className="space-y-2 rounded border border-negative/30 bg-negative/5 p-3">
      <Feedback state={state} okText="Плечо портфеля изменено (глобально)." />
      <input type="hidden" name="portfolioKey" value={portfolioKey} />
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <label className="text-secondary">Базовое плечо 1:</label>
        <input
          name="baseLeverage"
          inputMode="numeric"
          value={value}
          onChange={(e) => setValue(e.target.value.replace(/[^\d]/g, ''))}
          className={inputCls}
        />
      </div>
      <input
        name="reason"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        className={textCls}
        placeholder="Основание (обязательно) — массовое действие"
      />
      {confirming ? (
        <div className="space-y-2">
          <p className="text-sm text-negative">
            Подтвердите: плечо изменится у всех клиентов портфеля «{portfolioKey}».
          </p>
          <div className="flex gap-2">
            <Submit label="Да, изменить глобально" disabled={!ready} variant="danger" />
            <Button type="button" variant="secondary" onClick={() => setConfirming(false)}>
              Отмена
            </Button>
          </div>
        </div>
      ) : (
        <Button type="button" variant="danger" disabled={!ready} onClick={() => setConfirming(true)}>
          Изменить плечо портфеля
        </Button>
      )}
    </form>
  );
}

function ClassOverrideForm({ portfolioKey }: { portfolioKey: string }) {
  const [state, action] = useFormState<LeverageActionState, FormData>(setClassOverrideAction, {});
  const [cls, setCls] = useState('');
  const [lev, setLev] = useState('');
  const [reason, setReason] = useState('');
  const ready = cls.trim().length > 0 && reason.trim().length > 0;

  return (
    <form action={action} className="space-y-2 rounded border border-border bg-base/40 p-3">
      <Feedback state={state} okText="Планка класса сохранена." />
      <input type="hidden" name="portfolioKey" value={portfolioKey} />
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <input
          name="instrumentClass"
          value={cls}
          onChange={(e) => setCls(e.target.value)}
          className={`${inputCls} w-28`}
          placeholder="класс (crypto)"
        />
        <label className="text-secondary">плечо 1:</label>
        <input
          name="leverage"
          inputMode="numeric"
          value={lev}
          onChange={(e) => setLev(e.target.value.replace(/[^\d]/g, ''))}
          className={inputCls}
          placeholder="пусто = снять"
        />
      </div>
      <input
        name="reason"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        className={textCls}
        placeholder="Основание (обязательно)"
      />
      <Submit label={lev.trim() === '' ? 'Снять планку класса' : 'Задать планку класса'} disabled={!ready} variant="secondary" />
      <p className="text-xs text-secondary">
        Пустое поле плеча снимает планку — класс возвращается к базе портфеля.
      </p>
    </form>
  );
}

export function PortfolioEditor({
  portfolioKey,
  baseLeverage,
}: {
  portfolioKey: string;
  baseLeverage: number;
  classOverrides: Readonly<Record<string, number>>;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <BaseLeverageForm portfolioKey={portfolioKey} baseLeverage={baseLeverage} />
      <ClassOverrideForm portfolioKey={portfolioKey} />
    </div>
  );
}
