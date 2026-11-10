'use client';

import { useState } from 'react';
import { useFormState } from 'react-dom';
import { Input, Panel, Textarea } from '@broker/ui';
import { changePortfolioFeesAction, type FeesActionState } from '@/lib/fees/actions';
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

const FEE_MESSAGES: Record<string, string> = {
  ...MESSAGES,
  forbidden: 'Недостаточно прав: тариф портфеля — действие администратора.',
  invalidFees: 'Ставки — целые базисные пункты от 0 до 500 (1 б.п. = 0,01 %).',
  noChange: 'Изменений нет — записывать нечего.',
  terminalUnavailable:
    'Терминал не ответил — тариф НЕ изменён ни здесь, ни в терминале. Повторите позже.',
  terminalRefused: 'Терминал отказал в смене тарифа — изменение НЕ применено (код — в логе сервера).',
};

function BpsInput({ id, name, value, onChange }: { id: string; name: string; value: string; onChange: (v: string) => void }) {
  return (
    <span className="relative block">
      <Input
        id={id}
        name={name}
        inputMode="numeric"
        controlSize="compact"
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/[^\d]/g, ''))}
        className="pr-12 tabular-nums"
      />
      <span className="text-muted pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs">б.п.</span>
    </span>
  );
}

const pctOf = (v: string) =>
  v === '' ? '—' : `${(Number(v) / 100).toLocaleString('ru-RU', { maximumFractionDigits: 2 })} %`;

/** Тариф портфеля: наценка + комиссия (уходят в терминал) и условия для /accounts. */
function FeesForm({
  portfolioKey,
  markupBps,
  commissionBps,
  instruments,
  description,
  clientCount,
  isDefault,
}: {
  portfolioKey: string;
  markupBps: number;
  commissionBps: number;
  instruments: string | null;
  description: string | null;
  clientCount: number;
  isDefault: boolean;
}) {
  const [state, action] = useFormState<FeesActionState, FormData>(changePortfolioFeesAction, {});
  const [markup, setMarkup] = useState(String(markupBps));
  const [commission, setCommission] = useState(String(commissionBps));
  const [instr, setInstr] = useState(instruments ?? '');
  const [desc, setDesc] = useState(description ?? '');
  const [reason, setReason] = useState('');
  const feesChanged = Number(markup) !== markupBps || Number(commission) !== commissionBps;
  const anyChanged = feesChanged || instr.trim() !== (instruments ?? '') || desc.trim() !== (description ?? '');
  const valid = markup !== '' && commission !== '' && Number(markup) <= 500 && Number(commission) <= 500;

  return (
    <form action={action} className="space-y-3">
      <h3 className="text-primary text-sm font-semibold">Тариф: наценка и комиссия</h3>
      <ActionResult state={state} okText="Тариф портфеля сохранён, запись в журнале." messages={FEE_MESSAGES} />
      <input type="hidden" name="portfolioKey" value={portfolioKey} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Наценка на спред" htmlFor="fee-markup" hint={`${pctOf(markup)} к цене исполнения · сейчас ${markupBps} б.п.`}>
          <BpsInput id="fee-markup" name="markupBps" value={markup} onChange={setMarkup} />
        </Field>
        <Field label="Комиссия" htmlFor="fee-commission" hint={`${pctOf(commission)} от нотионала · сейчас ${commissionBps} б.п.`}>
          <BpsInput id="fee-commission" name="commissionBps" value={commission} onChange={setCommission} />
        </Field>
      </div>
      <Field
        label="Инструменты (для страницы «Типы счетов»)"
        htmlFor="fee-instr"
        hint="Текст для клиента, например «Криптовалютные пары». Пусто — не показывается."
      >
        <Input id="fee-instr" name="instruments" controlSize="compact" value={instr} onChange={(e) => setInstr(e.target.value)} />
      </Field>
      <Field label="Описание типа счёта" htmlFor="fee-desc">
        <Textarea id="fee-desc" name="description" rows={2} value={desc} onChange={(e) => setDesc(e.target.value)} />
      </Field>
      <ReasonField id="fee-reason" value={reason} onChange={setReason} />
      <ArmedSubmit
        idle="Сохранить тариф"
        confirm={feesChanged ? 'Да, применить для всех' : 'Да, сохранить'}
        consequence={
          feesChanged
            ? `Наценка ${pctOf(markup)} и комиссия ${pctOf(commission)} станут действовать ${whom(clientCount, isDefault)} и сразу уйдут в терминал — для новых сделок. Если терминал не ответит, не изменится ничего.`
            : 'Изменятся только тексты условий типа счёта — в терминал ничего не уходит.'
        }
        disabled={!anyChanged || !valid || reason.trim().length === 0}
        resetKey={`${markup}|${commission}|${instr}|${desc}|${reason}`}
      />
    </form>
  );
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
  markupBps,
  commissionBps,
  instruments,
  description,
}: {
  portfolioKey: string;
  title: string;
  baseLeverage: number;
  cryptoLeverage: number | null;
  clientCount: number;
  isDefault: boolean;
  markupBps: number;
  commissionBps: number;
  instruments: string | null;
  description: string | null;
}) {
  const common = { portfolioKey, baseLeverage, cryptoLeverage, clientCount, isDefault };
  return (
    <Panel
      tone="danger"
      title={`Изменить портфель ${title}`}
      description="Массовое действие: плечо и тариф применяются ко всем клиентам портфеля сразу и уходят в терминал."
    >
      <div className="grid gap-6 lg:grid-cols-2">
        <BaseLeverageForm {...common} />
        <ClassOverrideForm {...common} />
      </div>
      <div className="border-border mt-6 border-t pt-6">
        <FeesForm
          portfolioKey={portfolioKey}
          markupBps={markupBps}
          commissionBps={commissionBps}
          instruments={instruments}
          description={description}
          clientCount={clientCount}
          isDefault={isDefault}
        />
      </div>
    </Panel>
  );
}
