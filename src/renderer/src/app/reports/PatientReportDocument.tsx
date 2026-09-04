import type {
  PublicManagedEncounterDetail,
  PublicPatientDetail,
  PublicPatientHistoryEncounter,
  PublicReferralDetail
} from '@shared/ipc'
import type { PatientReportData, PatientReportKind } from './patient-report-model'

type PublicReferralFollowup = PublicReferralDetail['followups'][number]

interface PatientReportDocumentProps {
  readonly report: PatientReportData
  readonly timeZone: string
  readonly reportedBy: string
  readonly preview: boolean
  onOpenEncounter(encounterId: string): void
  onOpenReferral(referralId: string): void
  onOpenPrintPreview(): void
}

export function PatientReportDocument({
  report,
  timeZone,
  reportedBy,
  preview,
  onOpenEncounter,
  onOpenReferral,
  onOpenPrintPreview
}: PatientReportDocumentProps): React.JSX.Element {
  return (
    <article
      className={`patient-report-document ${preview ? 'is-print-preview' : 'is-browser-report'}`}
    >
      {preview ? <ReportMasthead /> : null}
      <PatientDemographics patient={report.patient} report={report} timeZone={timeZone} />

      {report.kind === 'GENERAL' ? (
        <GeneralReport
          report={report}
          timeZone={timeZone}
          interactive={!preview}
          onOpenEncounter={onOpenEncounter}
          onOpenReferral={onOpenReferral}
        />
      ) : report.kind === 'VITALS' ? (
        <VitalsReport
          report={report}
          timeZone={timeZone}
          interactive={!preview}
          onOpenEncounter={onOpenEncounter}
        />
      ) : report.kind === 'LIFESTYLE' ? (
        <LifestyleReport
          report={report}
          timeZone={timeZone}
          interactive={!preview}
          onOpenEncounter={onOpenEncounter}
        />
      ) : (
        <ReferralsReport
          referrals={report.referrals}
          timeZone={timeZone}
          interactive={!preview}
          onOpenEncounter={onOpenEncounter}
          onOpenReferral={onOpenReferral}
        />
      )}

      {preview ? <PrintedReportFooter patient={report.patient} reportedBy={reportedBy} /> : null}

      {!preview ? (
        <div className="patient-report-browser-actions">
          <button className="button button-primary" type="button" onClick={onOpenPrintPreview}>
            Print preview
          </button>
        </div>
      ) : null}
    </article>
  )
}

function PrintedReportFooter({
  patient,
  reportedBy
}: {
  readonly patient: PublicPatientDetail
  readonly reportedBy: string
}): React.JSX.Element {
  const birthDate =
    patient.dateOfBirth === null ? 'Not recorded' : formatLocalDate(patient.dateOfBirth)

  return (
    <footer className="patient-report-page-footer" aria-label="Printed report page footer">
      <span>{`${patient.displayName} / Date of birth: ${birthDate}`}</span>
      <span className="patient-report-page-number" aria-label="Printed page number">
        Page <span className="patient-report-current-page" /> of{' '}
        <span className="patient-report-total-pages" />
      </span>
      <span>{`Reported by ${reportedBy}`}</span>
    </footer>
  )
}

function ReportMasthead(): React.JSX.Element {
  return (
    <header className="clinical-report-masthead patient-report-print-masthead">
      <span className="clinical-report-logo" aria-hidden="true" />
      <div>
        <strong>Community Health Screening</strong>
        <span>Patient report</span>
      </div>
      <span className="patient-report-print-disclaimer">Screening guidance is not a diagnosis</span>
    </header>
  )
}

