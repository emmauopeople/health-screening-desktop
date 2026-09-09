import type {
  PublicManagedEncounterDetail,
  PublicPatientDetail,
  PublicPatientHistoryEncounter,
  PublicReferralDetail
} from '@shared/ipc'
import type { PatientReportData, PatientReportKind } from './patient-report-model'
import {
  formatReferralReason,
  referralInitialTreatmentSummary,
  referralMedicationSummary
} from './referral-report-format'

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
          showOverview
          showDetails
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
        showOverview
        showDetails={false}
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
    <>
      <ReportSection
        title="Vitals"
        empty={rows.length === 0}
        emptyMessage="No vitals in this range."
      >
        <ReportTable
          headings={[
            'Date',
            'BP',
            'HR',
            'Weight',
            'Recommendation',
            ...(interactive ? ['Open'] : [])
          ]}
        >
          {rows.map(({ detail, vital, encounter }) => (
            <tr key={`${detail.encounter.id}-${vital.sequenceNumber}`}>
              <td>{formatTimestamp(vital.measuredAt, timeZone)}</td>
              <td>{`${vital.systolic} / ${vital.diastolic} mmHg`}</td>
              <td>{vital.pulse === null ? '-' : `${vital.pulse} bpm`}</td>
              <td>{encounter?.weightKg == null ? '-' : `${encounter.weightKg} kg`}</td>
              <td>{encounter === undefined ? '-' : formatAction(encounter.nextAction)}</td>
              {interactive ? (
                <td>
                  <RecordLink onClick={() => onOpenEncounter(detail.encounter.id)}>Open</RecordLink>
                </td>
              ) : null}
            </tr>
          ))}
        </ReportTable>
      </ReportSection>
      {rows.length > 0 && (report.kind === 'VITALS' || report.kind === 'GENERAL') ? (
        <VitalsTrendCharts report={report} timeZone={timeZone} printSafe={!interactive} />
      ) : null}
    </>
  )
}

interface ReportTrendPoint {
  readonly timestamp: string
  readonly value: number
}

function VitalsTrendCharts({
  report,
  timeZone,
  printSafe
}: {
  readonly report: PatientReportData
  readonly timeZone: string
  readonly printSafe: boolean
}): React.JSX.Element {
  const bloodPressureReadings = report.encounterDetails
    .flatMap((detail) =>
      detail.vitals.map((vital) => ({
        timestamp: vital.measuredAt,
        systolic: vital.systolic,
        diastolic: vital.diastolic,
        sequenceNumber: vital.sequenceNumber,
        encounterId: detail.encounter.id
      }))
    )
    .sort(
      (left, right) =>
        left.timestamp.localeCompare(right.timestamp) ||
        left.encounterId.localeCompare(right.encounterId) ||
        left.sequenceNumber - right.sequenceNumber
    )
  const weightReadings: ReportTrendPoint[] = report.encounters
    .flatMap((encounter) =>
      encounter.weightKg === null
        ? []
        : [{ timestamp: encounter.completedAt, value: encounter.weightKg }]
    )
    .sort((left, right) => left.timestamp.localeCompare(right.timestamp))

  return (
    <section className="patient-report-trends" aria-label="Vital-sign trends">
      <h4>Vital-sign trends</h4>
      {printSafe ? (
        <>
          <BloodPressureBarChart readings={bloodPressureReadings} timeZone={timeZone} />
          <SingleSeriesBarChart
            title="Weight trend"
            unit="kg"
            emptyMessage="No weight readings in this range."
            readings={weightReadings}
            timeZone={timeZone}
          />
        </>
      ) : (
        <>
          <BloodPressureLineChart readings={bloodPressureReadings} timeZone={timeZone} />
          <SingleSeriesLineChart
            title="Weight trend"
            unit="kg"
            emptyMessage="No weight readings in this range."
            readings={weightReadings}
            timeZone={timeZone}
          />
        </>
      )}
    </section>
  )
}

