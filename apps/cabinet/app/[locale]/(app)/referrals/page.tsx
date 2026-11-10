import QRCode from 'qrcode';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { requireSessionUser } from '@/lib/auth/require';
import { getChromeBrand } from '@/lib/chrome';
import { loadMyReferral } from '@/lib/promo';
import { ReferralScreen } from '@/features/promo/ReferralScreen';

/** «Пригласи друга» (дизайн §4.1): ссылка, код, QR, условия, приглашённые; IB — свой договор. */
export const dynamic = 'force-dynamic';

export default async function ReferralsPage({ params }: { params: { locale: string } }) {
  setRequestLocale(params.locale);
  const user = await requireSessionUser(params.locale);
  const [loaded, brand, tCommon] = await Promise.all([
    loadMyReferral(user.id, params.locale),
    getChromeBrand(params.locale).catch(() => null),
    getTranslations('common'),
  ]);
  const data = loaded.state === 'ok' ? loaded.data : null;
  const link = data?.referral.link ?? null;
  const qrSvg = link
    ? await QRCode.toString(link, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' }).catch(() => null)
    : null;
  return <ReferralScreen data={data} qrSvg={qrSvg} brand={brand?.name ?? tCommon('brand')} />;
}
