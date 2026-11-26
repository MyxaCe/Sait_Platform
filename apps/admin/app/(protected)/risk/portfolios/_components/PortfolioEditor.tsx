'use client';

import { useState } from 'react';
import { useFormState } from 'react-dom';
import { Input, Panel, Textarea } from '@broker/ui';
import { changePortfolioFeesAction, type FeesActionState } from '@/lib/fees/actions';
import {
  changePortfolioLeverageAction,
  setClassLeverageTableAction,
  setPortfolioMinBalanceAction,
  type LeverageActionState,
} from '@/lib/leverage/actions';
import { LEVERAGE_CLASSES, LEVERAGE_CLASS_LABELS } from '@/lib/leverage/classes';
import { ActionResult, ArmedSubmit, Field, ReasonField } from '@/components/control/forms';

const MESSAGES: Record<string, string> = {
  forbidden: 'Недостаточно прав: изменение плеча — действие администратора.',
  missingReason: 'Нужно указать основание.',
  invalidLeverage: 'Плечо — целое число от 1 до 1000 (знаменатель 1:N).',
  invalidClass: 'Неизвестная категория инструментов.',
  noPortfolio: 'Портфель не найден.',
  alreadyInState: 'Значение не изменилось — записывать нечего.',
  invalidAmount: 'Сумма — число USDT, до двух знаков после запятой.',
  defaultNotZero: 'У портфеля по умолчанию порог всегда 0: с него начинают все клиенты.',
  notMonotonic: 'Порог должен расти по порядку портфелей: у старшего портфеля не меньше, чем у младшего.',
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
  classOverrides,
  clientCount,
  isDefault,
}: {
  portfolioKey: string;
  baseLeverage: number;
  classOverrides: Readonly<Record<string, number>>;
  clientCount: number;
  isDefault: boolean;
}) {
  const own = LEVERAGE_CLASSES.filter((c) => classOverrides[c] !== undefined).map((c) => LEVERAGE_CLASS_LABELS[c]);
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
        consequence={`База станет 1:${value} ${whom(clientCount, isDefault)} для всех категорий${own.length > 0 ? `, кроме своих: ${own.join(', ')}` : ''}, и сразу уйдёт в терминал. Открытые позиции сохранят прежнее плечо.`}
        disabled={!changed || reason.trim().length === 0}
        resetKey={`${value}|${reason}`}
      />
    </form>
  );
}

function ClassTableForm({
  portfolioKey,
  classOverrides,
  baseLeverage,
  clientCount,
  isDefault,
}: {
  portfolioKey: string;
  classOverrides: Readonly<Record<string, number>>;
  baseLeverage: number;
  clientCount: number;
  isDefault: boolean;
}) {
  const [state, action] = useFormState<LeverageActionState, FormData>(setClassLeverageTableAction, {});
  const initial = Object.fromEntries(
    LEVERAGE_CLASSES.map((c) => [c, classOverrides[c] !== undefined ? String(classOverrides[c]) : '']),
  ) as Record<string, string>;
  const [values, setValues] = useState(initial);
  const [reason, setReason] = useState('');
  const changed = LEVERAGE_CLASSES.filter((c) => values[c]!.trim() !== initial[c]);
  const summary = changed
    .map((c) => `${LEVERAGE_CLASS_LABELS[c]} ${values[c]!.trim() === '' ? `→ база 1:${baseLeverage}` : `→ 1:${values[c]}`}`)
    .join(', ');

  return (
    <form action={action} className="space-y-3">
      <h3 className="text-primary text-sm font-semibold">Плечо по категориям инструментов</h3>
      <ActionResult state={state} okText="Плечо по категориям сохранено, запись в журнале." messages={MESSAGES} />
      <input type="hidden" name="portfolioKey" value={portfolioKey} />
      <div className="grid gap-3 sm:grid-cols-2">
        {LEVERAGE_CLASSES.map((c) => (
          <Field
            key={c}
            label={LEVERAGE_CLASS_LABELS[c]}
            htmlFor={`cls-${c}`}
            hint={classOverrides[c] !== undefined ? `Сейчас 1:${classOverrides[c]}` : `Сейчас базовое 1:${baseLeverage}`}
          >
            <LeverageInput
              id={`cls-${c}`}
              name={`class.${c}`}
              value={values[c]!}
              onChange={(v) => setValues((prev) => ({ ...prev, [c]: v }))}
              placeholder={`база ${baseLeverage}`}
            />
          </Field>
        ))}
      </div>
      <p className="text-muted text-xs">Пустое поле — категория торгуется с базовым плечом портфеля.</p>
      <ReasonField id="cls-reason" value={reason} onChange={setReason} />
      <ArmedSubmit
        idle="Сохранить плечо по категориям"
        confirm="Да, применить для всех"
        consequence={`${summary} — ${whom(clientCount, isDefault)} (кроме клиентов с индивидуальным плечом), сразу уйдёт в терминал. Открытые позиции сохранят прежнее плечо.`}
        disabled={changed.length === 0 || reason.trim().length === 0}
        resetKey={`${JSON.stringify(values)}|${reason}`}
      />
    </form>
  );
}