function PatientDemographics({
  patient,
  report,
  timeZone
}: {
  readonly patient: PublicPatientDetail
  readonly report: PatientReportData
  readonly timeZone: string
}): React.JSX.Element {
  return (
    <header className="patient-report-demographic-header">
      <div className="patient-report-demographic-column">
        <p className="patient-report-type-label">{reportKindLabel(report.kind)}</p>
        <h2>{patient.displayName}</h2>
        <dl>
          <DemographicLine label="Patient ID" value={patient.patientCode} />
          <DemographicLine label="Age / sex" value={formatAgeAndSex(patient, report.range.to)} />
          <DemographicLine label="Phone" value={patient.phone ?? 'Not recorded'} />
          <DemographicLine label="Location" value={formatLocation(patient)} />
        </dl>
      </div>
      <div className="patient-report-demographic-column">
        <h3>Emergency contact</h3>
        <dl>
          <DemographicLine label="Name" value={patient.alternateContactName ?? 'Not recorded'} />
          <DemographicLine label="Phone" value={patient.alternateContactPhone ?? 'Not recorded'} />
          <DemographicLine
            label="Report range"
            value={`${formatLocalDate(report.range.from)} to ${formatLocalDate(report.range.to)}`}
          />
          <DemographicLine
            label="Report date"
            value={formatTimestamp(report.generatedAt, timeZone)}
          />
        </dl>
      </div>
    </header>
  )
}

function DemographicLine({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  )
}

function GeneralReport({
  report,
  timeZone,
  interactive,
  onOpenEncounter,
  onOpenReferral
}: {
  readonly report: PatientReportData
  readonly timeZone: string
  readonly interactive: boolean
  onOpenEncounter(encounterId: string): void
  onOpenReferral(referralId: string): void
}): React.JSX.Element {
  return (
    <>
      <ReportSummary report={report} />
      <VitalsReport
        report={report}
        timeZone={timeZone}
        interactive={interactive}
        onOpenEncounter={onOpenEncounter}
      />
      <LifestyleReport
        report={report}
        timeZone={timeZone}
        interactive={interactive}
        onOpenEncounter={onOpenEncounter}
      />
      <FoodReport details={report.encounterDetails} timeZone={timeZone} />
      <OtcReport details={report.encounterDetails} timeZone={timeZone} />
      <CurrentReportedMedications referrals={report.referrals} />
      <ReferralsReport
        referrals={report.referrals}
        timeZone={timeZone}
        interactive={interactive}
        onOpenEncounter={onOpenEncounter}
        onOpenReferral={onOpenReferral}
      />
    </>
  )
}

function ReportSummary({ report }: { readonly report: PatientReportData }): React.JSX.Element {
  const readings = report.encounters
  const averages =
    readings.length === 0
      ? null
      : {
          systolic: Math.round(
            readings.reduce((total, encounter) => total + encounter.systolic, 0) / readings.length
          ),
          diastolic: Math.round(
            readings.reduce((total, encounter) => total + encounter.diastolic, 0) / readings.length
          )
        }
  return (
    <section className="patient-report-summary" aria-label="General report summary">
      <ReportMetric label="Completed screenings" value={String(readings.length)} />
      <ReportMetric
        label="Average BP"
        value={averages === null ? '-' : `${averages.systolic} / ${averages.diastolic}`}
        support={averages === null ? 'No readings in range' : 'mmHg in selected range'}
      />
      <ReportMetric label="Referrals" value={String(report.referrals.length)} />
      <ReportMetric
        label="Current reported medications"
        value={String(currentReportedMedications(report.referrals).length)}
        support="From referral follow-up"
      />
    </section>
  )
}

function ReportMetric({
  label,
  value,
  support
}: {
  readonly label: string
  readonly value: string
  readonly support?: string
}): React.JSX.Element {
  return (
    <div>
      <span>{label}</span>
      <strong>{value}</strong>
      {support === undefined ? null : <small>{support}</small>}
    </div>
  )
}

