'use client';

import { useState, type ReactNode } from 'react';
import { Checkbox, Input, Money, Select } from '@broker/ui';
import {
  accrueCashbackAction,
  accrueRevshareAction,
  finalizeContestAction,
  reassignReferralAction,
  rewardDecisionAction,
  savePartnerAction,
  setPromotionStatusAction,
  syncQueueAction,
  updatePromoSettingsAction,
  type PromoActionState,
} from '@/lib/promo/actions';
import { promoErrorText } from '@/lib/promo/labels';
import { ActionForm, ConfirmFacts, type ConfirmSpec } from '../../_money/ActionForm';

/**
 * Формы-с-основанием зоны «Акции и партнёры». Вид и шаги — общие с денежной
 * зоной (`ActionForm`): основание обязательно и пишется в журнал; денежное и
 * опасное — в два шага со сводкой. Личность оператора форма не несёт (Р-451).
 */

export function PromoActionForm(props: {
  action: (s: PromoActionState, fd: FormData) => Promise<PromoActionState>;
  submitLabel: string;
  okText: string;
  children?: ReactNode;
  variant?: 'primary' | 'secondary' | 'danger';
  confirm?: ConfirmSpec;
  disarmOn?: unknown;
  reasonPlaceholder?: string;
  extraValid?: boolean;
}) {
  return <ActionForm {...props} errorText={promoErrorText} />;
}

export function FieldBox({ label, htmlFor, hint, children }: { label: ReactNode; htmlFor?: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="min-w-0 space-y-1.5">
      <label htmlFor={htmlFor} className="text-muted block text-xs">
        {label}
      </label>
      {children}
      {hint ? <p className="text-muted text-xs">{hint}</p> : null}
    </div>
  );
}

export function CheckCard({ name, defaultChecked, title, hint }: { name: string; defaultChecked: boolean; title: string; hint?: string }) {
  return (
    <label className="border-border bg-sunken hover:border-border-strong flex cursor-pointer items-start gap-3 rounded-md border px-3 py-2.5">
      <Checkbox name={name} defaultChecked={defaultChecked} className="mt-0.5 size-4" />
      <span className="min-w-0">
        <span className="text-primary block text-sm font-medium">{title}</span>
        {hint ? <span className="text-muted block text-xs">{hint}</span> : null}
      </span>
    </label>
  );
}

export function UsdtInput({ id, name, defaultValue, placeholder }: { id: string; name: string; defaultValue?: string; placeholder?: string }) {
  return (
    <span className="relative block">
      <Input
        id={id}
        name={name}
        defaultValue={defaultValue}
        placeholder={placeholder}
        controlSize="compact"
        inputMode="decimal"
        autoComplete="off"
        className="pr-14 text-right tabular-nums"
      />
      <span className="text-muted pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs">USDT</span>
    </span>
  );
}

function prevMonth(): string {
  const d = new Date();
  const p = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1));
  return `${p.getUTCFullYear()}-${String(p.getUTCMonth() + 1).padStart(2, '0')}`;
}

/* ── Статус акции ─────────────────────────────────────────────────────── */

const STATUS_FORMS: Record<string, { to: string; label: string; ok: string; danger?: boolean; consequence: string }[]> = {
  draft: [
    { to: 'active', label: 'Запустить акцию', ok: 'Акция запущена.', consequence: 'Клиенты увидят акцию в кабинете и смогут участвовать. Условия идущей акции менять нельзя — только через паузу.' },
    { to: 'ended', label: 'Отменить черновик', ok: 'Черновик закрыт.', danger: true, consequence: 'Акция закроется, не начавшись. Обратного перехода нет.' },
  ],
  active: [
    { to: 'paused', label: 'Поставить на паузу', ok: 'Акция на паузе.', consequence: 'Новые участия и постановка в очередь остановятся. Стоящие в очереди начисления можно рассмотреть.' },
    { to: 'ended', label: 'Завершить акцию', ok: 'Акция завершена.', danger: true, consequence: 'Новые участия закроются навсегда. Уже вступившие доводят условия в своём окне; их начисления по-прежнему решаются в очереди.' },
  ],
  paused: [
    { to: 'active', label: 'Возобновить', ok: 'Акция снова идёт.', consequence: 'Клиенты снова увидят акцию; движок продолжит оценку участников.' },
    { to: 'ended', label: 'Завершить акцию', ok: 'Акция завершена.', danger: true, consequence: 'Новые участия закроются навсегда.' },
  ],
};

