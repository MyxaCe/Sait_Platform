'use client';

import { useState } from 'react';
import { useFormState } from 'react-dom';
import { Input, Panel } from '@broker/ui';
import {
  changePortfolioLeverageAction,
  setClassOverrideAction,
  type LeverageActionState,
} from '@/lib/leverage/actions';
import { ActionResult, ArmedSubmit, Field, ReasonField } from '@/components/control/forms';

/**
 * Редактор портфеля (§3.9, admin only). Две формы-с-основанием, обе массовые —
 * действуют на всех клиентов портфеля сразу, поэтому обе в два шага (§6.7) и в
 * «опасной» панели:
 *  - базовое плечо портфеля (WEB-47);
 *  - планка класса — задать/снять (WEB-45; пустое плечо = снять).
 * Текст подтверждения говорит, что изменится в терминале. Server actions прежние.
 */

const MESSAGES: Record<string, string> = {
  forbidden: 'Недостаточно прав: изменение плеча — действие администратора.',
  missingReason: 'Нужно указать основание.',
  invalidLeverage: 'Плечо — целое число от 1 до 1000 (знаменатель 1:N).',
  noPortfolio: 'Портфель не найден.',
  alreadyInState: 'Значение не изменилось — записывать нечего.',
  terminalUnavailable:
    'Терминал не ответил — плечо НЕ изменено ни здесь, ни в терминале. Повторите позже.',
  terminalRefused:
    'Терминал отказал в смене плеча — изменение НЕ применено (код — в логе сервера).',
};

function LeverageInput({
  id,
  name,
  value,
  onChange,
  placeholder,
}: {
  id: string;
  name: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <span className="relative block">
      <span className="text-muted pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm">
        1:
      </span>
      <Input
        id={id}
        name={name}
        inputMode="numeric"
        controlSize="compact"
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/[^\d]/g, ''))}
        className="pl-7 tabular-nums"
        placeholder={placeholder}
      />
    </span>
  );
}

function whom(clientCount: number, isDefault: boolean): string {
  return `у ${clientCount} клиентов портфеля${isDefault ? ' и у всех новых клиентов' : ''}`;
}

function BaseLeverageForm({
  portfolioKey,
  baseLeverage,
  cryptoLeverage,
  clientCount,
  isDefault,
}: {
  portfolioKey: string;
  baseLeverage: number;
  cryptoLeverage: number | null;
  clientCount: number;
  isDefault: boolean;
}) {
  const [state, action] = useFormState<LeverageActionState, FormData>(
    changePortfolioLeverageAction,
    {},
  );
  const [value, setValue] = useState(String(baseLeverage));
  const [reason, setReason] = useState('');
  const changed = value.trim() !== '' && Number(value) !== baseLeverage;

  return (
    <form action={action} className="space-y-3">
      <h3 className="text-primary text-sm font-semibold">Базовое плечо</h3>
      <ActionResult state={state} okText="Плечо портфеля изменено, запись в журнале." messages={MESSAGES} />
      <input type="hidden" name="portfolioKey" value={portfolioKey} />
      <Field label="Новое базовое плечо" htmlFor="base-lev" hint={`Сейчас 1:${baseLeverage}`}>
        <LeverageInput id="base-lev" name="baseLeverage" value={value} onChange={setValue} />
      </Field>
      <ReasonField id="base-reason" value={reason} onChange={setReason} />
      <ArmedSubmit
        idle="Изменить базовое плечо"
        confirm="Да, изменить для всех"
        consequence={
          cryptoLeverage
            ? `База станет 1:${value} ${whom(clientCount, isDefault)}. В терминале плечо не изменится — действует планка crypto 1:${cryptoLeverage}.`
            : `Плечо станет 1:${value} ${whom(clientCount, isDefault)} и сразу уйдёт в терминал. Открытые позиции сохранят прежнее плечо.`
        }
        disabled={!changed || reason.trim().length === 0}
        resetKey={`${value}|${reason}`}
      />
    </form>
  );
}

function ClassOverrideForm({
  portfolioKey,
  cryptoLeverage,
  baseLeverage,
  clientCount,
  isDefault,
}: {
  portfolioKey: string;
  cryptoLeverage: number | null;
  baseLeverage: number;
  clientCount: number;
  isDefault: boolean;
}) {
  const [state, action] = useFormState<LeverageActionState, FormData>(setClassOverrideAction, {});
  const [cls, setCls] = useState('crypto');
  const [lev, setLev] = useState(cryptoLeverage ? String(cryptoLeverage) : '');
  const [reason, setReason] = useState('');
  const removing = lev.trim() === '';
  const ready = cls.trim().length > 0 && reason.trim().length > 0;
  const isCrypto = cls.trim() === 'crypto';

  return (
    <form action={action} className="space-y-3">
      <h3 className="text-primary text-sm font-semibold">Планка класса инструментов</h3>
      <ActionResult state={state} okText="Планка класса сохранена, запись в журнале." messages={MESSAGES} />
      <input type="hidden" name="portfolioKey" value={portfolioKey} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Класс" htmlFor="cls" hint="Терминал торгует классом crypto">
          <Input
            id="cls"
            name="instrumentClass"
            controlSize="compact"
            value={cls}
            onChange={(e) => setCls(e.target.value)}
          />
        </Field>
        <Field label="Плечо" htmlFor="cls-lev" hint="Пусто — снять планку">
          <LeverageInput id="cls-lev" name="leverage" value={lev} onChange={setLev} placeholder="нет" />
        </Field>
      </div>
      <ReasonField id="cls-reason" value={reason} onChange={setReason} />
      <ArmedSubmit
        idle={removing ? 'Снять планку класса' : 'Задать планку класса'}
        confirm={removing ? 'Да, снять' : 'Да, задать для всех'}
        consequence={
          isCrypto
            ? `В терминале станет 1:${removing ? baseLeverage : lev} ${whom(clientCount, isDefault)} (кроме клиентов с индивидуальным плечом). Открытые позиции сохранят прежнее плечо.`
            : `Планка класса «${cls}» ${removing ? 'будет снята' : `станет 1:${lev}`}. Терминал этот класс пока не торгует.`
        }
        disabled={!ready}
        resetKey={`${cls}|${lev}|${reason}`}
      />
    </form>
  );
}

export function PortfolioEditor({
  portfolioKey,
  title,
  baseLeverage,
  cryptoLeverage,
  clientCount,
  isDefault,
}: {
  portfolioKey: string;
  title: string;
  baseLeverage: number;
  cryptoLeverage: number | null;
  clientCount: number;
  isDefault: boolean;
}) {
  const common = { portfolioKey, baseLeverage, cryptoLeverage, clientCount, isDefault };
  return (
    <Panel
      tone="danger"
      title={`Изменить портфель ${title}`}
      description="Массовое действие: применяется ко всем клиентам портфеля сразу и уходит в терминал."
    >
      <div className="grid gap-6 lg:grid-cols-2">
        <BaseLeverageForm {...common} />
        <ClassOverrideForm {...common} />
      </div>
    </Panel>
  );
}
