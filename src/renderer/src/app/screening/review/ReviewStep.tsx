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
import type { ScreeningEncounterStatus } from '@shared/ipc'

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
  readonly vitals: ReviewVitals
  readonly lifestyle: LifestyleDraftState
  readonly food: FoodDraftState
  readonly otc: OtcDraftState
  readonly encounterStatus: ScreeningEncounterStatus
  readonly completionState: {
    readonly reviewConfirmed: boolean
    readonly saveStatus: 'IDLE' | 'SAVING' | 'COMPLETED' | 'ERROR'
    readonly statusMessage: string | null
  }
  onBackToOtc(): void
  onComplete(): void
  onEditVitals(): void
  onEditLifestyle(): void
  onEditFood(): void
  onEditOtc(): void
  onReviewConfirmedChange(reviewConfirmed: boolean): void
}

export function ReviewStep({
  vitals,
  lifestyle,
  food,
  otc,
  encounterStatus,
  completionState,
  onBackToOtc,
  onComplete,
  onEditVitals,
  onEditLifestyle,
  onEditFood,
  onEditOtc,
  onReviewConfirmedChange
}: ReviewStepProps): React.JSX.Element {
  const workBaseline =
    lifestyle.workspace === null ? null : getWorkBaselineForInterpretation(lifestyle.workspace)
  const completed = encounterStatus === 'COMPLETED' || completionState.saveStatus === 'COMPLETED'
  const saving = completionState.saveStatus === 'SAVING'
  const reviewLocked = completed || saving

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
          <ReviewCardHeader title="Vitals" disabled={reviewLocked} onEdit={onEditVitals} />
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
          <ReviewCardHeader
            title="Weekly lifestyle"
            disabled={reviewLocked}
            onEdit={onEditLifestyle}
          />
          <ul className="review-summary-list">
            <li>
              <strong>Alcohol:</strong> {getAlcoholCardSummary(lifestyle, true)}
              {lifestyle.alcohol.weeklyResponse === 'YES' ? (
                <ul className="review-item-list">
                  <li>
                    Past 7 days: {lifestyle.alcohol.drinkingDays} drinking days •{' '}
                    {lifestyle.alcohol.totalStandardizedDrinks} total drinks
                  </li>
                  <li>
                    Largest day: {lifestyle.alcohol.largestOneDayAmount} drinks •{' '}
                    {lifestyle.alcohol.daysAtLargestAmount} days at that amount
                  </li>
                  <li>
                    Beverages:{' '}
                    {formatList(
                      lifestyle.alcohol.commonBeverageTypes.map((value) =>
                        value === 'OTHER' && lifestyle.alcohol.otherBeverageDescription
                          ? lifestyle.alcohol.otherBeverageDescription
                          : formatReviewValue(value)
                      )
                    )}
                  </li>
                </ul>
              ) : null}
            </li>
            <li>
              <strong>Tobacco:</strong> {getTobaccoCardSummary(lifestyle, true)}
              {lifestyle.tobacco.weeklyResponse === 'YES' ? (
                <ul className="review-item-list">
                  {lifestyle.tobacco.products.map((product) => (
                    <li key={product.clientKey}>
                      {product.productType === 'OTHER' && product.otherProductDescription
                        ? product.otherProductDescription
                        : formatReviewValue(product.productType)}
                      : {product.daysUsed} days • {product.averageQuantityPerUseDay}{' '}
                      {product.unit === 'OTHER' && product.otherUnitDescription
                        ? product.otherUnitDescription
                        : formatReviewValue(product.unit)}{' '}
                      per use day • Secondhand exposure:{' '}
                      {formatBooleanResponse(product.secondhandSmokeExposure)}
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
            <li>
              <strong>Exercise:</strong> {physicalActivitySummary(lifestyle.physicalActivity)}
              {lifestyle.physicalActivity.weeklyResponse === 'YES' ? (
                <ul className="review-item-list">
                  {lifestyle.physicalActivity.activities.map((activity) => (
                    <li key={activity.clientKey}>
                      {formatReviewValue(activity.activityDomain)}
                      {activity.description ? ` • ${activity.description}` : ''} •{' '}
                      {formatReviewValue(activity.intensity)} • {activity.daysInPastSevenDays} days
                      •{' '}
                      {formatDuration(
                        activity.averageHoursPerActiveDay,
                        activity.averageMinutesPerActiveDay,
                        'per active day'
                      )}
                    </li>
                  ))}
                  <li>
                    Sedentary time:{' '}
                    {lifestyle.physicalActivity.sedentaryTimeResponse === 'RECORDED'
                      ? `${lifestyle.physicalActivity.sedentaryMinutesPerDay} minutes per day`
                      : formatReviewValue(lifestyle.physicalActivity.sedentaryTimeResponse)}
                  </li>
                </ul>
              ) : null}
            </li>
            <li>
              <strong>Job type:</strong> {workSummary(lifestyle.work, workBaseline)}
              <ul className="review-item-list">
                <li>Weekly response: {formatReviewValue(lifestyle.work.weeklyResponse)}</li>
                {lifestyle.workBaselineForm.occupationJobTitle ? (
                  <li>Occupation: {lifestyle.workBaselineForm.occupationJobTitle}</li>
                ) : null}
                {lifestyle.workBaselineForm.usualPhysicalDemand ? (
                  <li>
                    Usual demand:{' '}
                    {formatReviewValue(lifestyle.workBaselineForm.usualPhysicalDemand)}
                  </li>
                ) : null}
              </ul>
            </li>
            <li>
              <strong>Other activity:</strong> {otherActivitySummary(lifestyle.otherActivity)}
              {lifestyle.otherActivity.weeklyResponse === 'YES' ? (
                <ul className="review-item-list">
                  {lifestyle.otherActivity.activities.map((activity) => (
                    <li key={activity.clientKey}>
                      {formatReviewValue(activity.category)}
                      {activity.description ? ` • ${activity.description}` : ''} •{' '}
                      {formatReviewValue(activity.intensity)} • {activity.daysInPastSevenDays} days
                      •{' '}
                      {formatDuration(
                        activity.averageHoursPerDay,
                        activity.averageMinutesPerDay,
                        'per day'
                      )}
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          </ul>
        </article>

        <article className="review-card">
          <ReviewCardHeader title="Food" disabled={reviewLocked} onEdit={onEditFood} />
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
          <ReviewCardHeader title="OTC medications" disabled={reviewLocked} onEdit={onEditOtc} />
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

      {completionState.statusMessage !== null ? (
        <div
          className={`screening-message${
            completionState.saveStatus === 'ERROR' ? ' screening-message-alert' : ''
          }`}
          role={completionState.saveStatus === 'ERROR' ? 'alert' : 'status'}
        >
          {completionState.statusMessage}
        </div>
      ) : null}

      <label className="review-confirmation">
        <input
          type="checkbox"
          aria-label="I confirm the screening information has been reviewed."
          checked={completionState.reviewConfirmed}
          disabled={reviewLocked}
          onChange={(event) => onReviewConfirmedChange(event.currentTarget.checked)}
        />
        <span>I confirm the screening information has been reviewed.</span>
      </label>

      <div className="screening-encounter-actions">
        <button
          className="button button-secondary"
          type="button"
          disabled={reviewLocked}
          onClick={onBackToOtc}
        >
          Previous
        </button>
        <button
          className="button button-primary"
          type="button"
          disabled={!completionState.reviewConfirmed || reviewLocked}
          onClick={onComplete}
        >
          {saving ? 'Completing...' : completed ? 'Screening complete' : 'Complete screening'}
        </button>
      </div>
    </section>
  )
}

function ReviewCardHeader({
  title,
  disabled,
  onEdit
}: {
  readonly title: string
  readonly disabled: boolean
  onEdit(): void
}): React.JSX.Element {
  return (
    <div className="review-card-header">
      <h4>{title}</h4>
      <button
        className="button button-secondary review-edit-button"
        type="button"
        aria-label={`Edit ${title}`}
        disabled={disabled}
        onClick={onEdit}
      >
        Edit
      </button>
    </div>
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
  if (value.length === 0) return 'Not recorded'
  return value
    .toLocaleLowerCase('en-US')
    .split('_')
    .map((part) => part.charAt(0).toLocaleUpperCase('en-US') + part.slice(1))
    .join(' ')
}

function formatBooleanResponse(value: boolean | null): string {
  return value === null ? 'Not recorded' : value ? 'Yes' : 'No'
}

function formatList(values: readonly string[]): string {
  return values.length === 0 ? 'Not recorded' : values.join(', ')
}

function formatDuration(hours: string, minutes: string, suffix: string): string {
  const parts: string[] = []
  const hoursValue = Number.parseInt(hours, 10)
  const minutesValue = Number.parseInt(minutes, 10)
  if (Number.isFinite(hoursValue) && hoursValue > 0)
    parts.push(`${hoursValue} ${hoursValue === 1 ? 'hour' : 'hours'}`)
  if (Number.isFinite(minutesValue) && minutesValue > 0)
    parts.push(`${minutesValue} ${minutesValue === 1 ? 'minute' : 'minutes'}`)
  return parts.length === 0 ? 'Time not recorded' : `${parts.join(' ')} ${suffix}`
}
