import type { HistoryItem } from '@shared/central-history/contract.mjs'

import { historyTypeLabels, historyInstant } from './central-history-formatting'

const fieldLabels: Record<string, string> = {
  weightKg: 'Weight (kg)',
  waistCm: 'Waist (cm)',
  systolicMmhg: 'Systolic BP (mmHg)',
  diastolicMmhg: 'Diastolic BP (mmHg)',
  pulseBpm: 'Pulse (bpm)',
  reportedMedicationsOrAdvice: 'Reported advice',
  noteText: 'Note',
  rows: 'Recorded items',
  sequenceNumber: 'Sequence',
  sourceType: 'Information origin',
  nextFollowupDate: 'Next follow-up',
  dateSeen: 'Date seen',
  providerSeen: 'Provider seen',
  facilityName: 'Facility',
  contactDate: 'Contact date',
  sourceRevision: 'Source version',
  chsMedicalId: 'CHS Medical ID'
}
function label(key: string): string {
  const words = fieldLabels[key] ?? key.replace(/([a-z])([A-Z])/g, '$1 $2')
  return words.charAt(0).toUpperCase() + words.slice(1)
}
function valueText(value: unknown): string {
  if (value === null || value === '') return 'Not recorded'
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (typeof value === 'string') {
    if (/^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value)))
      return historyInstant(value)
    if (/^[A-Z][A-Z_0-9]+$/.test(value))
      return value.charAt(0) + value.slice(1).toLowerCase().replaceAll('_', ' ')
  }
  return String(value)
}

// The closed wire schema bounds nesting and array sizes. Render every clinical
// field, retaining false/zero/null distinctions; identifiers are shown in provenance.
export function HistoryFields({
  data
}: {
  data: Readonly<Record<string, unknown>>
}): React.JSX.Element {
  return (
    <dl className="central-history-fields">
      {Object.entries(data)
        .filter(
          ([key]) =>
            !['id', 'practitionerId', 'sessionId', 'protocolId', 'amendmentOfEncounterId'].includes(
              key
            )
        )
        .map(([key, value]) => (
          <div
            key={key}
            className={
              typeof value === 'object' && value !== null ? 'central-history-field-group' : ''
            }
          >
            <dt>{label(key)}</dt>
            <dd>
              {Array.isArray(value) ? (
                value.length === 0 ? (
                  'None recorded'
                ) : (
                  <ol>
                    {value.map((entry, index) => (
                      <li key={index}>
                        {typeof entry === 'object' && entry !== null ? (
                          <HistoryFields data={entry as Record<string, unknown>} />
                        ) : (
                          valueText(entry)
                        )}
                      </li>
                    ))}
                  </ol>
                )
              ) : typeof value === 'object' && value !== null ? (
                <HistoryFields data={value as Record<string, unknown>} />
              ) : (
                valueText(value)
              )}
            </dd>
          </div>
        ))}
    </dl>
  )
}

export function CentralHistoryCard({ item }: { item: HistoryItem }): React.JSX.Element {
  return (
    <article className="central-history-card">
      <header>
        <h4>{historyTypeLabels[item.resourceType]}</h4>
        <span className="central-history-badge">Central · read-only</span>
      </header>
      <p>
        <strong>{historyInstant(item.occurredAt)}</strong> · {item.author.displayName}
      </p>
      <p className="central-history-source">
        {item.source.locationName} · {item.source.organizationName} · {item.source.deploymentName}
      </p>
      <p>
        Encounter: {historyInstant(item.encounter.startedAt)} · {valueText(item.encounter.status)}
      </p>
      {item.encounter.status === 'VOID' && (
        <p className="central-history-warning">
          <strong>Voided encounter.</strong> {item.encounter.voidReason ?? 'No reason recorded.'}{' '}
          Retained for review.
        </p>
      )}
      {(item.encounter.status === 'AMENDED' || item.encounter.amendmentOfEncounterId) && (
        <p className="central-history-warning">
          <strong>Amended encounter.</strong>{' '}
          {item.encounter.amendmentReason ?? 'No reason recorded.'}
        </p>
      )}
      <details>
        <summary>Clinical details</summary>
        <HistoryFields data={item.data} />
      </details>
      <details className="central-history-provenance">
        <summary>Record source and references</summary>
        <dl className="central-history-fields">
          <div>
            <dt>Central record</dt>
            <dd>{item.resourceId}</dd>
          </div>
          <div>
            <dt>Source version</dt>
            <dd>{item.sourceRevision}</dd>
          </div>
          <div>
            <dt>Source installation</dt>
            <dd>{item.source.installationId}</dd>
          </div>
          <div>
            <dt>Central encounter</dt>
            <dd>{item.encounter.encounterId}</dd>
          </div>
          <div>
            <dt>Received centrally</dt>
            <dd>{historyInstant(item.receivedAt)}</dd>
          </div>
          {item.parentResourceId && (
            <div>
              <dt>Related central record</dt>
              <dd>{item.parentResourceId}</dd>
            </div>
          )}
          {item.encounter.amendmentOfEncounterId && (
            <div>
              <dt>Amends encounter</dt>
              <dd>{item.encounter.amendmentOfEncounterId}</dd>
            </div>
          )}
        </dl>
      </details>
    </article>
  )
}
