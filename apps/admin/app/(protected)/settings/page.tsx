import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Callout, DescriptionList, Money, PageHeader, Panel, ToneBadge } from '@broker/ui';
import { getOperatorSession } from '@/lib/auth/current';
import { exchangeTronAddress } from '@/lib/crypto/runtime';
import { getPlatformMoneySettings } from '@/lib/crypto/settings';
import { TronRef } from '../_money/tron';
import { SettingsForm } from './SettingsForm';
import { getPromoSettings } from '@/lib/promo/queries';
import { PromoSettingsForm } from '../promo/_components/PromoForms';
// ── Реестр платформ группы (ветка client-transfer) ──
import { GroupPlatformsPanel } from './GroupPlatformsPanel';

/**
 * «Настройки платформы» (дизайн §3) — только admin. Денежные гейты и
 * минимумы; адрес кошелька биржи — из env, здесь только для чтения (правка
 * через админку = один украденный пароль уводит все депозиты).
 *
 * Фаза 2 — только вид: action, поля формы и роль-гейт прежние.
 */
export const dynamic = 'force-dynamic';

function KycValue({ required }: { required: boolean }) {
  return <span className="font-medium">{required ? 'только после KYC' : 'без KYC'}</span>;
}

export default async function PlatformSettingsPage() {
  const operator = await getOperatorSession();
  if (operator?.role !== 'admin') notFound();
  const [settings, promo] = await Promise.all([getPlatformMoneySettings(), getPromoSettings()]);
  const address = exchangeTronAddress();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Настройки платформы"
        description="Правила ввода и вывода USDT (TRON, TRC20) на реальный счёт — для всех клиентов. Индивидуальные исключения задаются в карточке клиента, вкладка «Деньги»."
      />

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-5">
        <Panel
          title="Ввод и вывод"
          description="Изменение — с основанием, пишется в журнал (до и после)."
        >
          <div className="space-y-5">
            <div>
              <p className="text-muted mb-2 text-xs">Действует сейчас</p>
              <DescriptionList
                columns={4}
                items={[
                  { term: 'Ввод', value: <KycValue required={settings.depositRequiresKyc} /> },
                  { term: 'Вывод', value: <KycValue required={settings.withdrawRequiresKyc} /> },
                  {
                    term: 'Минимальный ввод',
                    value: <Money minor={settings.minDepositMinor} currency="USDT" />,
                    hint: settings.minDepositMinor === 0 ? 'без минимума' : undefined,
                  },
                  {
                    term: 'Минимальный вывод',
                    value: <Money minor={settings.minWithdrawMinor} currency="USDT" />,
                    hint: settings.minWithdrawMinor === 0 ? 'без минимума' : undefined,
                  },
                ]}
              />
            </div>
            <div className="border-border border-t pt-5">
              <SettingsForm
                initial={{
                  depositRequiresKyc: settings.depositRequiresKyc,
                  withdrawRequiresKyc: settings.withdrawRequiresKyc,
                  minDeposit: (settings.minDepositMinor / 100).toFixed(2),
                  minWithdraw: (settings.minWithdrawMinor / 100).toFixed(2),
                }}
              />
            </div>
          </div>
        </Panel>

        <Panel
          id="promo"
          title="Акции и атрибуция"
          description="Профиль юрисдикции: акции можно выключить целиком или для стран. Изменение — с основанием, в журнал."
          actions={
            promo ? (
              <ToneBadge tone={promo.promotionsEnabled ? 'positive' : 'negative'}>
                {promo.promotionsEnabled ? 'акции включены' : 'акции выключены'}
              </ToneBadge>
            ) : null
          }
        >
          {promo ? (
            <div className="space-y-5">
              <DescriptionList
                columns={3}
                items={[
                  { term: 'Акции', value: promo.promotionsEnabled ? 'включены' : 'выключены', tone: promo.promotionsEnabled ? 'default' : 'negative' },
                  { term: 'Срок атрибуции', value: `${promo.attributionWindowDays} дн`, hint: 'first-click' },
                  { term: 'Страны без акций', value: promo.blockedCountries.length ? promo.blockedCountries.join(', ') : 'нет' },
                ]}
              />
              <div className="border-border border-t pt-5">
                <PromoSettingsForm
                  initial={{
                    promotionsDisabled: !promo.promotionsEnabled,
                    attributionWindowDays: promo.attributionWindowDays,
                    blockedCountries: promo.blockedCountries.join(', '),
                  }}
                />
              </div>
            </div>
          ) : (
            <Callout tone="warning" title="Настроек акций нет">
              Миграция акций на этой базе не применена — акции считаются выключенными.
            </Callout>
          )}
        </Panel>

        {/* ── Реестр платформ группы (ветка client-transfer) ── */}
        <GroupPlatformsPanel />
        </div>

        <aside className="min-w-0 space-y-5">
          <Panel
            title="Кошелёк биржи"
            actions={<ToneBadge tone="neutral">только чтение</ToneBadge>}
          >
            {address ? (
              <div className="space-y-3">
                <DescriptionList
                  columns={1}
                  items={[
                    {
                      term: 'Адрес (TRON)',
                      value: <TronRef kind="address" value={address} full className="text-[13px]" />,
                    },
                    { term: 'Сеть и токен', value: 'TRON (TRC20) · USDT' },
                  ]}
                />
                <p className="text-muted text-xs">
                  Задаётся только в окружении сервера (<code className="font-mono">EXCHANGE_TRON_ADDRESS</code>).
                  Правки в админке нет намеренно: подмена адреса ввода — классическая атака, а пароль
                  оператора можно украсть. Приватного ключа на сервере нет — кошелёк только наблюдается.
                </p>
              </div>
            ) : (
              <Callout tone="warning" title="Адрес не задан">
                Переменная <code className="font-mono text-[0.92em]">EXCHANGE_TRON_ADDRESS</code> пуста —
                кабинет не показывает реквизиты для пополнения. Адрес задаётся в окружении сервера, не
                здесь.
              </Callout>
            )}
          </Panel>

          <Panel title="Как применяются правила">
            <ul className="text-secondary list-disc space-y-2 pl-4 text-[13px]">
              <li>
                У клиента KYC-гейт может быть «наследовать», «да» или «нет». По умолчанию — наследует
                отсюда; карточка клиента показывает итог и источник.
              </li>
              <li>
                Минимум вывода проверяется, когда клиент подаёт заявку. Поступление меньше минимума
                ввода наблюдатель отклоняет («меньше минимума») — на счёт клиента оно не зачисляется.
              </li>
              <li>
                Заморозка счёта и запрет вывода — флаги конкретного клиента, в его карточке.{' '}
                <Link href="/clients" className="text-accent hover:underline">
                  Клиенты →
                </Link>
              </li>
            </ul>
          </Panel>
        </aside>
      </div>
    </div>
  );
}
