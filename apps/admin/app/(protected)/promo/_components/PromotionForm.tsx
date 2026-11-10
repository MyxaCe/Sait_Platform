'use client';

import { useState } from 'react';
import { Input, Select, Textarea } from '@broker/ui';
import { savePromotionAction } from '@/lib/promo/actions';
import type { FormValues } from '@/lib/promo/form';
import { TYPE_LABELS } from '@/lib/promo/labels';
import { CheckCard, FieldBox, PromoActionForm, UsdtInput } from './PromoForms';

/**
 * Форма акции (создание — черновик; изменение — черновик или пауза). Поля
 * правил зависят от типа; числа вводятся привычно (%, USDT, дни) и
 * переводятся в правила на сервере, где их проверяет одна схема пакета.
 * Тексты для клиента (ru/en) — здесь же: кабинет берёт их отсюда.
 */

export interface PromotionInitial {
  id?: string;
  type: string;
  slug: string;
  title: string;
  cmsPromoId: string;
  startsAt: string;
  endsAt: string;
  budget: string;
  countriesAllow: string;
  countriesDeny: string;
  texts: Record<string, { title: string; summary: string; terms: string }>;
  rules: FormValues;
}

const v = (r: FormValues, k: string) => (typeof r[k] === 'string' ? (r[k] as string) : '');
const b = (r: FormValues, k: string) => r[k] === true;

function Num({ id, name, label, hint, value, suffix }: { id: string; name: string; label: string; hint?: string; value: string; suffix?: string }) {
  return (
    <FieldBox label={label} htmlFor={id} hint={hint}>
      <span className="relative block">
        <Input id={id} name={name} defaultValue={value} controlSize="compact" inputMode="decimal" autoComplete="off" className={suffix ? 'pr-14 tabular-nums' : 'tabular-nums'} />
        {suffix ? <span className="text-muted pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs">{suffix}</span> : null}
      </span>
    </FieldBox>
  );
}

function Usdt({ id, name, label, hint, value }: { id: string; name: string; label: string; hint?: string; value: string }) {
  return (
    <FieldBox label={label} htmlFor={id} hint={hint}>
      <UsdtInput id={id} name={name} defaultValue={value} />
    </FieldBox>
  );
}