export function StatusForms({ id, status }: { id: string; status: string }) {
  const forms = STATUS_FORMS[status] ?? [];
  if (forms.length === 0) return <p className="text-muted text-[13px]">Акция завершена — переходов нет.</p>;
  return (
    <div className="space-y-5">
      {forms.map((f) => (
        <div key={f.to} className={f.danger ? 'border-negative/25 space-y-2 border-t pt-4' : 'space-y-2'}>
          <PromoActionForm
            action={setPromotionStatusAction}
            submitLabel={f.label}
            okText={`${f.ok} Запись в журнале.`}
            variant={f.danger ? 'danger' : 'primary'}
            confirm={{ tone: f.danger ? 'danger' : 'primary', title: `${f.label}?`, consequence: f.consequence, confirmLabel: `Да, ${f.label.toLowerCase()}` }}
          >
            <input type="hidden" name="id" value={id} />
            <input type="hidden" name="to" value={f.to} />
          </PromoActionForm>
        </div>
      ))}
    </div>
  );
}

/* ── Пересчёт и кешбэк ────────────────────────────────────────────────── */

export function SyncForm({ id }: { id?: string }) {
  return (
    <PromoActionForm
      action={syncQueueAction}
      submitLabel="Пересчитать очередь"
      variant="secondary"
      okText="Пересчитано, запись в журнале."
      reasonPlaceholder="Напр.: плановая проверка условий перед разбором очереди"
    >
      {id ? <input type="hidden" name="id" value={id} /> : null}
      <p className="text-muted text-xs">
        Движок оценит участников по фактам (депозиты, KYC, сделки, выводы) и поставит выполнивших условия
        в очередь. Деньги не двигаются — только заявки на начисление.
      </p>
    </PromoActionForm>
  );
}

export function CashbackForm({ id }: { id: string }) {
  const [period, setPeriod] = useState(prevMonth());
  return (
    <PromoActionForm
      action={accrueCashbackAction}
      submitLabel="Рассчитать кешбэк за месяц"
      okText="Кешбэк рассчитан, начисления в очереди."
      disarmOn={period}
      confirm={{
        tone: 'primary',
        title: `Рассчитать кешбэк за ${period}?`,
        consequence: 'Каждому участнику — процент от уплаченных им наценки и комиссии за месяц. Начисления встанут в очередь; деньги — только после одобрения.',
        confirmLabel: 'Да, рассчитать',
      }}
    >
      <input type="hidden" name="id" value={id} />
      <FieldBox label="Месяц (закрытый)" htmlFor="cb-period" hint="ГГГГ-ММ, UTC. Текущий месяц рассчитать нельзя.">
        <Input id="cb-period" name="period" controlSize="compact" value={period} onChange={(e) => setPeriod(e.target.value)} className="w-40 tabular-nums" />
      </FieldBox>
    </PromoActionForm>
  );
}

/* ── Очередь начислений ───────────────────────────────────────────────── */

export interface RewardFacts {
  id: string;
  status: string;
  amountMinor: number;
  clientName: string;
  clientEmail: string;
  kindLabel: string;
  externalRef: string;
  hasSignals: boolean;
  budgetLeftMinor: number | null;
}

const big = (minor: number) => <Money minor={minor} currency="USDT" className="text-xl font-semibold" />;

function clientFact(r: RewardFacts): [string, ReactNode] {
  return [
    'Получатель (реальный счёт)',
    <>
      {r.clientName}
      <span className="text-secondary block text-xs font-normal">{r.clientEmail}</span>
    </>,
  ];
}

function Hidden({ id, decision }: { id: string; decision: string }) {
  return (
    <>
      <input type="hidden" name="rewardId" value={id} />
      <input type="hidden" name="decision" value={decision} />
    </>
  );
}