function VitalsReport({
  report,
  timeZone,
  interactive,
  onOpenEncounter
}: {
  readonly report: PatientReportData
  readonly timeZone: string
  readonly interactive: boolean
  onOpenEncounter(encounterId: string): void
}): React.JSX.Element {
  const encounters = new Map(report.encounters.map((encounter) => [encounter.id, encounter]))
  const rows = report.encounterDetails.flatMap((detail) =>
    detail.vitals.map((vital) => ({
      detail,
      vital,
      encounter: encounters.get(detail.encounter.id)
    }))
  )
  return (
    <ReportSection title="Vitals" empty={rows.length === 0} emptyMessage="No vitals in this range.">
      <ReportTable headings={['Date', 'BP', 'HR', 'Weight', 'Recommendation', 'Encounter']}>
        {rows.map(({ detail, vital, encounter }) => (
          <tr key={`${detail.encounter.id}-${vital.sequenceNumber}`}>
            <td>{formatTimestamp(vital.measuredAt, timeZone)}</td>
            <td>{`${vital.systolic} / ${vital.diastolic} mmHg`}</td>
            <td>{vital.pulse === null ? '-' : `${vital.pulse} bpm`}</td>
            <td>{encounter?.weightKg == null ? '-' : `${encounter.weightKg} kg`}</td>
            <td>{encounter === undefined ? '-' : formatAction(encounter.nextAction)}</td>
            <td>
              {interactive ? (
                <RecordLink onClick={() => onOpenEncounter(detail.encounter.id)}>Open</RecordLink>
              ) : (
                detail.encounter.patientCode
              )}
            </td>
          </tr>
        ))}
      </ReportTable>
    </ReportSection>
  )
}

function LifestyleReport({
  report,
  timeZone,
  interactive,
  onOpenEncounter
}: {
  readonly report: PatientReportData
  readonly timeZone: string
  readonly interactive: boolean
  onOpenEncounter(encounterId: string): void
}): React.JSX.Element {
  const rows = report.encounterDetails.flatMap((detail) =>
    detail.lifestyle.map((item) => ({ detail, item }))
  )
  return (
    <ReportSection
      title="Lifestyle"
      empty={rows.length === 0}
      emptyMessage="No finalized lifestyle responses in this range."
    >
      <ReportTable
        headings={['Screening date', 'Lifestyle area', 'Reported response', 'Encounter']}
      >
        {rows.map(({ detail, item }) => (
          <tr key={`${detail.encounter.id}-${item.questionCode}`}>
            <td>{formatTimestamp(detail.encounter.completedAt, timeZone, false)}</td>
            <td>{formatLifestyleQuestion(item.questionCode)}</td>
            <td>{formatCode(item.responseCode)}</td>
            <td>
              {interactive ? (
                <RecordLink onClick={() => onOpenEncounter(detail.encounter.id)}>Open</RecordLink>
              ) : (
                detail.encounter.patientCode
              )}
            </td>
          </tr>
        ))}
      </ReportTable>
    </ReportSection>
  )
}

function FoodReport({
  details,
  timeZone
}: {
  readonly details: readonly PublicManagedEncounterDetail[]
  readonly timeZone: string
}): React.JSX.Element {
  const rows = details.flatMap((detail) => detail.foods.map((food) => ({ detail, food })))
  return (
    <ReportSection title="Food" empty={rows.length === 0} emptyMessage="No foods in this range.">
      <ReportTable headings={['Screening date', 'Food', 'Frequency', 'Preparation / notes']}>
        {rows.map(({ detail, food }, index) => (
          <tr key={`${detail.encounter.id}-${food.foodName}-${index}`}>
            <td>{formatTimestamp(detail.encounter.completedAt, timeZone, false)}</td>
            <td>{food.foodName}</td>
            <td>{formatCode(food.frequencyCode)}</td>
            <td>{food.notes ?? '-'}</td>
          </tr>
        ))}
      </ReportTable>
    </ReportSection>
  )
}

function OtcReport({
  details,
  timeZone
}: {
  readonly details: readonly PublicManagedEncounterDetail[]
  readonly timeZone: string
}): React.JSX.Element {
  const rows = details.flatMap((detail) =>
    detail.otcMedications.map((medication) => ({ detail, medication }))
  )
  return (
    <ReportSection
      title="OTC medications"
      empty={rows.length === 0}
      emptyMessage="No OTC medications in this range."
    >
      <ReportTable
        headings={[
          'Screening date',
          'Product',
          'Reason for use',
          'Dose / frequency',
          'Duration / source',
          'Currently taking'
        ]}
      >
        {rows.map(({ detail, medication }, index) => (
          <tr key={`${detail.encounter.id}-${medication.productName}-${index}`}>
            <td>{formatTimestamp(detail.encounter.completedAt, timeZone, false)}</td>
            <td>{medication.productName}</td>
            <td>{medication.reasonForUse}</td>
            <td>{formatJoined([medication.doseText, medication.frequencyText])}</td>
            <td>{formatJoined([medication.durationText, medication.sourceOfMedication])}</td>
            <td>{formatBoolean(medication.currentlyTaking)}</td>
          </tr>
        ))}
      </ReportTable>
    </ReportSection>
  )
}

