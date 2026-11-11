import { CopyButton, DataTable, DescriptionList, Panel, ToneBadge, type DataTableColumn } from '@broker/ui';
import { keyFingerprint, listGroupPlatforms, type GroupPlatform } from '@broker/transfer';
import { getPool } from '@/lib/db';
import { fmtDateTime } from '@/lib/ui/format';
import { selfPublicKeyPem, selfSlug } from '@/lib/transfer/runtime';
import { GroupPlatformsForm, type PlatformFormValue } from './GroupPlatformsForm';

/**
 * «Платформы группы» в настройках (только admin — страница уже гейтится).
 * Реестр — настройка ячейки: своя строка + соседи, их адреса, публичные
 * ключи и профили юрисдикций. Ключ ЭТОЙ платформы показывается для копирования
 * в реестры соседей; приватный ключ живёт только в env ячейки.
 */

const COLUMNS = (self: string | null): DataTableColumn<GroupPlatform>[] => [
  {
    key: 'name',
    header: 'Платформа',
    cell: (p) => (
      <span>
        <span className="text-primary font-medium">{p.name}</span>
        {p.slug === self ? <ToneBadge tone="info" plain className="ml-2">эта</ToneBadge> : null}
        <span className="text-muted block font-mono text-xs">{p.slug}</span>
      </span>
    ),
  },
  { key: 'entity', header: 'Юрлицо', cell: (p) => p.legalEntity ?? '—' },
  {
    key: 'profile',
    header: 'Профиль юрисдикции',
    cell: (p) => (
      <span className="text-xs">
        ЕС: {p.euLicense ? 'да' : 'нет'} · плечо {p.maxRetailLeverage ? `1:${p.maxRetailLeverage}` : '—'} · бонусы {p.bonusesAllowed ? 'да' : 'нет'}
        <span className="text-muted block">
          {p.servedCountries.length ? `только ${p.servedCountries.join(', ')}` : 'все страны'}
          {p.forbiddenCountries.length ? ` · кроме ${p.forbiddenCountries.join(', ')}` : ''}
        </span>
      </span>
    ),
  },
  {
    key: 'channel',
    header: 'Канал',
    cell: (p) => (
      <span className="text-xs">
        {p.acceptsTransfers ? <ToneBadge tone="positive" plain>принимает</ToneBadge> : <ToneBadge tone="neutral" plain>не принимает</ToneBadge>}
        <span className="text-muted block font-mono">ключ {keyFingerprint(p.publicKeyPem) ?? 'не задан'}</span>
      </span>
    ),
  },
  { key: 'upd', header: 'Изменено', numeric: true, cell: (p) => (p.updatedAt ? fmtDateTime(p.updatedAt) : '—') },
];

export async function GroupPlatformsPanel() {
  const platforms = await listGroupPlatforms(getPool()).catch(() => null);
  const self = selfSlug();
  const pem = selfPublicKeyPem();
  const selfRow = platforms?.find((p) => p.slug === self) ?? null;
  const values: PlatformFormValue[] = (platforms ?? []).map((p) => ({
    slug: p.slug,
    name: p.name,
    legalEntity: p.legalEntity ?? '',
    regulator: p.regulator ?? '',
    cabinetUrl: p.cabinetUrl,
    apiUrl: p.apiUrl ?? '',
    publicKeyPem: p.publicKeyPem ?? '',
    euLicense: p.euLicense,
    servedCountries: p.servedCountries.join(', '),
    forbiddenCountries: p.forbiddenCountries.join(', '),
    maxRetailLeverage: p.maxRetailLeverage ? String(p.maxRetailLeverage) : '',
    bonusesAllowed: p.bonusesAllowed,
    acceptsTransfers: p.acceptsTransfers,
  }));
  return (
    <Panel
      id="group"
      title="Платформы группы"
      description="Реестр для переводов клиентов между платформами: адреса, ключи подписи, профили юрисдикций. Изменение — с основанием, в журнал."
      count={platforms?.length}
    >
      <div className="space-y-5">
        <DescriptionList
          columns={2}
          items={[
            { term: 'Эта платформа (SITE_SLUG)', value: self ?? 'не задан', tone: self ? 'default' : 'negative' },
            {
              term: 'Ключ подписи',
              value: pem ? (
                <span className="inline-flex items-center gap-1.5 font-mono text-[12.5px]">
                  {keyFingerprint(pem)} <CopyButton value={pem} label="публичный ключ" />
                </span>
              ) : (
                'не задан'
              ),
              tone: pem ? 'default' : 'negative',
              hint: pem
                ? selfRow?.publicKeyPem && keyFingerprint(selfRow.publicKeyPem) !== keyFingerprint(pem)
                  ? 'не совпадает с ключом этой платформы в реестре!'
                  : 'публичный — скопируйте в реестры соседей'
                : 'PLATFORM_TRANSFER_SIGNING_KEY_PEM_B64 в env ячейки',
            },
          ]}
        />
        {platforms ? (
          <DataTable bare columns={COLUMNS(self)} rows={platforms} rowKey={(p) => p.slug} aria-label="Платформы группы" />
        ) : (
          <p className="text-muted text-sm">Миграция переводов на этой базе не применена.</p>
        )}
        <div className="border-border border-t pt-5">
          <GroupPlatformsForm platforms={values} selfSlug={self} />
        </div>
      </div>
    </Panel>
  );
}
