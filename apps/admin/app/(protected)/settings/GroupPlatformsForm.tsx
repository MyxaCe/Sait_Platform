'use client';

import { useState } from 'react';
import { Checkbox, Input, Select, Textarea } from '@broker/ui';
import { upsertPlatformAction } from '@/lib/transfer/actions';
import { transferErrorText } from '@/lib/transfer/labels';
import { ActionForm } from '../_money/ActionForm';

/**
 * Реестр платформ группы — правка записи (ветка client-transfer). Выбор
 * существующей записи подставляет её значения; «новая» — пустая форма.
 * Сохранение — с основанием, журнал `platform.group_registry.upserted`
 * (ключ — отпечатком). Приватного ключа здесь нет и быть не может.
 */

export interface PlatformFormValue {
  slug: string;
  name: string;
  legalEntity: string;
  regulator: string;
  cabinetUrl: string;
  apiUrl: string;
  publicKeyPem: string;
  euLicense: boolean;
  servedCountries: string;
  forbiddenCountries: string;
  maxRetailLeverage: string;
  bonusesAllowed: boolean;
  acceptsTransfers: boolean;
}

const EMPTY: PlatformFormValue = {
  slug: '',
  name: '',
  legalEntity: '',
  regulator: '',
  cabinetUrl: 'https://',
  apiUrl: '',
  publicKeyPem: '',
  euLicense: false,
  servedCountries: '',
  forbiddenCountries: '',
  maxRetailLeverage: '',
  bonusesAllowed: false,
  acceptsTransfers: true,
};

function Text({ label, name, value, onChange, hint, mono }: { label: string; name: string; value: string; onChange: (v: string) => void; hint?: string; mono?: boolean }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-muted block text-xs">{label}</span>
      <Input name={name} value={value} onChange={(e) => onChange(e.target.value)} controlSize="compact" autoComplete="off" className={mono ? 'font-mono text-[12.5px]' : undefined} />
      {hint ? <span className="text-muted block text-[11px]">{hint}</span> : null}
    </label>
  );
}

function Flag({ name, label, checked, onChange }: { name: string; label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-sm">
      <Checkbox name={name} checked={checked} onChange={(e) => onChange(e.target.checked)} className="size-4" />
      {label}
    </label>
  );
}

export function GroupPlatformsForm({ platforms, selfSlug }: { platforms: PlatformFormValue[]; selfSlug: string | null }) {
  const [pick, setPick] = useState('');
  const [v, setV] = useState<PlatformFormValue>(EMPTY);
  const set = <K extends keyof PlatformFormValue>(k: K) => (x: PlatformFormValue[K]) => setV((cur) => ({ ...cur, [k]: x }));
  return (
    <ActionForm
      action={upsertPlatformAction}
      submitLabel="Сохранить запись реестра"
      okText="Реестр обновлён, запись в журнале."
      errorText={transferErrorText}
      disarmOn={pick}
      reasonPlaceholder="Почему меняется реестр группы (например: открыта новая платформа)"
      extraValid={Boolean(v.slug && v.name && v.cabinetUrl)}
    >
      <label className="block space-y-1.5">
        <span className="text-muted block text-xs">Запись</span>
        <Select
          controlSize="compact"
          value={pick}
          onChange={(e) => {
            setPick(e.target.value);
            setV(platforms.find((p) => p.slug === e.target.value) ?? EMPTY);
          }}
        >
          <option value="">+ новая платформа</option>
          {platforms.map((p) => (
            <option key={p.slug} value={p.slug}>
              {p.name} ({p.slug}){p.slug === selfSlug ? ' — эта платформа' : ''}
            </option>
          ))}
        </Select>
      </label>
      <div className="grid gap-3 lg:grid-cols-2">
        <Text label="Slug (SITE_SLUG ячейки)" name="slug" value={v.slug} onChange={set('slug')} mono />
        <Text label="Название" name="name" value={v.name} onChange={set('name')} />
        <Text label="Юрлицо" name="legalEntity" value={v.legalEntity} onChange={set('legalEntity')} />
        <Text label="Регулятор" name="regulator" value={v.regulator} onChange={set('regulator')} />
        <Text label="Публичный адрес кабинета" name="cabinetUrl" value={v.cabinetUrl} onChange={set('cabinetUrl')} hint="ссылки в письмах клиенту" mono />
        <Text label="Внутренний адрес API" name="apiUrl" value={v.apiUrl} onChange={set('apiUrl')} hint="сеть back, напр. http://broker-admin-nordex-eu:3005" mono />
        <Text label="Обслуживаемые страны" name="servedCountries" value={v.servedCountries} onChange={set('servedCountries')} hint="ISO-2 через запятую; пусто — все, кроме запрещённых" />
        <Text label="Запрещённые страны" name="forbiddenCountries" value={v.forbiddenCountries} onChange={set('forbiddenCountries')} hint="перевод клиента из этих стран сюда невозможен" />
        <Text label="Макс. плечо для розницы (1:N)" name="maxRetailLeverage" value={v.maxRetailLeverage} onChange={set('maxRetailLeverage')} />
      </div>
      <label className="block space-y-1.5">
        <span className="text-muted block text-xs">Публичный ключ подписи (Ed25519, PEM)</span>
        <Textarea name="publicKeyPem" rows={4} value={v.publicKeyPem} onChange={(e) => set('publicKeyPem')(e.target.value)} className="font-mono text-[12px]" placeholder="-----BEGIN PUBLIC KEY-----" />
      </label>
      <div className="flex flex-wrap gap-x-6 gap-y-2">
        <Flag name="acceptsTransfers" label="Принимает переводы" checked={v.acceptsTransfers} onChange={set('acceptsTransfers')} />
        <Flag name="euLicense" label="Лицензия ЕС" checked={v.euLicense} onChange={set('euLicense')} />
        <Flag name="bonusesAllowed" label="Бонусы разрешены" checked={v.bonusesAllowed} onChange={set('bonusesAllowed')} />
      </div>
    </ActionForm>
  );
}