function CurrentReportedMedications({
  referrals
}: {
  readonly referrals: readonly PublicReferralDetail[]
}): React.JSX.Element {
  const medications = currentReportedMedications(referrals)
  return (
    <ReportSection
      title="Current reported medications"
      subtitle="Most recently reported medication entries from referral follow-up"
      empty={medications.length === 0}
      emptyMessage="No referral medications were reported."
    >
      <ReportTable headings={['Medication', 'Latest reported change', 'Dosage', 'Frequency']}>
        {medications.map((item) => (
          <tr key={item.medication.id}>
            <td>{item.medication.medicationName}</td>
            <td>{`${formatCode(item.medication.changeType)} - ${formatLocalDate(item.contactDate)}`}</td>
            <td>{item.medication.dosage ?? '-'}</td>
            <td>{item.medication.frequency ?? '-'}</td>
          </tr>
        ))}
      </ReportTable>
    </ReportSection>
  )
}

function ReferralsReport({
  referrals,
  timeZone,
  interactive,
  onOpenEncounter,
  onOpenReferral
}: {
  readonly referrals: readonly PublicReferralDetail[]
  readonly timeZone: string
  readonly interactive: boolean
  onOpenEncounter(encounterId: string): void
  onOpenReferral(referralId: string): void
}): React.JSX.Element {
  return (
    <ReportSection
      title="Referrals"
      subtitle="Includes every recorded status change, follow-up, action, and medication entry"
      empty={referrals.length === 0}
      emptyMessage="No referrals are active or had activity in this range."
    >
      <div className="patient-report-referral-list">
        {referrals.map((referral) => (
          <ReferralRecord
            key={referral.id}
            referral={referral}
            timeZone={timeZone}
            interactive={interactive}
            onOpenEncounter={onOpenEncounter}
            onOpenReferral={onOpenReferral}
          />
        ))}
      </div>
    </ReportSection>
  )
}

function ReferralRecord({
  referral,
  timeZone,
  interactive,
  onOpenEncounter,
  onOpenReferral
}: {
  readonly referral: PublicReferralDetail
  readonly timeZone: string
  readonly interactive: boolean
  onOpenEncounter(encounterId: string): void
  onOpenReferral(referralId: string): void
}): React.JSX.Element {
  return (
    <article className="patient-report-referral-record">
      <header>
        <div>
          <h4>{`${formatCode(referral.urgency)} referral - ${formatCode(referral.status)}`}</h4>
          <p>{formatReferralReason(referral)}</p>
        </div>
        {interactive ? (
          <div className="patient-report-inline-actions">
            <RecordLink onClick={() => onOpenReferral(referral.id)}>Open referral</RecordLink>
            <RecordLink onClick={() => onOpenEncounter(referral.encounterId)}>
              Open encounter
            </RecordLink>
          </div>
        ) : null}
      </header>
      <dl className="patient-report-referral-metadata">
        <DemographicLine label="Created" value={formatTimestamp(referral.createdAt, timeZone)} />
        <DemographicLine label="Due" value={formatLocalDate(referral.dueDate)} />
        <DemographicLine label="Destination" value={referral.destinationName ?? 'Not recorded'} />
        <DemographicLine
          label="Closed"
          value={
            referral.closedAt === null
              ? 'No'
              : `${formatTimestamp(referral.closedAt, timeZone)}${
                  referral.closureReason === null ? '' : ` - ${referral.closureReason}`
                }`
          }
        />
      </dl>
      <h5>Status history</h5>
      <ReportTable headings={['Date', 'Change', 'Recorded by', 'Reason']}>
        {referral.statusHistory.map((item) => (
          <tr key={item.id}>
            <td>{formatTimestamp(item.changedAt, timeZone)}</td>
            <td>{`${item.fromStatus === null ? 'Created' : formatCode(item.fromStatus)} to ${formatCode(item.toStatus)}`}</td>
            <td>{item.changedByDisplayName}</td>
            <td>{item.changeReason ?? '-'}</td>
          </tr>
        ))}
      </ReportTable>
      <h5>Follow-up and actions</h5>
      {referral.followups.length === 0 ? (
        <p>No follow-up recorded.</p>
      ) : (
        referral.followups.map((followup) => (
          <ReferralFollowup key={followup.id} followup={followup} timeZone={timeZone} />
        ))
      )}
    </article>
  )
}

