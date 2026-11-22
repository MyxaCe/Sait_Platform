import { buildOtpauthUri as buildUri } from '@broker/support/totp';

export {
  base32Decode,
  base32Encode,
  generateTotp,
  generateTotpSecret,
  TOTP_DEFAULTS,
  verifyTotp,
  type TotpOptions,
} from '@broker/support/totp';

export const TOTP_ISSUER = 'Wholesalefy Admin';

export function buildOtpauthUri(params: Omit<Parameters<typeof buildUri>[0], 'issuer'> & { issuer?: string }): string {
  return buildUri({ ...params, issuer: params.issuer ?? TOTP_ISSUER });
}