export function RewardActions({ r }: { r: RewardFacts }) {
  const approve = (
    <PromoActionForm
      action={rewardDecisionAction}
      submitLabel="Одобрить и зачислить"
      okText="Одобрено."
      reasonPlaceholder={r.hasSignals ? 'Почему сигналы связанности не мешают начислению' : 'Напр.: условия выполнены, KYC подтверждён, связей нет'}
      confirm={{
        tone: 'primary',
        title: 'Одобрить начисление?',
        summary: (
          <ConfirmFacts
            rows={[
              ['Сумма', big(r.amountMinor)],
              clientFact(r),
              ['Основание операции в терминале', <span key="ref" className="font-mono text-[13px]">{r.externalRef}</span>],
              r.budgetLeftMinor !== null ? ['Остаток бюджета акции', <Money key="b" minor={r.budgetLeftMinor} currency="USDT" />] : null,
            ]}
          />
        ),
        consequence:
          'Сумма зарезервируется в бюджете акции и сразу зачислится на реальный счёт клиента в терминале. Повтор безопасен — второй раз деньги не придут.',
        confirmLabel: 'Да, зачислить',
      }}
    >
      <Hidden id={r.id} decision="approve" />
    </PromoActionForm>
  );
  const reject = (label: string, consequence: string) => (
    <PromoActionForm
      action={rewardDecisionAction}
      submitLabel={label}
      okText="Начисление отклонено."
      variant="danger"
      reasonPlaceholder="Причина — увидит клиент и журнал"
      confirm={{ tone: 'danger', title: `${label}?`, consequence, confirmLabel: 'Да, отклонить' }}
    >
      <Hidden id={r.id} decision="reject" />
    </PromoActionForm>
  );
  const retry = (
    <PromoActionForm
      action={rewardDecisionAction}
      submitLabel="Повторить зачисление"
      okText="Зачисление повторено."
      reasonPlaceholder="Что выяснили: почему повтор безопасен"
      confirm={{
        tone: 'primary',
        title: 'Повторить зачисление?',
        summary: <ConfirmFacts rows={[['Сумма', big(r.amountMinor)], clientFact(r)]} />,
        consequence: 'Терминал получит ту же операцию с тем же основанием: если деньги уже зачислены, второй раз они не придут.',
        confirmLabel: 'Да, повторить',
      }}
    >
      <Hidden id={r.id} decision="retry" />
    </PromoActionForm>
  );

  if (r.status === 'pending') {
    return (
      <div className="space-y-5">
        <section className="space-y-3">
          <h3 className="text-primary text-[13px] font-semibold">Одобрить</h3>
          {approve}
        </section>
        <section className="border-negative/25 space-y-3 border-t pt-4">
          <h3 className="text-negative text-[13px] font-semibold">Отклонить</h3>
          {reject('Отклонить начисление', 'Начисление закроется без денег; клиент увидит отказ с вашим основанием.')}
        </section>
      </div>
    );
  }
  if (r.status === 'approved') {
    return (
      <section className="space-y-3">
        <h3 className="text-primary text-[13px] font-semibold">Исход неизвестен — повторить</h3>
        {retry}
      </section>
    );
  }
  if (r.status === 'needs_review') {
    return (
      <div className="space-y-5">
        <section className="space-y-3">
          <h3 className="text-primary text-[13px] font-semibold">Повторить после разбора</h3>
          {retry}
        </section>
        <section className="border-negative/25 space-y-3 border-t pt-4">
          <h3 className="text-negative text-[13px] font-semibold">Отклонить</h3>
          {reject('Отклонить и освободить бюджет', 'Терминал денег не зачислил; зарезервированная сумма вернётся в бюджет акции.')}
        </section>
      </div>
    );
  }
  return null;
}

/* ── Конкурс ──────────────────────────────────────────────────────────── */

export function FinalizeForm({ id, prizesMinor, winners }: { id: string; prizesMinor: number; winners: number }) {
  return (
    <PromoActionForm
      action={finalizeContestAction}
      submitLabel="Подвести итоги"
      okText="Итоги подведены, призы в очереди."
      reasonPlaceholder="Напр.: период завершён, лидерборд проверен"
      confirm={{
        tone: 'primary',
        title: 'Подвести итоги конкурса?',
        summary: <ConfirmFacts rows={[['Призовых мест в зачёте', String(winners)], ['Сумма призов', big(prizesMinor)]]} />,
        consequence:
          'Лидерборд зафиксируется итоговым снимком, призы встанут в очередь начислений на реальные счета (деньги — после одобрения). Повторно подвести итоги нельзя.',
        confirmLabel: 'Да, подвести',
      }}
    >
      <input type="hidden" name="id" value={id} />
    </PromoActionForm>
  );
}

/* ── Рефералы ─────────────────────────────────────────────────────────── */

