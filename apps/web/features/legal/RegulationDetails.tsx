import type { LegalEntity } from '@broker/api-client';

export interface RegulationLabels {
  entityTitle: string;
  name: string;
  registrationNumber: string;
  address: string;
  licensesTitle: string;
  licenseNumber: string;
  activity: string;
  regulator: string;
  regulatorCountry: string;
  verifyLicense: string;
  document: string;
}

function Row({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <div className="grid gap-1 py-3 sm:grid-cols-[220px_1fr] sm:gap-6">
      <dt className="text-sm text-secondary">{label}</dt>
      <dd className="text-primary">{value}</dd>
    </div>
  );
}

export function RegulationDetails({ entity, labels }: { entity: LegalEntity; labels: RegulationLabels }) {
  const hasEntity = Boolean(entity.name || entity.registrationNumber || entity.address);
  return (
    <div className="space-y-12">
      {hasEntity && (
        <section>
          <h2 className="text-xl font-semibold text-primary">{labels.entityTitle}</h2>
          <dl className="mt-4 divide-y divide-border border-y border-border">
            <Row label={labels.name} value={entity.name} />
            <Row label={labels.registrationNumber} value={entity.registrationNumber} />
            <Row label={labels.address} value={entity.address} />
          </dl>
        </section>
      )}

      {entity.licenses.length > 0 && (
        <section>
          <h2 className="text-xl font-semibold text-primary">{labels.licensesTitle}</h2>
          <ul className="mt-4 space-y-4">
            {entity.licenses.map((license, i) => (
              <li key={i} className="rounded-2xl border border-border bg-card p-5" data-testid="regulation-license">
                <dl className="divide-y divide-border">
                  <Row label={labels.licenseNumber} value={license.number} />
                  <Row label={labels.activity} value={license.activity} />
                  <Row label={labels.regulator} value={license.regulator} />
                  <Row label={labels.regulatorCountry} value={license.regulatorCountry} />
                </dl>
                {(license.verifyUrl || license.document) && (
                  <div className="mt-4 flex flex-wrap gap-4 text-sm">
                    {license.verifyUrl && (
                      <a
                        href={license.verifyUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-accent hover:underline"
                      >
                        {labels.verifyLicense}
                      </a>
                    )}
                    {license.document && (
                      <a
                        href={license.document.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        type="application/pdf"
                        className="text-accent hover:underline"
                      >
                        {labels.document}
                      </a>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