function RulesFields({ type, r }: { type: string; r: FormValues }) {
  if (type === 'deposit_bonus') {
    return (
      <>
        <div className="grid gap-3 sm:grid-cols-3">
          <Num id="r-percent" name="percent" label="Бонус от депозита" value={v(r, 'percent')} suffix="%" />
          <Usdt id="r-cap" name="cap" label="Не больше, на клиента" value={v(r, 'cap')} />
          <Usdt id="r-min" name="minDeposit" label="Депозит от" value={v(r, 'minDeposit')} />
          <Num id="r-turn" name="turnoverMultiplier" label="Оборот, × бонуса" hint="Нотионал сделок; 0 — без оборота" value={v(r, 'turnoverMultiplier')} suffix="×" />
          <Num id="r-hold" name="minHoldSeconds" label="Удержание сделки" hint="Короче — не засчитывается" value={v(r, 'minHoldSeconds')} suffix="сек" />
          <Num id="r-win" name="windowDays" label="Срок выполнения" hint="Со дня вступления" value={v(r, 'windowDays')} suffix="дней" />
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <CheckCard name="firstDepositOnly" defaultChecked={b(r, 'firstDepositOnly')} title="Только первый депозит" />
          <CheckCard name="kycRequired" defaultChecked={b(r, 'kycRequired')} title="Нужен KYC" />
          <CheckCard name="forfeitOnWithdrawal" defaultChecked={b(r, 'forfeitOnWithdrawal')} title="Вывод до выплаты аннулирует" />
        </div>
      </>
    );
  }
  if (type === 'referral') {
    return (
      <>
        <div className="grid gap-3 sm:grid-cols-3">
          <Usdt id="r-rr" name="referrerReward" label="Награда пригласившему" value={v(r, 'referrerReward')} />
          <Usdt id="r-re" name="refereeReward" label="Награда другу" value={v(r, 'refereeReward')} />
          <Num id="r-max" name="maxPaidReferralsPerMonth" label="Оплачиваемых друзей в месяц" hint="0 — без лимита" value={v(r, 'maxPaidReferralsPerMonth')} />
          <Usdt id="r-min" name="minDeposit" label="Депозит друга от" value={v(r, 'minDeposit')} />
          <Usdt id="r-to" name="turnoverNotional" label="Оборот друга от" hint="Нотионал сделок" value={v(r, 'turnoverNotional')} />
          <Num id="r-hold" name="minHoldSeconds" label="Удержание сделки" value={v(r, 'minHoldSeconds')} suffix="сек" />
          <Num id="r-win" name="windowDays" label="Срок выполнения" hint="Со дня регистрации друга" value={v(r, 'windowDays')} suffix="дней" />
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <CheckCard name="kycRequired" defaultChecked={b(r, 'kycRequired')} title="Друг прошёл KYC" />
          <CheckCard name="forfeitOnWithdrawal" defaultChecked={b(r, 'forfeitOnWithdrawal')} title="Вывод до выплаты аннулирует" />
        </div>
      </>
    );
  }
  if (type === 'cashback') {
    return (
      <>
        <div className="grid gap-3 sm:grid-cols-3">
          <Num id="r-percent" name="percent" label="Кешбэк от наценки + комиссии" value={v(r, 'percent')} suffix="%" />
          <Usdt id="r-minp" name="minPayout" label="Не начислять меньше" value={v(r, 'minPayout')} />
          <Usdt id="r-cap" name="capPerPeriod" label="Потолок в месяц" hint="0 — без потолка" value={v(r, 'capPerPeriod')} />
        </div>
        <CheckCard name="kycRequired" defaultChecked={b(r, 'kycRequired')} title="Нужен KYC" />
      </>
    );
  }
  if (type === 'contest') {
    return (
      <>
        <div className="grid gap-3 sm:grid-cols-3">
          <Usdt id="r-start" name="startBalance" label="Стартовая сумма демо" hint="Сверяется с фактическим сбросом демо" value={v(r, 'startBalance')} />
          <Num id="r-trades" name="minTrades" label="Закрытых сделок не меньше" value={v(r, 'minTrades')} />
        </div>
        <FieldBox label="Призы по местам (реальные USDT)" htmlFor="r-prizes" hint="Строка на место: «1: 500», «2: 300»…">
          <Textarea id="r-prizes" name="prizes" rows={4} defaultValue={v(r, 'prizes')} className="font-mono text-[13px]" />
        </FieldBox>
        <div className="grid gap-3 sm:grid-cols-2">
          <CheckCard name="prizeRequiresKyc" defaultChecked={b(r, 'prizeRequiresKyc')} title="Приз только после KYC" />
          <CheckCard name="disqualifyOnReset" defaultChecked={b(r, 'disqualifyOnReset')} title="Повторный сброс демо — дисквалификация" />
        </div>
      </>
    );
  }
  return null;
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="border-border space-y-3 border-t pt-5 first:border-t-0 first:pt-0">
      <div>
        <h3 className="text-primary text-[13px] font-semibold">{title}</h3>
        {hint ? <p className="text-muted mt-0.5 text-xs">{hint}</p> : null}
      </div>
      {children}
    </section>
  );
}

