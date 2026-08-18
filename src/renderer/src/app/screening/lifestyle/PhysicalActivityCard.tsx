import type { PublicScreeningEncounterStartSummary } from '@shared/ipc'
import { useEffect, useRef } from 'react'
import {
  activityDomainOptions,
  intensityOptions,
  createEmptyActivityRow,
  isPhysicalActivityComplete,
  physicalActivityResponseOptions,
  physicalActivitySummary,
  sedentaryTimeResponseOptions,
  type ActivityFieldError,
  type ActivityRowForm,
  type PhysicalActivityForm
} from './activity-workspace-model'
import { ActivityField } from './ActivityField'

interface PhysicalActivityCardProps {
  readonly form: PhysicalActivityForm
  readonly errors: readonly ActivityFieldError[]
  readonly expanded: boolean
  readonly encounterStatus: PublicScreeningEncounterStartSummary['status']
  readonly readOnly?: boolean
  readonly saving: boolean
  onUpdate(update: (form: PhysicalActivityForm) => PhysicalActivityForm): void
  onToggleExpanded(): void
}

export function PhysicalActivityCard({
  form,
  errors,
  expanded,
  encounterStatus,
  saving,
  readOnly = false,
  onUpdate,
  onToggleExpanded
}: PhysicalActivityCardProps): React.JSX.Element {
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
        : isPhysicalActivityComplete(form)
          ? 'Ready'
          : 'In progress'
  const errorFor = (fieldId: string): ActivityFieldError | undefined =>
    errors.find((error) => error.fieldId === fieldId)
  return (
    <section
      className={`lifestyle-card lifestyle-card-status-${status.toLowerCase().replaceAll(' ', '_')}`}
      aria-labelledby="lifestyle-physical-title"
    >
      <button
        className="lifestyle-card-header"
        type="button"
        aria-expanded={expanded}
        aria-controls="lifestyle-physical-content"
        disabled={saving}
        onClick={onToggleExpanded}
      >
        <span>
          <span className="lifestyle-card-kicker">3</span>
          <strong id="lifestyle-physical-title">Weekly exercise</strong>
        </span>
        <span className="lifestyle-card-status" aria-label={`Weekly exercise status: ${status}`}>
          <span aria-hidden="true" className="lifestyle-status-mark" />
          {status}
        </span>
      </button>
      <p className="lifestyle-card-summary">{physicalActivitySummary(form)}</p>
      {expanded ? (
        <div id="lifestyle-physical-content" className="lifestyle-card-content">
          <section
            className="lifestyle-weekly-panel"
            aria-labelledby="lifestyle-physical-weekly-title"
          >
            <h4 id="lifestyle-physical-weekly-title">Weekly exercise</h4>
            <fieldset
              id="physical-weekly-response"
              aria-invalid={errorFor('physical-weekly-response') !== undefined}
              aria-describedby={
                errorFor('physical-weekly-response') ? 'error-physical-weekly-response' : undefined
              }
            >
              <legend>Did you do any physical activity during the past 7 days?</legend>
              {physicalActivityResponseOptions.map((option) => (
                <label className="lifestyle-choice" key={option.value}>
                  <input
                    id={`physical-weekly-response-${option.value}`}
                    type="radio"
                    name="physical-weekly-response"
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
            {errorFor('physical-weekly-response') ? (
              <p id="error-physical-weekly-response" className="field-error">
                {errorFor('physical-weekly-response')?.message}
              </p>
            ) : null}
            <fieldset
              id="physical-sedentary-response"
              aria-invalid={errorFor('physical-sedentary-response') !== undefined}
              aria-describedby={
                errorFor('physical-sedentary-response')
                  ? 'error-physical-sedentary-response'
                  : undefined
              }
            >
              <legend>Sedentary time response</legend>
              {sedentaryTimeResponseOptions.map((option) => (
                <label className="lifestyle-choice" key={option.value}>
                  <input
                    id={`physical-sedentary-response-${option.value}`}
                    type="radio"
                    name="physical-sedentary-response"
                    checked={form.sedentaryTimeResponse === option.value}
                    disabled={disabled}
                    onChange={() =>
                      onUpdate((current) =>
                        option.value === 'RECORDED'
                          ? { ...current, sedentaryTimeResponse: option.value }
                          : {
                              ...current,
                              sedentaryTimeResponse: option.value,
                              sedentaryMinutesPerDay: ''
                            }
                      )
                    }
                  />
                  {option.label}
                </label>
              ))}
            </fieldset>
            {errorFor('physical-sedentary-response') ? (
              <p id="error-physical-sedentary-response" className="field-error">
                {errorFor('physical-sedentary-response')?.message}
              </p>
            ) : null}
            {form.sedentaryTimeResponse === 'RECORDED' ? (
              <ActivityField
                id="physical-sedentary-minutes"
                label="Sedentary minutes per day"
                value={form.sedentaryMinutesPerDay}
                error={errorFor('physical-sedentary-minutes')}
                disabled={disabled}
                onChange={(value) =>
                  onUpdate((current) => ({ ...current, sedentaryMinutesPerDay: value }))
                }
              />
            ) : null}
            {form.weeklyResponse === 'YES' ? (
              <>
                {form.activities.map((activity, index) => (
                  <ActivityRow
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
                        ? `physical-activity-${nextActivity.clientKey}-domain`
                        : 'physical-add-activity'
                      onUpdate((current) => ({
                        ...current,
                        activities: current.activities
                          .filter((item) => item.clientKey !== activity.clientKey)
                          .map((item, rowIndex) => ({ ...item, sequenceNumber: rowIndex + 1 }))
                      }))
                    }}
                    onMove={(direction) => {
                      pendingFocusId.current = `physical-activity-${activity.clientKey}-domain`
                      onUpdate((current) => reorderActivities(current, index, direction))
                    }}
                  />
                ))}
                <button
                  id="physical-add-activity"
                  className="button button-secondary lifestyle-activity-add"
                  type="button"
                  disabled={disabled || form.activities.length >= 20}
                  onClick={() => {
                    const newActivity = createEmptyActivityRow(form.activities.length + 1)
                    pendingFocusId.current = `physical-activity-${newActivity.clientKey}-domain`
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
            <ValidationList errors={errors} />
          </section>
        </div>
      ) : null}
    </section>
  )
}

function ActivityRow({
  activity,
  index,
  count,
  errors,
  disabled,
  onUpdate,
  onRemove,
  onMove
}: {
  readonly activity: ActivityRowForm
  readonly index: number
  readonly count: number
  readonly errors: readonly ActivityFieldError[]
  readonly disabled: boolean
  onUpdate(update: (value: ActivityRowForm) => ActivityRowForm): void
  onRemove(): void
  onMove(direction: -1 | 1): void
}): React.JSX.Element {
  const prefix = `physical-activity-${activity.clientKey}`
  const errorFor = (suffix: string): ActivityFieldError | undefined =>
    errors.find((error) => error.fieldId === `${prefix}-${suffix}`)
  return (
    <fieldset className="lifestyle-activity-row">
      <legend>Activity {index + 1}</legend>
      <ActivityField
        id={`${prefix}-domain`}
        label="Type of activity"
        value={activity.activityDomain}
        error={errorFor('domain')}
        disabled={disabled}
        options={activityDomainOptions}
        className="lifestyle-activity-field-domain"
        onChange={(value) =>
          onUpdate((current) => ({
            ...current,
            activityDomain: value as ActivityRowForm['activityDomain']
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
          onUpdate((current) => ({ ...current, intensity: value as ActivityRowForm['intensity'] }))
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
        value={activity.averageHoursPerActiveDay}
        error={errorFor('hours')}
        disabled={disabled}
        type="number"
        min={0}
        max={24}
        className="lifestyle-activity-field-hours"
        onChange={(value) =>
          onUpdate((current) => ({ ...current, averageHoursPerActiveDay: value }))
        }
      />
      <ActivityField
        id={`${prefix}-minutes`}
        label="Minutes"
        value={activity.averageMinutesPerActiveDay}
        error={errorFor('minutes')}
        disabled={disabled}
        type="number"
        min={0}
        max={59}
        className="lifestyle-activity-field-minutes"
        onChange={(value) =>
          onUpdate((current) => ({ ...current, averageMinutesPerActiveDay: value }))
        }
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
function ValidationList({
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
function reorderActivities(
  form: PhysicalActivityForm,
  index: number,
  direction: -1 | 1
): PhysicalActivityForm {
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
