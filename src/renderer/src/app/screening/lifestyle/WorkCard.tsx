import type { PublicScreeningEncounterStartSummary } from '@shared/ipc'
import {
  getWorkBaselineForInterpretation,
  physicalDemandOptions,
  shiftPatternOptions,
  validateWorkCompletionReadiness,
  workResponseOptions,
  workStatusLabel,
  workStatusOptions,
  type ActivityFieldError,
  type WorkBaselineForm,
  type WorkWeeklyForm
} from './activity-workspace-model'
import type { LifestyleDraftState } from './lifestyle-workspace-model'

interface WorkCardProps {
  readonly state: LifestyleDraftState
  readonly encounterStatus: PublicScreeningEncounterStartSummary['status']
  readonly readOnly?: boolean
  onUpdateBaseline(update: (form: WorkBaselineForm) => WorkBaselineForm): void
  onUpdateWork(update: (form: WorkWeeklyForm) => WorkWeeklyForm): void
  onToggleBaseline(): void
  onToggleExpanded(): void
  onSaveBaseline(): void
}

export function WorkCard({
  state,
  encounterStatus,
  readOnly = false,
  onUpdateBaseline,
  onUpdateWork,
  onToggleBaseline,
  onToggleExpanded,
  onSaveBaseline
}: WorkCardProps): React.JSX.Element {
  const editable = encounterStatus === 'DRAFT' && !readOnly
  const disabled = !editable || state.saveStatus === 'SAVING'
  const baseline = state.workspace ? getWorkBaselineForInterpretation(state.workspace) : null
  const status = readOnly
    ? 'Complete'
    : !editable
      ? 'Locked'
      : state.workValidationErrors.length > 0
        ? 'Validation error'
        : validateWorkCompletionReadiness(state).length === 0
          ? 'Ready'
          : 'In progress'
  return (
    <section
      className={`lifestyle-card lifestyle-card-status-${status.toLowerCase().replaceAll(' ', '_')}`}
      aria-labelledby="lifestyle-work-title"
    >
      <button
        className="lifestyle-card-header"
        type="button"
        aria-expanded={state.workExpanded}
        aria-controls="lifestyle-work-content"
        disabled={state.saveStatus === 'SAVING'}
        onClick={onToggleExpanded}
      >
        <span>
          <span className="lifestyle-card-kicker">4</span>
          <strong id="lifestyle-work-title">Job type</strong>
        </span>
        <span className="lifestyle-card-status" aria-label={`Job type status: ${status}`}>
          <span aria-hidden="true" className="lifestyle-status-mark" />
          {status}
        </span>
      </button>
      <p className="lifestyle-card-summary">{workSummary(state, baseline)}</p>
      {state.workExpanded ? (
        <div id="lifestyle-work-content" className="lifestyle-card-content">
          <button
            className="button button-secondary lifestyle-inline-button"
            id="lifestyle-work-baseline-button"
            type="button"
            aria-expanded={state.workBaselineOpen}
            aria-controls="lifestyle-work-baseline-panel"
            disabled={state.saveStatus === 'SAVING'}
            onClick={onToggleBaseline}
          >
            Job Type Baseline
          </button>
          {state.workBaselineOpen ? (
            <WorkBaselinePanel
              form={state.workBaselineForm}
              errors={state.workValidationErrors}
              disabled={disabled}
              onUpdate={onUpdateBaseline}
              onCancel={onToggleBaseline}
              onSave={onSaveBaseline}
            />
          ) : null}
          {baseline ? (
            <fieldset className="lifestyle-weekly-panel" id="lifestyle-work-weekly">
              <legend>How did your work compare with usual during the past 7 days?</legend>
              {workResponseOptions.map(([value, label]) => (
                <label className="lifestyle-choice" key={value}>
                  <input
                    id={`work-weekly-${value}`}
                    type="radio"
                    name="work-weekly-response"
                    checked={state.work.weeklyResponse === value}
                    disabled={disabled}
                    onChange={() =>
                      onUpdateWork((current) => ({ ...current, weeklyResponse: value }))
                    }
                  />
                  {label}
                </label>
              ))}
            </fieldset>
          ) : (
            <p className="lifestyle-inline-note">Work baseline required.</p>
          )}
        </div>
      ) : null}
    </section>
  )
}

