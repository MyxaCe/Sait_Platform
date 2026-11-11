'use client';

import { useEffect, useId, useState } from 'react';
import { useFormState, useFormStatus } from 'react-dom';
import { Button, Callout, Checkbox, CopyButton, Input, Select, Textarea, cn } from '@broker/ui';
import {
  changeEmailAction,
  fixWithdrawalAddressAction,
  issueTempPasswordAction,
  liftHoldAction,
  sendResetLinkAction,
  setHoldAction,
  type TempPasswordState,
} from '@/lib/credentials/actions';
import { credentialErrorText, maskAddress, type ChecklistItem } from '@/lib/credentials/policy';
import { ActionForm, ConfirmFacts } from '../../../_money/ActionForm';

/**
 * Формы вкладки «Учётные данные» (функция 3, решения владельца 10.11).
 * Рисуются ТОЛЬКО тому, кто может править (admin или менеджер этого клиента),
 * — в «Опасной зоне». Каждая правка: основание + чек-лист проверки личности
 * (настраиваемый) + номер тикета (необязателен) → двухшаговое подтверждение
 * со сводкой «что именно» (концепция §6.6–6.7). Сервер перепроверяет права.
 */

export interface CredentialsFormsProps {
  userId: string;
  email: string;
  emailVerified: boolean;
  checklist: ChecklistItem[];
  minChecked: number;
  autoHoldEnabled: boolean;
  autoHoldHours: number;
  tempPasswordHours: number;
  tickets: { number: number; subject: string }[];
  withdrawals: { id: string; status: string; amountMinor: number; toAddress: string; requestedAt: string }[];
  hold: { active: boolean; kind: string | null; until: string | null };
}

const STATUS: Record<string, string> = { requested: 'подана', approved: 'одобрена' };

const usdt = (minor: number) =>
  `${(minor / 100).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDT`;

const when = (iso: string) => new Date(iso).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' });

/* ─── Проверка личности + тикет (общие поля правки) ──────────────────── */

function useChecks(items: ChecklistItem[], minChecked: number) {
  const [checked, setChecked] = useState<string[]>([]);
  const need = Math.min(minChecked, items.length);
  const valid = items.every((i) => !i.required || checked.includes(i.id)) && checked.length >= need;
  return { checked, setChecked, valid, need };
}

function VerifyFields({
  items,
  checks,
  tickets,
}: {
  items: ChecklistItem[];
  checks: ReturnType<typeof useChecks>;
  tickets: CredentialsFormsProps['tickets'];
}) {
  const id = useId();
  return (
    <div className="space-y-3">
      <fieldset className="space-y-1.5">
        <legend className="text-muted mb-1 text-xs">
          Проверка личности — отметьте, что сделано{checks.need > 0 ? ` (минимум ${checks.need})` : ''}
        </legend>
        {items.map((i) => (
          <label
            key={i.id}
            className="border-border bg-sunken hover:border-border-strong flex cursor-pointer items-start gap-2.5 rounded-md border px-3 py-2"
          >
            <Checkbox
              name="check"
              value={i.id}
              className="mt-0.5 size-4"
              checked={checks.checked.includes(i.id)}
              onChange={(e) =>
                checks.setChecked((prev) => (e.target.checked ? [...prev, i.id] : prev.filter((x) => x !== i.id)))
              }
            />
            <span className="text-primary text-[13px]">
              {i.label}
              {i.required ? <span className="text-negative"> · обязательно</span> : null}
            </span>
          </label>
        ))}
      </fieldset>
      <label className="block space-y-1.5">
        <span className="text-muted block text-xs">Тикет поддержки (если есть)</span>
        <Input name="ticket" controlSize="compact" list={`${id}-tickets`} placeholder="№ обращения" className="w-48" autoComplete="off" />
        <datalist id={`${id}-tickets`}>
          {tickets.map((t) => (
            <option key={t.number} value={String(t.number)}>
              {t.subject}
            </option>
          ))}
        </datalist>
      </label>
    </div>
  );
}

