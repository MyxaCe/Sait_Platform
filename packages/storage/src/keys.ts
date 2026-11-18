export const KYC_KEY_PREFIX = 'kyc';

export interface KycObjectKeyParts {
  tenant: string;
  client: string;
  docKind: string;
  uuid: string;
}

export class InvalidKeySegmentError extends Error {
  readonly code = 'invalid-key-segment';

  constructor(name: string, value: string) {
    super(
      `Сегмент ключа объекта «${name}» непригоден: ${JSON.stringify(value)}. ` +
        'Сегмент не может быть пустым, содержать «/», «\\» или быть «.»/«..» ' +
        '(иначе ключ ломает адресацию или выходит за префикс kyc/). fail-closed.',
    );
    this.name = 'InvalidKeySegmentError';
  }
}

function requireSegment(name: string, value: string): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.trim() !== value ||
    value.includes('/') ||
    value.includes('\\') ||
    value === '.' ||
    value === '..'
  ) {
    throw new InvalidKeySegmentError(name, String(value));
  }
  return value;
}

export function buildKycObjectKey(parts: KycObjectKeyParts): string {
  return [
    KYC_KEY_PREFIX,
    requireSegment('tenant', parts.tenant),
    requireSegment('client', parts.client),
    requireSegment('docKind', parts.docKind),
    requireSegment('uuid', parts.uuid),
  ].join('/');
}
