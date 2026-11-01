/**
 * Схема ключа объекта KYC: `kyc/{tenant}/{client}/{doc_type}/{uuid}`
 * (ADM-12 / CAB-KYC, Р-454 II-1).
 *
 * Разбор схемы:
 *  - `kyc/` — общий префикс зоны: по нему адресуется бакет-политика и
 *    lifecycle, и объект KYC не смешивается с прочими объектами хранилища.
 *  - `{tenant}` — слаг тенанта: объекты разных брендов не пересекаются ни в
 *    ключах, ни в правах доступа к префиксу.
 *  - `{client}` — `users.id` клиента (его СОБСТВЕННЫЙ id из сессии кабинета, не
 *    из формы): все документы одного клиента под одним префиксом.
 *  - `{doc_type}` — вид KYC-документа (закрытый перечень схемы).
 *  - `{uuid}` — неугадываемость: зная tenant/client/type, ключ всё равно не
 *    подобрать, прямой перебор объекта невозможен (ссылку выдаёт только
 *    подписанный URL оператору).
 *
 * Ни один сегмент не формируется из непроверенного ввода без валидации:
 * слэш/пустота/`.`/`..` в сегменте сломали бы адресацию или вывели ключ за
 * пределы префикса. Такой сегмент — отказ (fail-closed), а не «очистим молча».
 */

export const KYC_KEY_PREFIX = 'kyc';

export interface KycObjectKeyParts {
  /** Слаг тенанта. */
  tenant: string;
  /** `users.id` клиента. */
  client: string;
  /** Вид документа (`identity` | `selfie_liveness` | …). */
  docKind: string;
  /** Случайный UUID объекта (неугадываемость). */
  uuid: string;
}

/** Сегмент ключа непригоден: пустой, с пробелами по краям, со слэшем или точками-путями. */
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

/** Строит ключ `kyc/{tenant}/{client}/{doc_type}/{uuid}`, проверяя каждый сегмент. */
export function buildKycObjectKey(parts: KycObjectKeyParts): string {
  return [
    KYC_KEY_PREFIX,
    requireSegment('tenant', parts.tenant),
    requireSegment('client', parts.client),
    requireSegment('docKind', parts.docKind),
    requireSegment('uuid', parts.uuid),
  ].join('/');
}
