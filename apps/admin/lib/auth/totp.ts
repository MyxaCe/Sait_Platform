import { buildOtpauthUri as buildUri } from '@broker/support/totp';
import { adminBrandFrom } from '@/lib/brand/brand';

export {
  base32Decode,
  base32Encode,
  generateTotp,
  generateTotpSecret,
  TOTP_DEFAULTS,
  verifyTotp,
  type TotpOptions,
} from '@broker/support/totp';

/**
 * Метка записи в приложении-аутентификаторе (только для новых подключений 2FA).
 * На проверку кода не влияет: код считается из секрета, метка — лишь подпись в приложении.
 */
export function totpIssuer(): string {
  return adminBrandFrom(process.env.ADMIN_BRAND_NAME).totpIssuer;
}

export function buildOtpauthUri(params: Omit<Parameters<typeof buildUri>[0], 'issuer'> & { issuer?: string }): string {
  return buildUri({ ...params, issuer: params.issuer ?? totpIssuer() });
}