export function ReassignForm({ refereeUserId, hasReferrer }: { refereeUserId: string; hasReferrer: boolean }) {
  const [referrer, setReferrer] = useState('');
  return (
    <div className="space-y-5">
      <PromoActionForm
        action={reassignReferralAction}
        submitLabel="Назначить реферера"
        okText="Реферер назначен."
        extraValid={referrer.trim().length > 0}
        disarmOn={referrer}
        reasonPlaceholder="Напр.: обращение №…, клиент пришёл по ссылке партнёра"
        confirm={{
          tone: 'primary',
          title: 'Переназначить реферера?',
          consequence: 'First-click перезаписывается вручную. Уже выплаченные награды не отзываются; новые — по новому рефереру.',
          confirmLabel: 'Да, назначить',
        }}
      >
        <input type="hidden" name="refereeUserId" value={refereeUserId} />
        <FieldBox label="Реферер" htmlFor="ref-who" hint="Точный email, UID или id клиента.">
          <Input id="ref-who" name="referrer" controlSize="compact" value={referrer} onChange={(e) => setReferrer(e.target.value)} autoComplete="off" />
        </FieldBox>
      </PromoActionForm>
      {hasReferrer ? (
        <div className="border-negative/25 border-t pt-4">
          <PromoActionForm
            action={reassignReferralAction}
            submitLabel="Снять атрибуцию"
            okText="Атрибуция снята."
            variant="danger"
            confirm={{ tone: 'danger', title: 'Снять атрибуцию?', consequence: 'Клиент перестанет считаться приведённым — новых реферальных наград по нему не будет.', confirmLabel: 'Да, снять' }}
          >
            <input type="hidden" name="refereeUserId" value={refereeUserId} />
            <input type="hidden" name="mode" value="revoke" />
          </PromoActionForm>
        </div>
      ) : null}
    </div>
  );
}

/* ── IB-партнёры ──────────────────────────────────────────────────────── */

export interface PartnerInitial {
  id?: string;
  displayName: string;
  model: 'cpa' | 'revshare';
  cpaAmount: string;
  revsharePercent: string;
  status: 'active' | 'paused';
  kycRequired: boolean;
  minDeposit: string;
  turnoverNotional: string;
  minHoldSeconds: string;
  windowDays: string;
}

export function PartnerForm({ initial }: { initial: PartnerInitial }) {
  const [model, setModel] = useState(initial.model);
  const idp = initial.id ?? 'new';
  return (
    <PromoActionForm
      action={savePartnerAction}
      submitLabel={initial.id ? 'Сохранить условия' : 'Завести партнёра'}
      okText={initial.id ? 'Условия партнёра сохранены.' : 'Партнёр заведён, реф-код выдан.'}
      reasonPlaceholder="Напр.: договор №…, согласовано владельцем"
    >
      {initial.id ? <input type="hidden" name="id" value={initial.id} /> : null}
      <div className="grid gap-3">
        {initial.id ? null : (
          <FieldBox label="Клиент-партнёр (выплаты на его реальный счёт)" htmlFor={`p-client-${idp}`} hint="Точный email, UID или id.">
            <Input id={`p-client-${idp}`} name="client" controlSize="compact" autoComplete="off" />
          </FieldBox>
        )}
        <FieldBox label="Имя партнёра" htmlFor={`p-name-${idp}`}>
          <Input id={`p-name-${idp}`} name="displayName" controlSize="compact" defaultValue={initial.displayName} />
        </FieldBox>
        <FieldBox label="Модель" htmlFor={`p-model-${idp}`}>
          <Select id={`p-model-${idp}`} name="model" controlSize="compact" value={model} onChange={(e) => setModel(e.target.value as 'cpa' | 'revshare')}>
            <option value="cpa">CPA — фикс за квалифицированного клиента</option>
            <option value="revshare">Revshare — доля дохода с клиентов</option>
          </Select>
        </FieldBox>
        <FieldBox label="Статус" htmlFor={`p-status-${idp}`}>
          <Select id={`p-status-${idp}`} name="status" controlSize="compact" defaultValue={initial.status}>
            <option value="active">Активен</option>
            <option value="paused">На паузе</option>
          </Select>
        </FieldBox>
      </div>
      {model === 'cpa' ? (
        <div className="grid grid-cols-2 gap-3">
          <FieldBox label="Выплата за клиента" htmlFor={`p-cpa-${idp}`} hint="Деньгами на реальный счёт партнёра">
            <UsdtInput id={`p-cpa-${idp}`} name="cpaAmount" defaultValue={initial.cpaAmount} />
          </FieldBox>
          <FieldBox label="Депозит клиента от" htmlFor={`p-dep-${idp}`}>
            <UsdtInput id={`p-dep-${idp}`} name="minDeposit" defaultValue={initial.minDeposit} />
          </FieldBox>
          <FieldBox label="Оборот клиента от" htmlFor={`p-to-${idp}`}>
            <UsdtInput id={`p-to-${idp}`} name="turnoverNotional" defaultValue={initial.turnoverNotional} />
          </FieldBox>
          <FieldBox label="Удержание сделки, с" htmlFor={`p-hold-${idp}`}>
            <Input id={`p-hold-${idp}`} name="minHoldSeconds" controlSize="compact" inputMode="numeric" defaultValue={initial.minHoldSeconds} />
          </FieldBox>
          <FieldBox label="Срок квалификации, дней" htmlFor={`p-win-${idp}`}>
            <Input id={`p-win-${idp}`} name="windowDays" controlSize="compact" inputMode="numeric" defaultValue={initial.windowDays} />
          </FieldBox>
          <div className="col-span-2">
            <CheckCard name="kycRequired" defaultChecked={initial.kycRequired} title="Нужен KYC клиента" />
          </div>
        </div>
      ) : (
        <FieldBox label="Доля дохода платформы (наценка + комиссия) с клиентов партнёра, %" htmlFor={`p-rev-${idp}`} hint="Начисляется за закрытый месяц формой «Рассчитать долю».">
          <Input id={`p-rev-${idp}`} name="revsharePercent" controlSize="compact" inputMode="decimal" defaultValue={initial.revsharePercent} className="w-40 tabular-nums" />
        </FieldBox>
      )}
    </PromoActionForm>
  );
}

