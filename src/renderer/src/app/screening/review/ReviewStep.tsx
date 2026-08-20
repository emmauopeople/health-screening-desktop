import type { FoodDraftState } from '../food/food-workspace-model'
import {
  getAlcoholCardSummary,
  getTobaccoCardSummary,
  getWorkBaselineForInterpretation,
  otherActivitySummary,
  physicalActivitySummary,
  workSummary,
  type LifestyleDraftState
} from '../lifestyle/lifestyle-workspace-model'
import type { OtcDraftState } from '../otc/otc-workspace-model'

export interface ReviewVitalsReading {
  readonly sequenceNumber: number
  readonly systolic: string
  readonly diastolic: string
  readonly pulse: string
  readonly site: string
  readonly position: string
  readonly time: string
}

export interface ReviewVitals {
  readonly readings: readonly ReviewVitalsReading[]
  readonly weightKg: string
  readonly waist: string
  readonly notes: string
}

export interface ReviewStepProps {
  readonly protocolVersionId: string
  readonly vitals: ReviewVitals
  readonly lifestyle: LifestyleDraftState
  readonly food: FoodDraftState
  readonly otc: OtcDraftState
  onBackToOtc(): void
}

export function ReviewStep({
  protocolVersionId,
  vitals,
  lifestyle,
  food,
  otc,
  onBackToOtc
}: ReviewStepProps): React.JSX.Element {
  const workBaseline =
    lifestyle.workspace === null ? null : getWorkBaselineForInterpretation(lifestyle.workspace)

  return (
    <section
      className="screening-current-step review-step"
      aria-labelledby="screening-review-step-title"
    >
      <div className="screening-current-step-header">
        <div>
          <h3 id="screening-review-step-title">Review</h3>
          <p className="review-intro">Confirm the recorded screening information.</p>
        </div>
        <span>Review only</span>
      </div>

      <div className="review-grid">
        <article className="review-card">
          <h4>Vitals</h4>
          <div className="review-table-wrap">
            <table className="review-table">
              <thead>
                <tr>
                  <th scope="col">Reading</th>
                  <th scope="col">Blood pressure</th>
                  <th scope="col">Pulse</th>
                  <th scope="col">Site</th>
                  <th scope="col">Position</th>
                  <th scope="col">Time</th>
                </tr>
              </thead>
              <tbody>
                {vitals.readings.map((reading) => (
                  <tr key={reading.sequenceNumber}>
                    <td>{reading.sequenceNumber}</td>
                    <td>
                      {reading.systolic} / {reading.diastolic}
                    </td>
                    <td>{reading.pulse}</td>
                    <td>{formatReviewValue(reading.site)}</td>
                    <td>{formatReviewValue(reading.position)}</td>
                    <td>{reading.time || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <dl className="review-measurements">
            <div>
              <dt>Weight</dt>
              <dd>{vitals.weightKg ? `${vitals.weightKg} kg` : '—'}</dd>
            </div>
            <div>
              <dt>Waist</dt>
              <dd>{vitals.waist || '—'}</dd>
            </div>
            <div>
              <dt>Notes</dt>
              <dd>{vitals.notes || '—'}</dd>
            </div>
          </dl>
        </article>

        <article className="review-card">
          <h4>Weekly lifestyle</h4>
          <ul className="review-summary-list">
            <li>
              <strong>Alcohol:</strong> {getAlcoholCardSummary(lifestyle, true)}
            </li>
            <li>
              <strong>Tobacco:</strong> {getTobaccoCardSummary(lifestyle, true)}
            </li>
            <li>
              <strong>Exercise:</strong> {physicalActivitySummary(lifestyle.physicalActivity)}
            </li>
            <li>
              <strong>Job type:</strong> {workSummary(lifestyle.work, workBaseline)}
            </li>
            <li>
              <strong>Other activity:</strong> {otherActivitySummary(lifestyle.otherActivity)}
            </li>
          </ul>
        </article>

        <article className="review-card">
          <h4>Food</h4>
          <p>
            <strong>Response:</strong> {formatFoodResponse(food.foodResponse)}
          </p>
          {food.foodResponse === 'REPORTED' ? (
            <ul className="review-item-list">
              {food.rows.map((row) => (
                <li key={row.localKey}>
                  <strong>{row.foodName}</strong>
                  {row.frequencyCode ? ` — ${formatReviewValue(row.frequencyCode)}` : ''}
                  {row.preparationNote ? ` — ${row.preparationNote}` : ''}
                </li>
              ))}
            </ul>
          ) : null}
        </article>

        <article className="review-card">
          <h4>OTC medications</h4>
          <p>
            <strong>Response:</strong> {formatOtcResponse(otc.otcResponse)}
          </p>
          {otc.otcResponse === 'REPORTED' ? (
            <ul className="review-item-list">
              {otc.rows.map((row) => (
                <li key={row.localKey}>
                  <strong>{row.productName}</strong> — {row.reasonForUse}
                  {row.currentlyTakingResponse
                    ? ` — Currently taking: ${formatReviewValue(row.currentlyTakingResponse)}`
                    : ''}
                </li>
              ))}
            </ul>
          ) : null}
        </article>
      </div>

      <div className="review-status" role="status">
        <div>
          <strong>Protocol reference:</strong>{' '}
          <span className="review-protocol-reference">{protocolVersionId}</span>
        </div>
        <div>
          Protocol action, referral decision, and final completion are not performed in this step.
        </div>
      </div>

      <div className="screening-encounter-actions">
        <button className="button button-secondary" type="button" onClick={onBackToOtc}>
          Previous
        </button>
        <button className="button button-primary" type="button" disabled>
          Complete screening
        </button>
      </div>
    </section>
  )
}

function formatFoodResponse(response: FoodDraftState['foodResponse']): string {
  return response === 'REPORTED'
    ? 'Foods reported'
    : response === 'UNKNOWN'
      ? 'Unknown'
      : response === 'DECLINED'
        ? 'Declined'
        : response === 'PREFER_NOT_TO_ANSWER'
          ? 'Prefer not to answer'
          : 'Not answered'
}

function formatOtcResponse(response: OtcDraftState['otcResponse']): string {
  return response === 'REPORTED'
    ? 'Medication reported'
    : response === 'NONE_REPORTED'
      ? 'No medication reported'
      : response === 'UNKNOWN'
        ? 'Unknown'
        : response === 'DECLINED'
          ? 'Declined'
          : response === 'PREFER_NOT_TO_ANSWER'
            ? 'Prefer not to answer'
            : 'Not answered'
}

function formatReviewValue(value: string): string {
  if (value.length === 0) return '—'
  return value
    .toLocaleLowerCase('en-US')
    .split('_')
    .map((part) => part.charAt(0).toLocaleUpperCase('en-US') + part.slice(1))
    .join(' ')
}
