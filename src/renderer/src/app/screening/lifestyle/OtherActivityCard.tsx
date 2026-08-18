import type { PublicScreeningEncounterStartSummary } from '@shared/ipc'
import { useEffect, useRef } from 'react'
import {
  createEmptyOtherActivityRow,
  intensityOptions,
  isOtherActivityComplete,
  otherActivityCategoryOptions,
  otherActivityResponseOptions,
  otherActivitySummary,
  type ActivityFieldError,
  type OtherActivityForm,
  type OtherActivityRowForm
} from './activity-workspace-model'
import { ActivityField } from './ActivityField'

export function OtherActivityCard({
  form,
  errors,
  expanded,
  encounterStatus,
  saving,
  readOnly = false,
  onUpdate,
  onToggleExpanded
}: {
  readonly form: OtherActivityForm
  readonly errors: readonly ActivityFieldError[]
  readonly expanded: boolean
  readonly encounterStatus: PublicScreeningEncounterStartSummary['status']
  readonly readOnly?: boolean
  readonly saving: boolean
  onUpdate(update: (form: OtherActivityForm) => OtherActivityForm): void
  onToggleExpanded(): void
}): React.JSX.Element {
  const pendingFocusId = useRef<string | null>(null)
  useEffect(() => {
    if (pendingFocusId.current === null) return
    document.getElementById(pendingFocusId.current)?.focus()
    pendingFocusId.current = null
  }, [form.activities])
  const editable = encounterStatus === 'DRAFT' && !readOnly
  const disabled = !editable || saving
  const status = readOnly
    ? 'Complete'
    : !editable
      ? 'Locked'
      : errors.length > 0
        ? 'Validation error'
        : isOtherActivityComplete(form)
          ? 'Ready'
          : 'In progress'
  return (
    <section
      className={`lifestyle-card lifestyle-card-status-${status.toLowerCase().replaceAll(' ', '_')}`}
      aria-labelledby="lifestyle-other-title"
    >
      <button
        className="lifestyle-card-header"
        type="button"
        aria-expanded={expanded}
        aria-controls="lifestyle-other-content"
        disabled={saving}
        onClick={onToggleExpanded}
      >
        <span>
          <span className="lifestyle-card-kicker">5</span>
          <strong id="lifestyle-other-title">Other activity</strong>
        </span>
        <span className="lifestyle-card-status" aria-label={`Other activity status: ${status}`}>
          <span aria-hidden="true" className="lifestyle-status-mark" />
          {status}
        </span>
      </button>
      <p className="lifestyle-card-summary">{otherActivitySummary(form)}</p>
      {expanded ? (
        <div id="lifestyle-other-content" className="lifestyle-card-content">
          <section
            className="lifestyle-weekly-panel"
            aria-labelledby="lifestyle-other-weekly-title"
          >
            <h4 id="lifestyle-other-weekly-title">Weekly other activity</h4>
            <fieldset
              id="other-weekly-response"
              aria-invalid={errors.some((error) => error.fieldId === 'other-weekly-response')}
              aria-describedby={
                errors.some((error) => error.fieldId === 'other-weekly-response')
                  ? 'error-other-weekly-response'
                  : undefined
              }
            >
              <legend>Did you do any other activity during the past 7 days?</legend>
              {otherActivityResponseOptions.map((option) => (
                <label className="lifestyle-choice" key={option.value}>
                  <input
                    id={`other-weekly-response-${option.value}`}
                    type="radio"
                    name="other-weekly-response"
                    checked={form.weeklyResponse === option.value}
                    disabled={disabled}
                    onChange={() =>
                      onUpdate((current) =>
                        option.value === 'YES'
                          ? { ...current, weeklyResponse: option.value }
                          : { ...current, weeklyResponse: option.value, activities: [] }
                      )
                    }
                  />
                  {option.label}
                </label>
              ))}
            </fieldset>
            {errors.find((error) => error.fieldId === 'other-weekly-response') ? (
              <p id="error-other-weekly-response" className="field-error">
                {errors.find((error) => error.fieldId === 'other-weekly-response')?.message}
              </p>
            ) : null}
            {form.weeklyResponse === 'YES' ? (
              <>
                {form.activities.map((activity, index) => (
                  <OtherRow
                    key={activity.clientKey}
                    activity={activity}
                    index={index}
                    count={form.activities.length}
                    errors={errors}
                    disabled={disabled}
                    onUpdate={(update) =>
                      onUpdate((current) => ({
                        ...current,
                        activities: current.activities.map((item) =>
                          item.clientKey === activity.clientKey ? update(item) : item
                        )
                      }))
                    }
                    onRemove={() => {
                      const nextActivity = form.activities[index + 1] ?? form.activities[index - 1]
                      pendingFocusId.current = nextActivity
                        ? `other-activity-${nextActivity.clientKey}-category`
                        : 'other-add-activity'
                      onUpdate((current) => ({
                        ...current,
                        activities: current.activities
                          .filter((item) => item.clientKey !== activity.clientKey)
                          .map((item, rowIndex) => ({ ...item, sequenceNumber: rowIndex + 1 }))
                      }))
                    }}
                    onMove={(direction) => {
                      pendingFocusId.current = `other-activity-${activity.clientKey}-category`
                      onUpdate((current) => reorderRows(current, index, direction))
                    }}
                  />
                ))}
                <button
                  id="other-add-activity"
                  className="button button-secondary lifestyle-activity-add"
                  type="button"
                  disabled={disabled || form.activities.length >= 50}
                  onClick={() => {
                    const newActivity = createEmptyOtherActivityRow(form.activities.length + 1)
                    pendingFocusId.current = `other-activity-${newActivity.clientKey}-category`
                    onUpdate((current) => ({
                      ...current,
                      activities: [...current.activities, newActivity]
                    }))
                  }}
                >
                  Add activity
                </button>
              </>
            ) : null}
            <ErrorList errors={errors} />
          </section>
        </div>
      ) : null}
    </section>
  )
}