function MinBalanceForm({
  portfolioKey,
  minBalanceMinor,
  isDefault,
}: {
  portfolioKey: string;
  minBalanceMinor: number;
  isDefault: boolean;
}) {
  const [state, action] = useFormState<LeverageActionState, FormData>(setPortfolioMinBalanceAction, {});
  const current = (minBalanceMinor / 100).toFixed(2).replace(/\.00$/, '');
  const [value, setValue] = useState(current);
  const [reason, setReason] = useState('');
  const changed = value.trim() !== '' && value.trim().replace(',', '.') !== current;
  if (isDefault) {
    return (
      <div className="space-y-1">
        <h3 className="text-primary text-sm font-semibold">Минимальный баланс для перехода</h3>
        <p className="text-muted text-xs">Портфель по умолчанию: его получают все клиенты при регистрации, порог 0.</p>
      </div>
    );
  }
  return (
    <form action={action} className="space-y-3" data-min-balance-form>
      <h3 className="text-primary text-sm font-semibold">Минимальный баланс для перехода, USDT</h3>
      <ActionResult state={state} okText="Порог сохранён, запись в журнале." messages={MESSAGES} />
      <input type="hidden" name="portfolioKey" value={portfolioKey} />
      <Field
        label="Порог реального баланса"
        htmlFor="min-balance"
        hint={`Сейчас ${current} USDT. Клиент переходит на этот тип счёта автоматически, когда баланс реального счёта достигает порога. Обратно не понижается.`}
      >
        <Input
          id="min-balance"
          name="minBalance"
          inputMode="decimal"
          controlSize="compact"
          value={value}
          onChange={(e) => setValue(e.target.value.replace(/[^\d.,]/g, ''))}
          className="tabular-nums"
        />
      </Field>
      <ReasonField id="min-balance-reason" value={reason} onChange={setReason} />
      <ArmedSubmit
        idle="Сохранить порог"
        confirm="Да, сохранить"
        consequence={`Клиенты с балансом от ${value || 0} USDT будут переведены на этот тип счёта при следующей проверке. Уже переведённые клиенты не понижаются.`}
        disabled={!changed || reason.trim().length === 0}
        resetKey={`${value}|${reason}`}
      />
    </form>
  );
}

export function PortfolioEditor({
  portfolioKey,
  title,
  baseLeverage,
  classOverrides,
  clientCount,
  isDefault,
  markupBps,
  commissionBps,
  instruments,
  description,
  minBalanceMinor,
}: {
  portfolioKey: string;
  title: string;
  baseLeverage: number;
  classOverrides: Readonly<Record<string, number>>;
  clientCount: number;
  isDefault: boolean;
  markupBps: number;
  commissionBps: number;
  instruments: string | null;
  description: string | null;
  minBalanceMinor: number;
}) {
  const common = { portfolioKey, baseLeverage, classOverrides, clientCount, isDefault };
  return (
    <Panel
      tone="danger"
      title={`Изменить портфель ${title}`}
      description="Массовое действие: плечо и тариф применяются ко всем клиентам портфеля сразу и уходят в терминал."
    >
      <div className="grid gap-6 lg:grid-cols-2">
        <BaseLeverageForm {...common} />
        <ClassTableForm {...common} />
      </div>
      <div className="border-border mt-6 border-t pt-6">
        <MinBalanceForm portfolioKey={portfolioKey} minBalanceMinor={minBalanceMinor} isDefault={isDefault} />
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