function WorkBaselinePanel({
  form,
  errors,
  disabled,
  onUpdate,
  onCancel,
  onSave
}: {
  readonly form: WorkBaselineForm
  readonly errors: readonly ActivityFieldError[]
  readonly disabled: boolean
  onUpdate(update: (form: WorkBaselineForm) => WorkBaselineForm): void
  onCancel(): void
  onSave(): void
}): React.JSX.Element {
  const errorFor = (id: string): ActivityFieldError | undefined =>
    errors.find((error) => error.fieldId === id)
  return (
    <section
      id="lifestyle-work-baseline-panel"
      className="lifestyle-inline-panel"
      aria-labelledby="lifestyle-work-baseline-title"
    >
      <h4 id="lifestyle-work-baseline-title">Job Type Baseline</h4>
      <Select
        id="work-baseline-status"
        label="Employment status"
        value={form.status}
        error={errorFor('work-baseline-status')}
        disabled={disabled}
        options={workStatusOptions}
        onChange={(value) =>
          onUpdate((current) => ({ ...current, status: value as WorkBaselineForm['status'] }))
        }
      />
      <Field
        id="work-baseline-title"
        label="Occupation or job title"
        value={form.occupationJobTitle}
        error={errorFor('work-baseline-title')}
        disabled={disabled}
        onChange={(value) => onUpdate((current) => ({ ...current, occupationJobTitle: value }))}
      />
      <Select
        id="work-baseline-demand"
        label="Usual work demand"
        value={form.usualPhysicalDemand}
        error={errorFor('work-baseline-demand')}
        disabled={disabled}
        options={physicalDemandOptions}
        onChange={(value) =>
          onUpdate((current) => ({
            ...current,
            usualPhysicalDemand: value as WorkBaselineForm['usualPhysicalDemand']
          }))
        }
      />
      <div className="lifestyle-form-grid">
        <Field
          id="work-baseline-days"
          label="Typical workdays per week"
          value={form.typicalWorkdaysPerWeek}
          error={errorFor('work-baseline-days')}
          disabled={disabled}
          type="number"
          onChange={(value) =>
            onUpdate((current) => ({ ...current, typicalWorkdaysPerWeek: value }))
          }
        />
        <Field
          id="work-baseline-hours"
          label="Typical hours per workday"
          value={form.typicalHoursPerWorkday}
          error={errorFor('work-baseline-hours')}
          disabled={disabled}
          type="number"
          onChange={(value) =>
            onUpdate((current) => ({ ...current, typicalHoursPerWorkday: value }))
          }
        />
      </div>
      <Select
        id="work-baseline-shift"
        label="Shift pattern"
        value={form.shiftPattern}
        error={errorFor('work-baseline-shift')}
        disabled={disabled}
        options={shiftPatternOptions}
        onChange={(value) =>
          onUpdate((current) => ({
            ...current,
            shiftPattern: value as WorkBaselineForm['shiftPattern']
          }))
        }
      />
      <Field
        id="work-baseline-description"
        label="Description (optional)"
        value={form.description}
        error={errorFor('work-baseline-description')}
        disabled={disabled}
        onChange={(value) => onUpdate((current) => ({ ...current, description: value }))}
      />
      <ErrorList errors={errors} />
      <div className="lifestyle-inline-actions">
        <button className="button button-secondary" type="button" onClick={onCancel}>
          Cancel
        </button>
        <button
          className="button button-primary"
          type="button"
          disabled={disabled}
          onClick={onSave}
        >
          {disabled ? 'Saving...' : 'Save baseline'}
        </button>
      </div>
    </section>
  )
}

function Field({
  id,
  label,
  value,
  error,
  disabled,
  onChange,
  type = 'text'
}: {
  readonly id: string
  readonly label: string
  readonly value: string
  readonly error?: ActivityFieldError
  readonly disabled: boolean
  readonly type?: 'text' | 'number'
  onChange(value: string): void
}): React.JSX.Element {
  const errorId = `error-${id}`
  return (
    <div className="lifestyle-field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type={type}
        value={value}
        disabled={disabled}
        aria-invalid={error !== undefined}
        aria-describedby={error ? errorId : undefined}
        onChange={(event) => onChange(event.target.value)}
      />
      {error ? (
        <p id={errorId} className="field-error">
          {error.message}
        </p>
      ) : null}
    </div>
  )
}
function Select({
  id,
  label,
  value,
  error,
  disabled,
  options,
  onChange
}: {
  readonly id: string
  readonly label: string
  readonly value: string
  readonly error?: ActivityFieldError
  readonly disabled: boolean
  readonly options: ReadonlyArray<readonly [string, string]>
  onChange(value: string): void
}): React.JSX.Element {
  const errorId = `error-${id}`
  return (
    <div className="lifestyle-field">
      <label htmlFor={id}>{label}</label>
      <select
        id={id}
        value={value}
        disabled={disabled}
        aria-invalid={error !== undefined}
        aria-describedby={error ? errorId : undefined}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">Select</option>
        {options.map(([optionValue, labelText]) => (
          <option key={optionValue} value={optionValue}>
            {labelText}
          </option>
        ))}
      </select>
      {error ? (
        <p id={errorId} className="field-error">
          {error.message}
        </p>
      ) : null}
    </div>
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
function workSummary(
  state: LifestyleDraftState,
  baseline: ReturnType<typeof getWorkBaselineForInterpretation>
): string {
  if (!baseline)
    return state.workBaselineOpen ? 'Work baseline draft in progress' : 'Work baseline required'
  return `${workStatusLabel(baseline.status)} • ${state.work.weeklyResponse === '' ? 'Work draft in progress' : state.work.weeklyResponse === 'USUAL' ? 'Usual work' : state.work.weeklyResponse === 'LESS_THAN_USUAL' ? 'Less than usual' : state.work.weeklyResponse === 'MORE_THAN_USUAL' ? 'More than usual' : state.work.weeklyResponse === 'NO_WORK' ? 'No work' : state.work.weeklyResponse === 'UNKNOWN' ? 'Weekly work unknown' : state.work.weeklyResponse === 'DECLINED' ? 'Weekly response declined' : state.work.weeklyResponse === 'NOT_APPLICABLE' ? 'Not applicable' : 'Prefer not to answer'}`
}
