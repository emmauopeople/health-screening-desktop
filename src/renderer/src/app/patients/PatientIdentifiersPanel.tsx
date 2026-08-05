import type { PublicPatientDetail } from '@shared/ipc'

export function PatientIdentifiersPanel({
  patient
}: {
  readonly patient: PublicPatientDetail
}): React.JSX.Element {
  return (
    <div className="patient-tab-panel-content">
      <dl className="patient-detail-list">
        <DetailRow label="Patient code" value={patient.patientCode} />
        <DetailRow label="Current row version" value={String(patient.rowVersion)} />
        <DetailRow label="Record status" value={patient.status} />
      </dl>
    </div>
  )
}

function DetailRow({
  label,
  value
}: {
  readonly label: string
  readonly value: string
}): React.JSX.Element {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  )
}
