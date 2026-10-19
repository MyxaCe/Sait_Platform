import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { RegisterForm } from '@/features/auth/RegisterForm';
import { registerSubtitle } from '@/lib/register-copy';
import { getTenantStartBalance } from '@/lib/tenant';

/**
 * Подпись регистрации называет сумму ТОЛЬКО когда её назначил тенант
 * (CAB-06, Р-040).
 *
 * Здесь была зашитая строка «демо-счёт на $10 000». Рядом с реальным
 * продуктом это обещание, которого мы не даём: сумму назначает владелец
 * сайта полем `demoStartBalanceCents`, и `registerAccount()` при
 * незаданной сумме **отказывает открывать счёт** — Р-040 отменил фолбэк
 * «$10 000, параметр удобства ничего не разрешает».
 *
 * То есть подпись обещала сумму, а код на той же сумме отказывал. Это
 * хуже несогласованности текста: человек видел обещание, проходил форму
 * и получал отказ.
 *
 * **Две подписи, а не подстановка умолчания.** Суммы нет — подпись о ней
 * молчит, а не называет какую-нибудь. Умолчание здесь было бы тем же
 * `?? 10000`, только в тексте, где его труднее найти и некому поймать
 * тестом.
 *
 * **Страница динамическая, и это не наша заслуга, а свойство кабинета:**
 * статических страниц у него нет вовсе (проверено выводом `next build` —
 * все маршруты `ƒ`). Будь она статической, ответ «суммы нет» замёрз бы в
 * разметке, как в B-026 у витрины. Пометка оставлена намеренно:
 * появится у кабинета статика — этот вызов придётся пересматривать.
 */
export default async function RegisterPage({ params }: { params: { locale: string } }) {
  setRequestLocale(params.locale);
  const t = await getTranslations('auth');
  const startBalance = await getTenantStartBalance();

  // Выбор подписи — в `lib/register-copy.ts`: внутри разметки его
  // нельзя было покрасить мутацией.
  const choice = registerSubtitle(startBalance, params.locale);
  const subtitle =
    choice.key === 'registerSubtitleWithAmount'
      ? t(choice.key, { amount: choice.amount })
      : t(choice.key);

  return (
    <>
      <h1 className="text-2xl font-semibold">{t('registerTitle')}</h1>
      <p className="mb-6 mt-1 text-sm text-secondary">{subtitle}</p>
      <RegisterForm />
      <p className="mt-6 text-center text-sm text-secondary">
        {t('haveAccount')}{' '}
        <Link href="/login" className="text-accent hover:underline">
          {t('toLogin')}
        </Link>
      </p>
    </>
  );
}