function ReferralFollowup({
  followup,
  timeZone
}: {
  readonly followup: PublicReferralFollowup
  readonly timeZone: string
}): React.JSX.Element {
  return (
    <section className="patient-report-followup">
      <header>
        <strong>{formatLocalDate(followup.contactDate)}</strong>
        <span>{`${formatCode(followup.contactMethod)} - ${followup.recordedByDisplayName}`}</span>
      </header>
      <dl>
        <DemographicLine
          label="Information source"
          value={formatCode(followup.informationSource)}
        />
        <DemographicLine label="Provider seen" value={formatBoolean(followup.providerSeen)} />
        <DemographicLine label="Facility" value={followup.facilityName ?? 'Not recorded'} />
        <DemographicLine
          label="Date seen"
          value={followup.dateSeen === null ? 'Not recorded' : formatLocalDate(followup.dateSeen)}
        />
        <DemographicLine
          label="Reported outcome"
          value={followup.reportedOutcome ?? 'Not recorded'}
        />
        <DemographicLine
          label="Medication / advice"
          value={followup.reportedMedicationsOrAdvice ?? 'Not recorded'}
        />
        <DemographicLine label="Next action" value={followup.nextAction ?? 'Not recorded'} />
        <DemographicLine
          label="Next follow-up"
          value={
            followup.nextFollowupDate === null
              ? 'Not recorded'
              : formatLocalDate(followup.nextFollowupDate)
          }
        />
        <DemographicLine label="Recorded" value={formatTimestamp(followup.recordedAt, timeZone)} />
      </dl>
      <p>
        <strong>Treatment actions:</strong>{' '}
        {followup.treatmentActions.length === 0
          ? 'None recorded'
          : followup.treatmentActions.map(formatCode).join(', ')}
      </p>
      {followup.medicationChanges.length === 0 ? null : (
        <ReportTable headings={['Medication action', 'Medication', 'Dosage', 'Frequency']}>
          {followup.medicationChanges.map((medication) => (
            <tr key={medication.id}>
              <td>{formatCode(medication.changeType)}</td>
              <td>{medication.medicationName}</td>
              <td>{medication.dosage ?? '-'}</td>
              <td>{medication.frequency ?? '-'}</td>
            </tr>
          ))}
        </ReportTable>
      )}
    </section>
  )
}

function ReportSection({
  title,
  subtitle,
  empty,
  emptyMessage,
  children
}: {
  readonly title: string
  readonly subtitle?: string
  readonly empty: boolean
  readonly emptyMessage: string
  readonly children: React.ReactNode
}): React.JSX.Element {
  return (
    <section className="patient-report-section">
      <div className="patient-report-section-heading">
        <h3>{title}</h3>
        {subtitle === undefined ? null : <span>{subtitle}</span>}
      </div>
      {empty ? <p>{emptyMessage}</p> : children}
    </section>
  )
}