function BloodPressureBarChart({
  readings,
  timeZone
}: {
  readonly readings: readonly {
    readonly timestamp: string
    readonly systolic: number
    readonly diastolic: number
  }[]
  readonly timeZone: string
}): React.JSX.Element {
  const maximum = roundedBarMaximum(
    readings.flatMap((reading) => [reading.systolic, reading.diastolic]),
    20
  )

  return (
    <div
      className="patient-report-bar-chart patient-report-bp-chart"
      data-report-chart="blood-pressure"
      data-report-chart-type="bar"
      role="img"
      aria-label={`Blood pressure bar graph with ${readings.length} ${readings.length === 1 ? 'reading' : 'readings'}`}
    >
      <ChartHeading title="Blood pressure trend" unit="mmHg">
        <span data-series="systolic">Systolic</span>
        <span data-series="diastolic">Diastolic</span>
      </ChartHeading>
      <div className="patient-report-bar-plot">
        <span className="patient-report-bar-scale">{`Scale 0-${maximum}`}</span>
        <div className="patient-report-bar-groups">
          {readings.map((reading, index) => (
            <div className="patient-report-bar-group" key={`${reading.timestamp}-${index}`}>
              <div className="patient-report-bars">
                <ReportBar value={reading.systolic} maximum={maximum} series="systolic" />
                <ReportBar value={reading.diastolic} maximum={maximum} series="diastolic" />
              </div>
              <span>{formatTrendDate(reading.timestamp, timeZone)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function SingleSeriesBarChart({
  title,
  unit,
  emptyMessage,
  readings,
  timeZone
}: {
  readonly title: string
  readonly unit: string
  readonly emptyMessage: string
  readonly readings: readonly ReportTrendPoint[]
  readonly timeZone: string
}): React.JSX.Element {
  if (readings.length === 0) {
    return (
      <div
        className="patient-report-bar-chart patient-report-chart-empty"
        data-report-chart="weight"
      >
        <ChartHeading title={title} unit={unit} />
        <p>{emptyMessage}</p>
      </div>
    )
  }

  const maximum = roundedBarMaximum(
    readings.map((reading) => reading.value),
    10
  )
  return (
    <div
      className="patient-report-bar-chart patient-report-weight-chart"
      data-report-chart="weight"
      data-report-chart-type="bar"
      role="img"
      aria-label={`${title} bar graph with ${readings.length} ${readings.length === 1 ? 'reading' : 'readings'}`}
    >
      <ChartHeading title={title} unit={unit} />
      <div className="patient-report-bar-plot">
        <span className="patient-report-bar-scale">{`Scale 0-${maximum}`}</span>
        <div className="patient-report-bar-groups">
          {readings.map((reading, index) => (
            <div className="patient-report-bar-group" key={`${reading.timestamp}-${index}`}>
              <div className="patient-report-bars">
                <ReportBar value={reading.value} maximum={maximum} series="weight" />
              </div>
              <span>{formatTrendDate(reading.timestamp, timeZone)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function ReportBar({
  value,
  maximum,
  series
}: {
  readonly value: number
  readonly maximum: number
  readonly series: 'systolic' | 'diastolic' | 'weight'
}): React.JSX.Element {
  return (
    <span
      className={`patient-report-bar is-${series}`}
      style={{ height: `${Math.max(2, (value / maximum) * 100)}%` }}
    >
      <strong>{formatTrendWeight(value)}</strong>
    </span>
  )
}

function roundedBarMaximum(values: readonly number[], step: number): number {
  const maximum = Math.max(step, ...values)
  return Math.ceil(maximum / step) * step
}

function BloodPressureLineChart({
  readings,
  timeZone
}: {
  readonly readings: readonly {
    readonly timestamp: string
    readonly systolic: number
    readonly diastolic: number
  }[]
  readonly timeZone: string
}): React.JSX.Element {
  const dimensions = createTrendDimensions(
    readings.flatMap((reading) => [reading.systolic, reading.diastolic]),
    10
  )
  const systolicPoints = readings.map((reading, index) => ({
    x: trendX(index, readings.length, dimensions),
    y: trendY(reading.systolic, dimensions),
    timestamp: reading.timestamp,
    value: reading.systolic
  }))
  const diastolicPoints = readings.map((reading, index) => ({
    x: trendX(index, readings.length, dimensions),
    y: trendY(reading.diastolic, dimensions),
    timestamp: reading.timestamp,
    value: reading.diastolic
  }))

  return (
    <div
      className="patient-report-line-chart patient-report-bp-chart"
      data-report-chart="blood-pressure"
      role="img"
      aria-label={`Blood pressure line graph with ${readings.length} ${readings.length === 1 ? 'reading' : 'readings'}`}
    >
      <ChartHeading title="Blood pressure trend" unit="mmHg">
        <span data-series="systolic">Systolic</span>
        <span data-series="diastolic">Diastolic</span>
      </ChartHeading>
      <svg viewBox="0 0 800 230" aria-hidden="true" preserveAspectRatio="xMidYMid meet">
        <TrendAxes
          dimensions={dimensions}
          timestamps={readings.map((reading) => reading.timestamp)}
          timeZone={timeZone}
          formatValue={(value) => String(Math.round(value))}
        />
        <path className="patient-report-trend-line is-systolic" d={trendPath(systolicPoints)} />
        <path className="patient-report-trend-line is-diastolic" d={trendPath(diastolicPoints)} />
        <TrendMarkers points={systolicPoints} series="systolic" unit="mmHg" />
        <TrendMarkers points={diastolicPoints} series="diastolic" unit="mmHg" />
      </svg>
    </div>
  )
}

function SingleSeriesLineChart({
  title,
  unit,
  emptyMessage,
  readings,
  timeZone
}: {
  readonly title: string
  readonly unit: string
  readonly emptyMessage: string
  readonly readings: readonly ReportTrendPoint[]
  readonly timeZone: string
}): React.JSX.Element {
  if (readings.length === 0) {
    return (
      <div
        className="patient-report-line-chart patient-report-chart-empty"
        data-report-chart="weight"
      >
        <ChartHeading title={title} unit={unit} />
        <p>{emptyMessage}</p>
      </div>
    )
  }

  const dimensions = createTrendDimensions(
    readings.map((reading) => reading.value),
    1
  )
  const points = readings.map((reading, index) => ({
    ...reading,
    x: trendX(index, readings.length, dimensions),
    y: trendY(reading.value, dimensions)
  }))

  return (
    <div
      className="patient-report-line-chart patient-report-weight-chart"
      data-report-chart="weight"
      role="img"
      aria-label={`${title} line graph with ${readings.length} ${readings.length === 1 ? 'reading' : 'readings'}`}
    >
      <ChartHeading title={title} unit={unit} />
      <svg viewBox="0 0 800 230" aria-hidden="true" preserveAspectRatio="xMidYMid meet">
        <TrendAxes
          dimensions={dimensions}
          timestamps={readings.map((reading) => reading.timestamp)}
          timeZone={timeZone}
          formatValue={formatTrendWeight}
        />
        <path className="patient-report-trend-line is-weight" d={trendPath(points)} />
        <TrendMarkers points={points} series="weight" unit={unit} />
      </svg>
    </div>
  )
}

function ChartHeading({
  title,
  unit,
  children
}: {
  readonly title: string
  readonly unit: string
  readonly children?: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="patient-report-chart-heading">
      <strong>{title}</strong>
      <span>{unit}</span>
      {children === undefined ? null : (
        <div className="patient-report-chart-legend" aria-hidden="true">
          {children}
        </div>
      )}
    </div>
  )
}

interface TrendDimensions {
  readonly left: number
  readonly right: number
  readonly top: number
  readonly bottom: number
  readonly minimum: number
  readonly maximum: number
  readonly ticks: readonly number[]
}

function createTrendDimensions(values: readonly number[], padding: number): TrendDimensions {
  const valueMinimum = Math.min(...values)
  const valueMaximum = Math.max(...values)
  const step = padding >= 10 ? 10 : 0.5
  const minimum = Math.max(0, Math.floor((valueMinimum - padding) / step) * step)
  const maximum = Math.max(minimum + step * 4, Math.ceil((valueMaximum + padding) / step) * step)
  return {
    left: 58,
    right: 782,
    top: 18,
    bottom: 188,
    minimum,
    maximum,
    ticks: Array.from({ length: 5 }, (_, index) => minimum + ((maximum - minimum) * index) / 4)
  }
}

function trendX(index: number, count: number, dimensions: TrendDimensions): number {
  if (count <= 1) return (dimensions.left + dimensions.right) / 2
  return dimensions.left + (index * (dimensions.right - dimensions.left)) / (count - 1)
}

function trendY(value: number, dimensions: TrendDimensions): number {
  return (
    dimensions.bottom -
    ((value - dimensions.minimum) / (dimensions.maximum - dimensions.minimum)) *
      (dimensions.bottom - dimensions.top)
  )
}

function trendPath(points: readonly { readonly x: number; readonly y: number }[]): string {
  return points
    .map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`)
    .join(' ')
}

function TrendAxes({
  dimensions,
  timestamps,
  timeZone,
  formatValue
}: {
  readonly dimensions: TrendDimensions
  readonly timestamps: readonly string[]
  readonly timeZone: string
  formatValue(value: number): string
}): React.JSX.Element {
  const labelIndexes = trendLabelIndexes(timestamps.length)
  return (
    <g className="patient-report-trend-axes">
      {dimensions.ticks.map((tick) => {
        const y = trendY(tick, dimensions)
        return (
          <g key={tick}>
            <line x1={dimensions.left} y1={y} x2={dimensions.right} y2={y} />
            <text x={dimensions.left - 10} y={y + 4} textAnchor="end">
              {formatValue(tick)}
            </text>
          </g>
        )
      })}
      {labelIndexes.map((index) => {
        const timestamp = timestamps[index]
        return timestamp === undefined ? null : (
          <text
            key={`${timestamp}-${index}`}
            x={trendX(index, timestamps.length, dimensions)}
            y="216"
            textAnchor="middle"
          >
            {formatTrendDate(timestamp, timeZone)}
          </text>
        )
      })}
    </g>
  )
}

function TrendMarkers({
  points,
  series,
  unit
}: {
  readonly points: readonly {
    readonly x: number
    readonly y: number
    readonly timestamp: string
    readonly value: number
  }[]
  readonly series: 'systolic' | 'diastolic' | 'weight'
  readonly unit: string
}): React.JSX.Element {
  return (
    <g className={`patient-report-trend-markers is-${series}`}>
      {points.map((point, index) => (
        <circle key={`${point.timestamp}-${index}`} cx={point.x} cy={point.y} r="4">
          <title>{`${formatCode(series)} ${formatTrendWeight(point.value)} ${unit}`}</title>
        </circle>
      ))}
    </g>
  )
}

function trendLabelIndexes(count: number): readonly number[] {
  if (count <= 6) return Array.from({ length: count }, (_, index) => index)
  return Array.from(
    new Set(Array.from({ length: 6 }, (_, index) => Math.round((index * (count - 1)) / 5)))
  )
}

function formatTrendDate(value: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone
  }).format(new Date(value))
}

function formatTrendWeight(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1)
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
  const screeningRows = report.encounterDetails.filter((detail) => detail.lifestyle.length > 0)
  return (
    <ReportSection
      title="Lifestyle"
      empty={screeningRows.length === 0}
      emptyMessage="No finalized lifestyle responses in this range."
    >
      <div
        className="patient-report-overview-table patient-report-lifestyle-overview"
        data-report-table="lifestyle-overview"
      >
        <ReportTable
          headings={[
            'Screening date',
            'Alcohol use',
            'Tobacco use',
            'Physical activity',
            'Work activity',
            'Other activity',
            ...(interactive ? ['Open'] : [])
          ]}
        >
          {screeningRows.map((detail) => {
            const responses = new Map(
              detail.lifestyle.map((item) => [item.questionCode, formatCode(item.responseCode)])
            )
            return (
              <tr key={detail.encounter.id}>
                <td>{formatTimestamp(detail.encounter.completedAt, timeZone, false)}</td>
                <td>{responses.get('WEEKLY_ALCOHOL') ?? 'Not recorded'}</td>
                <td>{responses.get('WEEKLY_TOBACCO') ?? 'Not recorded'}</td>
                <td>{responses.get('WEEKLY_PHYSICAL_ACTIVITY') ?? 'Not recorded'}</td>
                <td>{responses.get('WEEKLY_WORK') ?? 'Not recorded'}</td>
                <td>{responses.get('WEEKLY_OTHER_ACTIVITY') ?? 'Not recorded'}</td>
                {interactive ? (
                  <td>
                    <RecordLink onClick={() => onOpenEncounter(detail.encounter.id)}>
                      Open
                    </RecordLink>
                  </td>
                ) : null}
              </tr>
            )
          })}
        </ReportTable>
      </div>
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
  showOverview,
  showDetails,
  onOpenEncounter,
  onOpenReferral
}: {
  readonly referrals: readonly PublicReferralDetail[]
  readonly timeZone: string
  readonly interactive: boolean
  readonly showOverview: boolean
  readonly showDetails: boolean
  onOpenEncounter(encounterId: string): void
  onOpenReferral(referralId: string): void
}): React.JSX.Element {
  return (
    <ReportSection
      title="Referrals"
      subtitle={
        showDetails
          ? 'Includes every recorded status change, follow-up, action, and medication entry'
          : 'Referral overview for the selected date range'
      }
      empty={referrals.length === 0}
      emptyMessage="No referrals are active or had activity in this range."
    >
      <>
        {showOverview ? (
          <ReferralOverview
            referrals={referrals}
            timeZone={timeZone}
            interactive={interactive}
            onOpenReferral={onOpenReferral}
          />
        ) : null}
        {showDetails ? (
          <div className="patient-report-referral-details">
            <h4>Complete referral details</h4>
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
          </div>
        ) : null}
      </>
    </ReportSection>
  )
}

function ReferralOverview({
  referrals,
  timeZone,
  interactive,
  onOpenReferral
}: {
  readonly referrals: readonly PublicReferralDetail[]
  readonly timeZone: string
  readonly interactive: boolean
  onOpenReferral(referralId: string): void
}): React.JSX.Element {
  return (
    <div
      className="patient-report-overview-table patient-report-referral-overview"
      data-report-table="referral-overview"
    >
      <ReportTable
        headings={[
          'Date',
          'Reason',
          'Status',
          'Initial treatment',
          'Medication',
          ...(interactive ? ['Open'] : [])
        ]}
      >
        {referrals.map((referral) => (
          <tr key={referral.id}>
            <td>{formatTimestamp(referral.createdAt, timeZone, false)}</td>
            <td>{formatReferralReason(referral)}</td>
            <td>{formatCode(referral.status)}</td>
            <td>{referralInitialTreatmentSummary(referral)}</td>
            <td>{referralMedicationSummary(referral)}</td>
            {interactive ? (
              <td>
                <RecordLink onClick={() => onOpenReferral(referral.id)}>Open</RecordLink>
              </td>
            ) : null}
          </tr>
        ))}
      </ReportTable>
    </div>
  )
}

export function ReferralRecord({
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

function reportKindLabel(kind: PatientReportKind): string {
  return kind === 'GENERAL'
    ? 'General patient report'
    : kind === 'VITALS'
      ? 'Vitals report'
      : kind === 'LIFESTYLE'
        ? 'Lifestyle report'
        : 'Referrals report'
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
