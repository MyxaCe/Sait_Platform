import { notFound } from 'next/navigation';
import { getOperatorSession } from '@/lib/auth/current';
import { exchangeTronAddress } from '@/lib/crypto/runtime';
import { getPlatformMoneySettings } from '@/lib/crypto/settings';
import { SettingsForm } from './SettingsForm';

/**
 * «Настройки платформы» (дизайн §3) — только admin. Денежные гейты и
 * минимумы; адрес кошелька биржи — из env, здесь только для чтения (правка
 * через админку = один украденный пароль уводит все депозиты).
 */
export const dynamic = 'force-dynamic';

export default async function PlatformSettingsPage() {
  const operator = await getOperatorSession();
  if (operator?.role !== 'admin') notFound();
  const settings = await getPlatformMoneySettings();
  const address = exchangeTronAddress();

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">Настройки платформы</h1>
        <p className="text-sm text-secondary">
          Ввод и вывод USDT TRC20 на реальный счёт. Индивидуальные исключения — в карточке клиента.
        </p>
      </div>

      <section className="space-y-2 rounded border border-border bg-elevated px-4 py-4">
        <h2 className="text-sm font-medium text-secondary">Кошелёк биржи (только чтение)</h2>
        {address ? (
          <p className="break-all font-mono text-sm text-primary">{address}</p>
        ) : (
          <p className="text-sm text-negative">
            Не задан (EXCHANGE_TRON_ADDRESS). Пока адреса нет, кабинет не показывает реквизиты ввода.
          </p>
        )}
        <p className="text-xs text-secondary">
          Сеть TRON (TRC20), токен USDT. Меняется только в окружении сервера, не здесь.
        </p>
      </section>

      <section className="space-y-3 rounded border border-border bg-elevated px-4 py-4">
        <h2 className="text-lg font-medium">Ввод и вывод</h2>
        <SettingsForm
          initial={{
            depositRequiresKyc: settings.depositRequiresKyc,
            withdrawRequiresKyc: settings.withdrawRequiresKyc,
            minDeposit: (settings.minDepositMinor / 100).toFixed(2),
            minWithdraw: (settings.minWithdrawMinor / 100).toFixed(2),
          }}
        />
      </section>
    </div>
  );
}