function ReportTable({
  headings,
  children
}: {
  readonly headings: readonly string[]
  readonly children: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="patient-report-table-wrap">
      <table className="patient-report-table">
        <thead>
          <tr>
            {headings.map((heading) => (
              <th key={heading} scope="col">
                {heading}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  )
}

function RecordLink({
  children,
  onClick
}: {
  readonly children: React.ReactNode
  onClick(): void
}): React.JSX.Element {
  return (
    <button className="patient-report-record-link" type="button" onClick={onClick}>
      {children}
    </button>
  )
}

function currentReportedMedications(referrals: readonly PublicReferralDetail[]): readonly {
  readonly medication: PublicReferralFollowup['medicationChanges'][number]
  readonly contactDate: string
}[] {
  const ordered = referrals
    .flatMap((referral) =>
      referral.followups.flatMap((followup) =>
        followup.medicationChanges.map((medication) => ({
          medication,
          contactDate: followup.contactDate,
          recordedAt: followup.recordedAt
        }))
      )
    )
    .sort((left, right) => right.recordedAt.localeCompare(left.recordedAt))
  const names = new Set<string>()
  return ordered.filter((item) => {
    const name = item.medication.medicationName.trim().toLocaleLowerCase()
    if (names.has(name)) return false
    names.add(name)
    return true
  })
}

function formatReferralReason(referral: PublicReferralDetail): string {
  const reason = referral.reasonText ?? referral.reasonCodes.map(formatCode).join(', ')
  const bloodPressure = referral.triggeringBloodPressure
  return bloodPressure === undefined || bloodPressure === null
    ? reason
    : `${reason} - BP ${bloodPressure.systolic}/${bloodPressure.diastolic} mmHg`
}

function reportKindLabel(kind: PatientReportKind): string {
  return kind === 'GENERAL'
    ? 'General patient report'
    : kind === 'VITALS'
      ? 'Vitals report'
      : kind === 'LIFESTYLE'
        ? 'Lifestyle report'
        : 'Referrals report'
}

function formatLifestyleQuestion(value: string): string {
  const labels: Record<string, string> = {
    WEEKLY_ALCOHOL: 'Alcohol use',
    WEEKLY_TOBACCO: 'Tobacco use',
    WEEKLY_PHYSICAL_ACTIVITY: 'Physical activity',
    WEEKLY_WORK: 'Work / job activity',
    WEEKLY_OTHER_ACTIVITY: 'Other activity'
  }
  return labels[value] ?? formatCode(value)
}

function formatAction(value: PublicPatientHistoryEncounter['nextAction']): string {
  return value === 'URGENT_REFERRAL'
    ? 'Urgent referral'
    : value === 'REFER'
      ? 'Standard referral'
      : 'Routine'
}

function formatAgeAndSex(patient: PublicPatientDetail, asOfDate: string): string {
  const sex = patient.sex === 'FEMALE' ? 'Female' : patient.sex === 'MALE' ? 'Male' : 'Unknown'
  if (patient.dateOfBirth === null) {
    return patient.approximateAgeYears === null
      ? sex
      : `Approximately ${patient.approximateAgeYears} years - ${sex}`
  }
  const [birthYear = 0, birthMonth = 0, birthDay = 0] = patient.dateOfBirth.split('-').map(Number)
  const [year = 0, month = 0, day = 0] = asOfDate.split('-').map(Number)
  let age = year - birthYear
  if (month < birthMonth || (month === birthMonth && day < birthDay)) age -= 1
  return `${age} years - ${sex}`
}

function formatLocation(patient: PublicPatientDetail): string {
  return [patient.village, patient.quarter].filter((value) => value !== null).join(' / ') || '-'
}

function formatBoolean(value: boolean | null): string {
  return value === null ? 'Not recorded' : value ? 'Yes' : 'No'
}

function formatJoined(values: readonly (string | null | undefined)[]): string {
  return (
    values.filter((value): value is string => value !== null && value !== undefined).join(' / ') ||
    '-'
  )
}

function formatCode(value: string): string {
  return value
    .toLowerCase()
    .replaceAll('_', ' ')
    .replace(/^./u, (letter) => letter.toUpperCase())
}

function formatLocalDate(value: string): string {
  const [year = 0, month = 0, day = 0] = value.split('-').map(Number)
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeZone: 'UTC' }).format(
    new Date(Date.UTC(year, month - 1, day))
  )
}

function formatTimestamp(value: string | null, timeZone: string, includeTime = true): string {
  if (value === null) return '-'
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    ...(includeTime ? { timeStyle: 'short' as const } : {}),
    timeZone
  }).format(new Date(value))
}