export function PromotionForm({ initial }: { initial: PromotionInitial }) {
  const [type, setType] = useState(initial.type);
  const t = (loc: string, k: 'title' | 'summary' | 'terms') => initial.texts[loc]?.[k] ?? '';
  return (
    <PromoActionForm
      action={savePromotionAction}
      submitLabel={initial.id ? 'Сохранить изменения' : 'Создать черновик'}
      okText={initial.id ? 'Изменения сохранены, запись в журнале.' : 'Черновик создан.'}
      reasonPlaceholder={initial.id ? 'Что и почему меняется в условиях' : 'Напр.: решение владельца 10.11, п.2'}
    >
      {initial.id ? <input type="hidden" name="id" value={initial.id} /> : null}
      <div className="space-y-5">
        <Section title="Акция">
          <div className="grid gap-3 sm:grid-cols-3">
            <FieldBox label="Тип" htmlFor="p-type">
              {initial.id ? (
                <>
                  <input type="hidden" name="type" value={type} />
                  <Input id="p-type" controlSize="compact" value={TYPE_LABELS[type] ?? type} readOnly disabled />
                </>
              ) : (
                <Select id="p-type" name="type" controlSize="compact" value={type} onChange={(e) => setType(e.target.value)}>
                  {Object.entries(TYPE_LABELS).map(([k, l]) => (
                    <option key={k} value={k}>
                      {l}
                    </option>
                  ))}
                </Select>
              )}
            </FieldBox>
            <FieldBox label="Название (для операторов)" htmlFor="p-title">
              <Input id="p-title" name="title" controlSize="compact" defaultValue={initial.title} />
            </FieldBox>
            <FieldBox label="Код (латиница)" htmlFor="p-slug" hint="Идёт в ссылку ?promo=">
              <Input id="p-slug" name="slug" controlSize="compact" defaultValue={initial.slug} className="font-mono text-[13px]" autoComplete="off" />
            </FieldBox>
          </div>
        </Section>

        <Section title="Условия" hint="Все числа акции — здесь. Деньги — в USDT, проценты — в %, сроки — в днях и секундах.">
          <RulesFields key={type} type={type} r={initial.rules} />
        </Section>

        <Section title="Период, бюджет, страны">
          <div className="grid gap-3 sm:grid-cols-3">
            <FieldBox label="Начало (UTC)" htmlFor="p-start" hint={type === 'contest' ? 'Обязательно для конкурса' : 'Пусто — с запуска'}>
              <Input id="p-start" name="startsAt" type="datetime-local" controlSize="compact" defaultValue={initial.startsAt} />
            </FieldBox>
            <FieldBox label="Конец (UTC)" htmlFor="p-end" hint={type === 'contest' ? 'Обязательно для конкурса' : 'Пусто — бессрочно'}>
              <Input id="p-end" name="endsAt" type="datetime-local" controlSize="compact" defaultValue={initial.endsAt} />
            </FieldBox>
            <FieldBox label="Бюджет акции" htmlFor="p-budget" hint="Сверх бюджета начисления не одобряются">
              <UsdtInput id="p-budget" name="budget" defaultValue={initial.budget} />
            </FieldBox>
            <FieldBox label="Только для стран" htmlFor="p-allow" hint="ISO через запятую; пусто — все">
              <Input id="p-allow" name="countriesAllow" controlSize="compact" defaultValue={initial.countriesAllow} className="uppercase" />
            </FieldBox>
            <FieldBox label="Кроме стран" htmlFor="p-deny" hint="Напр.: GB, DE, AU">
              <Input id="p-deny" name="countriesDeny" controlSize="compact" defaultValue={initial.countriesDeny} className="uppercase" />
            </FieldBox>
            <FieldBox label="Карточка CMS (необязательно)" htmlFor="p-cms" hint="promoId витринной карточки">
              <Input id="p-cms" name="cmsPromoId" controlSize="compact" defaultValue={initial.cmsPromoId} />
            </FieldBox>
          </div>
        </Section>

        <Section title="Тексты для клиента" hint="Кабинет показывает их как есть. Обещание в тексте должно совпадать с условиями выше.">
          <div className="grid gap-4 lg:grid-cols-2">
            {(['ru', 'en'] as const).map((loc) => (
              <div key={loc} className="space-y-3">
                <p className="text-secondary text-xs font-medium">{loc === 'ru' ? 'Русский' : 'English'}</p>
                <FieldBox label="Заголовок" htmlFor={`t-${loc}-title`}>
                  <Input id={`t-${loc}-title`} name={`${loc}_title`} controlSize="compact" defaultValue={t(loc, 'title')} />
                </FieldBox>
                <FieldBox label="Кратко" htmlFor={`t-${loc}-summary`}>
                  <Textarea id={`t-${loc}-summary`} name={`${loc}_summary`} rows={2} defaultValue={t(loc, 'summary')} />
                </FieldBox>
                <FieldBox label="Полные условия" htmlFor={`t-${loc}-terms`}>
                  <Textarea id={`t-${loc}-terms`} name={`${loc}_terms`} rows={4} defaultValue={t(loc, 'terms')} />
                </FieldBox>
              </div>
            ))}
          </div>
        </Section>
      </div>
    </PromoActionForm>
  );
}