function OtherRow({
  activity,
  index,
  count,
  errors,
  disabled,
  onUpdate,
  onRemove,
  onMove
}: {
  readonly activity: OtherActivityRowForm
  readonly index: number
  readonly count: number
  readonly errors: readonly ActivityFieldError[]
  readonly disabled: boolean
  onUpdate(update: (value: OtherActivityRowForm) => OtherActivityRowForm): void
  onRemove(): void
  onMove(direction: -1 | 1): void
}): React.JSX.Element {
  const prefix = `other-activity-${activity.clientKey}`
  const errorFor = (suffix: string): ActivityFieldError | undefined =>
    errors.find((error) => error.fieldId === `${prefix}-${suffix}`)
  return (
    <fieldset className="lifestyle-activity-row">
      <legend>Other activity {index + 1}</legend>
      <ActivityField
        id={`${prefix}-category`}
        label="Type of activity"
        value={activity.category}
        error={errorFor('category')}
        disabled={disabled}
        options={otherActivityCategoryOptions.map(([value, label]) => ({ value, label }))}
        className="lifestyle-activity-field-domain"
        onChange={(value) =>
          onUpdate((current) => ({
            ...current,
            category: value as OtherActivityRowForm['category']
          }))
        }
      />
      <ActivityField
        id={`${prefix}-intensity`}
        label="Intensity"
        value={activity.intensity}
        error={errorFor('intensity')}
        disabled={disabled}
        options={intensityOptions}
        className="lifestyle-activity-field-intensity"
        onChange={(value) =>
          onUpdate((current) => ({
            ...current,
            intensity: value as OtherActivityRowForm['intensity']
          }))
        }
      />
      <ActivityField
        id={`${prefix}-description`}
        label="Description (optional)"
        value={activity.description}
        error={errorFor('description')}
        disabled={disabled}
        className="lifestyle-activity-field-description"
        onChange={(value) => onUpdate((current) => ({ ...current, description: value }))}
      />
      <ActivityField
        id={`${prefix}-days`}
        label="Days per week"
        value={activity.daysInPastSevenDays}
        error={errorFor('days')}
        disabled={disabled}
        type="number"
        min={1}
        max={7}
        className="lifestyle-activity-field-days"
        onChange={(value) => onUpdate((current) => ({ ...current, daysInPastSevenDays: value }))}
      />
      <span className="lifestyle-activity-duration-label">Average time per day</span>
      <ActivityField
        id={`${prefix}-hours`}
        label="Hours"
        value={activity.averageHoursPerDay}
        error={errorFor('hours')}
        disabled={disabled}
        type="number"
        min={0}
        max={24}
        className="lifestyle-activity-field-hours"
        onChange={(value) => onUpdate((current) => ({ ...current, averageHoursPerDay: value }))}
      />
      <ActivityField
        id={`${prefix}-minutes`}
        label="Minutes"
        value={activity.averageMinutesPerDay}
        error={errorFor('minutes')}
        disabled={disabled}
        type="number"
        min={0}
        max={59}
        className="lifestyle-activity-field-minutes"
        onChange={(value) => onUpdate((current) => ({ ...current, averageMinutesPerDay: value }))}
      />
      <div className="lifestyle-activity-actions">
        <button
          className="button button-secondary lifestyle-activity-action"
          type="button"
          disabled={disabled}
          onClick={onRemove}
        >
          Remove
        </button>
        <button
          className="button button-secondary lifestyle-activity-action"
          type="button"
          disabled={disabled || index === 0}
          onClick={() => onMove(-1)}
        >
          Move up
        </button>
        <button
          className="button button-secondary lifestyle-activity-action"
          type="button"
          disabled={disabled || index === count - 1}
          onClick={() => onMove(1)}
        >
          Move down
        </button>
      </div>
    </fieldset>
  )
}
function ErrorList({
  errors
}: {
  readonly errors: readonly ActivityFieldError[]
}): React.JSX.Element | null {
  return errors.length === 0 ? null : (
    <div className="lifestyle-validation" role="alert" aria-live="assertive">
      <ul>
        {errors.map((error) => (
          <li key={`${error.fieldId}-${error.message}`}>{error.message}</li>
        ))}
      </ul>
    </div>
  )
}
function reorderRows(form: OtherActivityForm, index: number, direction: -1 | 1): OtherActivityForm {
  const next = index + direction
  if (next < 0 || next >= form.activities.length) return form
  const items = [...form.activities]
  const [item] = items.splice(index, 1)
  if (!item) return form
  items.splice(next, 0, item)
  return {
    ...form,
    activities: items.map((value, rowIndex) => ({ ...value, sequenceNumber: rowIndex + 1 }))
  }
}
