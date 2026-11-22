export interface LegalLicenseInput {
  number: string | null;
  activity: string | null;
  regulator: string | null;
  verifyUrl: string | null;
}

export interface LegalEntityInput {
  name: string | null;
  registrationNumber: string | null;
  address: string | null;
  licenses: LegalLicenseInput[];
}

export interface LegalLabels {
  regNumber: (number: string) => string;
  license: (number: string | null) => string;
}

export interface FooterLegalLicense {
  text: string;
  verifyUrl: string | null;
}

export interface FooterLegalLines {
  entity: string | null;
  licenses: FooterLegalLicense[];
}

export function legalEntityLine(entity: LegalEntityInput, labels: LegalLabels): string | null {
  const parts = [
    entity.name,
    entity.registrationNumber ? labels.regNumber(entity.registrationNumber) : null,
    entity.address,
  ].filter((part): part is string => Boolean(part));
  return parts.length > 0 ? parts.join(', ') : null;
}

export function licenseLine(license: LegalLicenseInput, labels: LegalLabels): string {
  let text = labels.license(license.number);
  if (license.activity) text += ` (${license.activity})`;
  if (license.regulator) text += `, ${license.regulator}`;
  return text;
}

export function footerLegalLines(
  entity: LegalEntityInput | null | undefined,
  labels: LegalLabels,
): FooterLegalLines | null {
  if (!entity) return null;
  const licenses = entity.licenses
    .filter((l) => l.number || l.activity || l.regulator)
    .map((l) => ({ text: licenseLine(l, labels), verifyUrl: l.verifyUrl }));
  const line = legalEntityLine(entity, labels);
  return line || licenses.length > 0 ? { entity: line, licenses } : null;
}