export function RevshareForm({ id }: { id: string }) {
  const [period, setPeriod] = useState(prevMonth());
  return (
    <PromoActionForm
      action={accrueRevshareAction}
      submitLabel="Рассчитать долю за месяц"
      variant="secondary"
      okText="Доля рассчитана."
      disarmOn={period}
      reasonPlaceholder="Напр.: ежемесячный расчёт по договору"
    >
      <input type="hidden" name="id" value={id} />
      <FieldBox label="Месяц (закрытый), ГГГГ-ММ" htmlFor={`rv-${id}`}>
        <Input id={`rv-${id}`} name="period" controlSize="compact" value={period} onChange={(e) => setPeriod(e.target.value)} className="w-40 tabular-nums" />
      </FieldBox>
    </PromoActionForm>
  );
}

/* ── Настройки платформы: акции и атрибуция ───────────────────────────── */

export function PromoSettingsForm({
  initial,
}: {
  initial: { promotionsDisabled: boolean; attributionWindowDays: number; blockedCountries: string };
}) {
  return (
    <PromoActionForm
      action={updatePromoSettingsAction}
      submitLabel="Сохранить настройки акций"
      okText="Сохранено, запись в журнале."
      reasonPlaceholder="Напр.: профиль юрисдикции ЕС — стимулы запрещены"
    >
      <CheckCard
        name="promotionsDisabled"
        defaultChecked={initial.promotionsDisabled}
        title="Акции выключены"
        hint="Клиенты не видят акций и не могут вступить; новые начисления в очередь не ставятся. Профиль юрисдикций ЕС / UK / AU."
      />
      <div className="grid gap-3 sm:grid-cols-2">
        <FieldBox label="Срок атрибуции, дней" htmlFor="ps-window" hint="First-click: сколько живёт метка ссылки ?ref= / ?promo= до регистрации.">
          <Input id="ps-window" name="attributionWindowDays" controlSize="compact" inputMode="numeric" defaultValue={String(initial.attributionWindowDays)} className="w-32 tabular-nums" />
        </FieldBox>
        <FieldBox label="Страны без акций" htmlFor="ps-countries" hint="Коды ISO через запятую: GB, DE, AU. Клиентам этих стран акции не показываются.">
          <Input id="ps-countries" name="blockedCountries" controlSize="compact" defaultValue={initial.blockedCountries} autoComplete="off" className="uppercase" />
        </FieldBox>
      </div>
    </PromoActionForm>
  );
}