function Section({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  return (
    <section className="border-border space-y-3 border-t pt-5 first:border-t-0 first:pt-0">
      <div>
        <h3 className="text-primary text-sm font-semibold">{title}</h3>
        <p className="text-muted text-xs">{hint}</p>
      </div>
      {children}
    </section>
  );
}

/* ─── Email ──────────────────────────────────────────────────────────── */

function EmailForm(p: CredentialsFormsProps) {
  const checks = useChecks(p.checklist, p.minChecked);
  const [email, setEmail] = useState('');
  return (
    <ActionForm
      action={changeEmailAction}
      submitLabel="Сменить email"
      okText="Email изменён, письма поставлены в очередь, запись в журнале."
      errorText={credentialErrorText}
      reasonPlaceholder="Почему меняется email (обращение клиента, как проверена личность)"
      extraValid={checks.valid && email.trim().includes('@')}
      disarmOn={`${email}|${checks.checked.join()}`}
      confirm={{
        tone: 'danger',
        title: 'Сменить email клиента?',
        summary: (
          <ConfirmFacts
            rows={[
              ['Сейчас', p.email],
              ['Станет', <span key="n" className="text-negative">{email.trim().toLowerCase()}</span>],
            ]}
          />
        ),
        consequence: `Email сменится сразу и станет неподтверждённым. Письмо подтверждения уйдёт на новый адрес, уведомление «email изменён менеджером» — на прежний.${p.autoHoldEnabled ? ` Вывод будет заморожен на ${p.autoHoldHours} ч.` : ''}`,
        confirmLabel: 'Да, сменить email',
      }}
    >
      <input type="hidden" name="userId" value={p.userId} />
      <label className="block space-y-1.5">
        <span className="text-muted block text-xs">Новый email</span>
        <Input
          name="newEmail"
          type="email"
          controlSize="compact"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="name@example.com"
          autoComplete="off"
          className="max-w-sm"
        />
      </label>
      <VerifyFields items={p.checklist} checks={checks} tickets={p.tickets} />
    </ActionForm>
  );
}

/* ─── Пароль ─────────────────────────────────────────────────────────── */

function ResetLinkForm(p: CredentialsFormsProps) {
  const checks = useChecks(p.checklist, p.minChecked);
  return (
    <ActionForm
      action={sendResetLinkAction}
      submitLabel="Отправить ссылку сброса"
      variant="secondary"
      okText="Ссылка сброса отправлена, запись в журнале."
      errorText={credentialErrorText}
      reasonPlaceholder="Почему отправляется ссылка (письмо не дошло, клиент просит)"
      extraValid={checks.valid}
      disarmOn={checks.checked.join()}
      confirm={{
        tone: 'primary',
        title: 'Отправить ссылку сброса пароля?',
        summary: <ConfirmFacts rows={[['На email клиента', p.email], ['Статус email', p.emailVerified ? 'подтверждён' : 'не подтверждён']]} />,
        consequence: 'Клиент сам задаст новый пароль по ссылке (действует 30 минут). Пароль вы не видите и не задаёте.',
        confirmLabel: 'Да, отправить',
      }}
    >
      <input type="hidden" name="userId" value={p.userId} />
      <VerifyFields items={p.checklist} checks={checks} tickets={p.tickets} />
    </ActionForm>
  );
}

function Submit({ label, variant, disabled }: { label: string; variant: 'danger' | 'danger-outline'; disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="compact" variant={variant} loading={pending} disabled={pending || disabled}>
      {label}
    </Button>
  );
}

/**
 * Временный пароль: показывается менеджеру ОДИН раз — только в ответе действия,
 * в состоянии этой формы. После обновления страницы его не восстановить.
 */
function TempPasswordForm(p: CredentialsFormsProps) {
  const checks = useChecks(p.checklist, p.minChecked);
  const [state, action] = useFormState<TempPasswordState, FormData>(issueTempPasswordAction, {});
  const [reason, setReason] = useState('');
  const [armed, setArmed] = useState(false);
  const reasonId = useId();
  const valid = reason.trim().length > 0 && checks.valid;
  useEffect(() => setArmed(false), [state, checks.checked]);

  if (state.ok && state.password) {
    return (
      <div className="space-y-3" role="status">
        <Callout tone="warning" title="Временный пароль — показан один раз">
          Продиктуйте или передайте его клиенту по проверенному каналу. Повторно его увидеть нельзя — только выдать новый.
        </Callout>
        <div className="border-border-strong bg-sunken flex items-center justify-between gap-3 rounded-md border px-4 py-3">
          <code className="text-primary font-mono text-xl tracking-wider" data-testid="temp-password">
            {state.password}
          </code>
          <CopyButton value={state.password} label="временный пароль" />
        </div>
        <ul className="text-secondary list-disc space-y-1 pl-4 text-[13px]">
          <li>Действует до {when(state.expiresAt!)}; при входе клиент обязан задать свой пароль.</li>
          <li>Погашено сессий: {state.sessionsRevoked ?? 0}. Уведомление ушло на email клиента.</li>
          {state.autoHoldUntil ? <li>Вывод заморожен до {when(state.autoHoldUntil)}.</li> : null}
        </ul>
      </div>
    );
  }

  return (
    <form action={action} className="space-y-3">
      {state.error ? <Callout tone="negative">{credentialErrorText(state.error)}</Callout> : null}
      <input type="hidden" name="userId" value={p.userId} />
      <VerifyFields items={p.checklist} checks={checks} tickets={p.tickets} />
      <div className="space-y-1.5">
        <label htmlFor={reasonId} className="text-muted block text-xs">
          Основание
        </label>
        <Textarea
          id={reasonId}
          name="reason"
          rows={2}
          value={reason}
          onChange={(e) => {
            setReason(e.target.value);
            setArmed(false);
          }}
          placeholder="Почему выдаётся временный пароль (почта недоступна, клиент на звонке)"
        />
        <p className="text-muted text-xs">Обязательно. Пишется в неизменяемый журнал вместе с вашим логином.</p>
      </div>
      {armed ? (
        <div role="group" aria-label="Подтверждение действия" className="border-negative/40 bg-negative/[0.06] space-y-3 rounded-md border p-3">
          <p className="text-negative text-sm font-semibold">Выдать временный пароль?</p>
          <ConfirmFacts rows={[['Клиент', p.email], ['Срок временного пароля', `${p.tempPasswordHours} ч`]]} />
          <p className="text-negative text-[13px]">
            Текущий пароль клиента перестанет действовать, все его сессии будут погашены, на email уйдёт уведомление.
            {p.autoHoldEnabled ? ` Вывод будет заморожен на ${p.autoHoldHours} ч.` : ''}
          </p>
          <div className="flex flex-wrap gap-2">
            <Submit label="Да, выдать пароль" variant="danger" disabled={!valid} />
            <Button type="button" size="compact" variant="secondary" onClick={() => setArmed(false)}>
              Отмена
            </Button>
          </div>
        </div>
      ) : (
        <Button type="button" size="compact" variant="danger-outline" disabled={!valid} onClick={() => setArmed(true)}>
          Выдать временный пароль
        </Button>
      )}
    </form>
  );
}

/* ─── Адрес в заявке на вывод ────────────────────────────────────────── */

function AddressForm(p: CredentialsFormsProps) {
  const checks = useChecks(p.checklist, p.minChecked);
  const [wid, setWid] = useState(p.withdrawals[0]?.id ?? '');
  const [address, setAddress] = useState('');
  const w = p.withdrawals.find((x) => x.id === wid);
  return (
    <ActionForm
      action={fixWithdrawalAddressAction}
      submitLabel="Исправить адрес"
      okText="Адрес в заявке исправлен, запись в журнале."
      errorText={credentialErrorText}
      reasonPlaceholder="Почему исправляется адрес (клиент ошибся, как подтвердил новый)"
      extraValid={checks.valid && Boolean(w) && /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(address.trim())}
      disarmOn={`${wid}|${address}|${checks.checked.join()}`}
      confirm={{
        tone: 'danger',
        title: 'Исправить адрес получателя?',
        summary: w ? (
          <ConfirmFacts
            rows={[
              ['Заявка', `${usdt(w.amountMinor)} · ${STATUS[w.status] ?? w.status} · ${when(w.requestedAt)}`],
              ['Было', <span key="o" className="font-mono text-[13px] break-all">{w.toAddress}</span>],
              ['Станет', <span key="n" className="text-negative font-mono text-[13px] break-all">{address.trim()}</span>],
            ]}
          />
        ) : undefined,
        consequence: 'Отправка пойдёт на новый адрес. Перевод в блокчейне необратим — сверьте адрес с клиентом посимвольно.',
        confirmLabel: 'Да, исправить адрес',
      }}
    >
      <input type="hidden" name="userId" value={p.userId} />
      <label className="block space-y-1.5">
        <span className="text-muted block text-xs">Заявка на вывод (ещё не отправлена в сеть)</span>
        <Select name="withdrawalId" controlSize="compact" value={wid} onChange={(e) => setWid(e.target.value)} className="max-w-md">
          {p.withdrawals.map((x) => (
            <option key={x.id} value={x.id}>
              {usdt(x.amountMinor)} · {STATUS[x.status] ?? x.status} · на {maskAddress(x.toAddress)}
            </option>
          ))}
        </Select>
      </label>
      <label className="block space-y-1.5">
        <span className="text-muted block text-xs">Новый адрес TRON (TRC20)</span>
        <Input
          name="newAddress"
          controlSize="compact"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          placeholder="T…"
          autoComplete="off"
          spellCheck={false}
          className="max-w-md font-mono"
        />
        <span className="text-muted block text-xs">Сервер проверит контрольную сумму и не примет адрес контракта USDT.</span>
      </label>
      <VerifyFields items={p.checklist} checks={checks} tickets={p.tickets} />
    </ActionForm>
  );
}

/* ─── Заморозка вывода ───────────────────────────────────────────────── */

function HoldForm(p: CredentialsFormsProps) {
  const [mode, setMode] = useState<'hours' | 'until' | 'indefinite'>('hours');
  const [hours, setHours] = useState('48');
  const [until, setUntil] = useState('');
  const credentialsHold = p.hold.active && p.hold.kind !== 'money_flags';
  return (
    <ActionForm
      action={setHoldAction}
      submitLabel={credentialsHold ? 'Изменить срок заморозки' : 'Заморозить вывод'}
      variant="secondary"
      okText="Вывод заморожен, запись в журнале."
      errorText={credentialErrorText}
      reasonPlaceholder="Почему замораживается вывод"
      extraValid={mode === 'indefinite' || (mode === 'hours' ? Number(hours) > 0 : until.length > 0)}
      disarmOn={`${mode}|${hours}|${until}`}
      confirm={{
        tone: 'danger',
        title: 'Заморозить вывод средств?',
        summary: (
          <ConfirmFacts
            rows={[['Срок', mode === 'indefinite' ? 'бессрочно — до снятия вручную' : mode === 'hours' ? `${hours} ч` : until ? when(until) : '—']]}
          />
        ),
        consequence: 'Новые заявки на вывод не принимаются; ввод и торговля работают. Снять можно вручную с основанием.',
        confirmLabel: 'Да, заморозить',
      }}
    >
      <input type="hidden" name="userId" value={p.userId} />
      <div className="flex flex-wrap items-end gap-3">
        <label className="block space-y-1.5">
          <span className="text-muted block text-xs">Срок</span>
          <Select name="mode" controlSize="compact" value={mode} onChange={(e) => setMode(e.target.value as typeof mode)}>
            <option value="hours">на N часов</option>
            <option value="until">до даты</option>
            <option value="indefinite">бессрочно</option>
          </Select>
        </label>
        {mode === 'hours' ? (
          <label className="block space-y-1.5">
            <span className="text-muted block text-xs">Часов</span>
            <Input name="hours" controlSize="compact" inputMode="numeric" value={hours} onChange={(e) => setHours(e.target.value)} className="w-24 text-right tabular-nums" />
          </label>
        ) : null}
        {mode === 'until' ? (
          <label className="block space-y-1.5">
            <span className="text-muted block text-xs">До</span>
            <Input name="until" type="datetime-local" controlSize="compact" value={until} onChange={(e) => setUntil(e.target.value)} />
          </label>
        ) : null}
      </div>
      <label className="block space-y-1.5">
        <span className="text-muted block text-xs">Тикет поддержки (если есть)</span>
        <Input name="ticket" controlSize="compact" className="w-48" autoComplete="off" />
      </label>
    </ActionForm>
  );
}

function LiftForm(p: CredentialsFormsProps) {
  return (
    <ActionForm
      action={liftHoldAction}
      submitLabel="Снять заморозку вывода"
      variant="primary"
      okText="Заморозка снята, запись в журнале."
      errorText={credentialErrorText}
      reasonPlaceholder="Почему снимается заморозка (клиент подтвердил смену данных и т.п.)"
      confirm={{
        tone: 'primary',
        title: 'Снять заморозку вывода?',
        summary: (
          <ConfirmFacts
            rows={[
              ['Заморозка', p.hold.kind === 'credentials_auto' ? 'автоматическая, после правки данных' : 'по распоряжению менеджера'],
              ['Действует', p.hold.until ? `до ${when(p.hold.until)}` : 'бессрочно'],
            ]}
          />
        ),
        consequence: 'Клиент сразу сможет подавать заявки на вывод.',
        confirmLabel: 'Да, снять',
      }}
    >
      <input type="hidden" name="userId" value={p.userId} />
    </ActionForm>
  );
}

/* ─── Сборка ─────────────────────────────────────────────────────────── */

export function CredentialsForms(p: CredentialsFormsProps) {
  const credentialsHold = p.hold.active && p.hold.kind !== 'money_flags';
  return (
    <div className="space-y-5">
      <Section title="Email" hint="Меняется сразу; новый адрес — неподтверждённый, прежний получает уведомление.">
        <EmailForm {...p} />
      </Section>
      <Section title="Пароль" hint="Пароль вы не видите и не задаёте: ссылка сброса на email клиента или временный пароль с обязательной сменой.">
        <div className="grid gap-6 xl:grid-cols-2">
          <ResetLinkForm {...p} />
          <TempPasswordForm {...p} />
        </div>
      </Section>
      <Section
        title="Адрес в заявке на вывод"
        hint="Только заявки «подана»/«одобрена», пока нет хэша отправки. Адресной книги нет — адрес живёт в заявке."
      >
        {p.withdrawals.length > 0 ? (
          <AddressForm {...p} />
        ) : (
          <p className="text-muted text-[13px]">Заявок, в которых можно исправить адрес, нет.</p>
        )}
      </Section>
      <Section title="Заморозка вывода" hint="Тот же «Запрет вывода», что в денежных флагах; со сроком или бессрочно.">
        <div className={cn('grid gap-6', credentialsHold ? 'xl:grid-cols-2' : undefined)}>
          {credentialsHold ? <LiftForm {...p} /> : null}
          {p.hold.active && !credentialsHold ? (
            <Callout tone="neutral">Действует «Запрет вывода» из денежных флагов — его снимают финансы во вкладке «Деньги».</Callout>
          ) : (
            <HoldForm {...p} />
          )}
        </div>
      </Section>
    </div>
  );
}
