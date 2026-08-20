import { useEffect, useRef, type ReactNode } from 'react'

import type { ScreeningOtcRecentMedication } from '@shared/ipc'

import {
  addOtcRow,
  getOtcControlId,
  getOtcDescribedBy,
  getOtcErrorId,
  getOtcFieldError,
  getOtcResponseControlId,
  moveOtcRow,
  otcCurrentlyTakingOptions,
  otcResponseOptions,
  parseOtcCurrentlyTakingDraft,
  removeOtcRow,
  updateOtcResponse,
  updateOtcRow,
  type OtcDraftRowState,
  type OtcDraftState,
  type OtcResponseDraft
} from './otc-workspace-model'

export interface OtcStepProps {
  readonly state: OtcDraftState
  onBackToFood(): void
  onRetryLoad(): void
  onReload(): void
  onSaveDraft(): void
  onContinue(): void
  onUpdate(update: (state: OtcDraftState) => OtcDraftState): void
}

export function OtcStep({
  state,
  onBackToFood,
  onRetryLoad,
  onReload,
  onSaveDraft,
  onContinue,
  onUpdate
}: OtcStepProps): React.JSX.Element {
  const controlsDisabled = state.loadStatus !== 'READY' || state.saveStatus === 'SAVING'
  const canSave = state.loadStatus === 'READY' && state.saveStatus !== 'SAVING'
  const consumedFocusTokens = useRef<Set<string>>(new Set())
  const responseError = getOtcFieldError(state.validationErrors, 'otc-response')
  const showRows =
    state.otcResponse === 'REPORTED' || (state.otcResponse === '' && state.rows.length > 0)

  useEffect(() => {
    const token = state.validationFocusRequestToken
    if (token === null || consumedFocusTokens.current.has(token)) return
    consumedFocusTokens.current.add(token)
    const firstError = state.validationErrors[0]
    queueMicrotask(() => {
      const target =
        firstError === undefined
          ? null
          : document.getElementById(
              firstError.fieldId === 'otc-response'
                ? getOtcResponseControlId(state.otcResponse)
                : getOtcControlId(firstError.fieldId)
            )
      if (target instanceof HTMLElement) target.focus({ preventScroll: true })
      else document.getElementById('otc-validation-summary')?.focus({ preventScroll: true })
      onUpdate((current) =>
        current.validationFocusRequestToken === token
          ? { ...current, validationFocusRequestToken: null }
          : current
      )
    })
  }, [onUpdate, state.otcResponse, state.validationErrors, state.validationFocusRequestToken])

  return (
    <section className="screening-current-step otc-step" aria-labelledby="screening-otc-step-title">
      <div className="screening-current-step-header">
        <div>
          <h3 id="screening-otc-step-title">OTC</h3>
          <p className="otc-period">
            {state.workspace?.draft === null || state.workspace === null
              ? 'Weekly period will be set when the draft is saved.'
              : `Weekly period: ${state.workspace.draft.periodStart} to ${state.workspace.draft.periodEnd}`}
          </p>
        </div>
        <span>Editable</span>
      </div>

      {state.loadStatus === 'LOADING' || state.loadStatus === 'NOT_LOADED' ? (
        <div
          className="screening-empty-state screening-compact-empty"
          role="status"
          aria-live="polite"
        >
          {state.statusMessage ?? 'Loading OTC.'}
        </div>
      ) : state.loadStatus === 'ERROR' ? (
        <div
          className="screening-empty-state screening-compact-empty"
          role="alert"
          aria-live="assertive"
        >
          <p>{state.statusMessage ?? 'OTC could not be loaded.'}</p>
          <button className="button button-secondary" type="button" onClick={onRetryLoad}>
            Retry
          </button>
        </div>
      ) : (
        <>
          <fieldset
            className="otc-response-panel"
            aria-describedby={responseError ? getOtcErrorId('otc-response') : undefined}
          >
            <legend>Did you take any over-the-counter medication during the past 7 days?</legend>
            <div className="otc-response-grid">
              <label className="otc-choice" htmlFor={getOtcResponseControlId('')}>
                <input
                  id={getOtcResponseControlId('')}
                  type="radio"
                  name="otc-response"
                  value=""
                  checked={state.otcResponse === ''}
                  disabled={controlsDisabled}
                  aria-invalid={responseError !== undefined}
                  onChange={() => onUpdate((current) => updateOtcResponse(current, ''))}
                />
                Not answered
              </label>
              {otcResponseOptions.map((option) => {
                const responseId = getOtcResponseControlId(option.value)
                return (
                  <label className="otc-choice" htmlFor={responseId} key={option.value}>
                    <input
                      id={responseId}
                      type="radio"
                      name="otc-response"
                      value={option.value}
                      checked={state.otcResponse === option.value}
                      disabled={controlsDisabled}
                      aria-invalid={responseError !== undefined}
                      onChange={() =>
                        onUpdate((current) =>
                          updateOtcResponse(current, option.value as OtcResponseDraft)
                        )
                      }
                    />
                    {option.label}
                  </label>
                )
              })}
            </div>
            <p
              id={getOtcErrorId('otc-response')}
              className={`otc-field-error${responseError ? ' otc-field-error-visible' : ''}`}
            >
              {responseError?.message ?? 'No response error.'}
            </p>
          </fieldset>

          {showRows ? (
            <div className="otc-rows-panel">
              <div className="otc-rows-header">
                <h4>Medications</h4>
                {state.otcResponse === 'REPORTED' ? (
                  <button
                    id="otc-add-button"
                    className="button button-secondary otc-add-button"
                    type="button"
                    disabled={controlsDisabled}
                    onClick={() => {
                      onUpdate(addOtcRow)
                      queueMicrotask(() => {
                        const rows =
                          document.querySelectorAll<HTMLInputElement>('.otc-product-name-input')
                        rows.item(rows.length - 1)?.focus()
                      })
                    }}
                  >
                    Add medication
                  </button>
                ) : null}
              </div>
              <div className="otc-row-list" aria-label="OTC medications">
                {state.rows.map((row, index) => (
                  <OtcRow
                    key={row.localKey}
                    row={row}
                    index={index}
                    rowCount={state.rows.length}
                    disabled={controlsDisabled}
                    recentMedications={state.workspace?.recentMedications ?? []}
                    errors={state.validationErrors}
                    onUpdate={(update) =>
                      onUpdate((current) => updateOtcRow(current, row.localKey, update))
                    }
                    onRemove={() => {
                      onUpdate((current) => removeOtcRow(current, row.localKey))
                      queueMicrotask(() => focusNearestOtcRow(index))
                    }}
                    onMove={(direction) => {
                      onUpdate((current) => moveOtcRow(current, row.localKey, direction))
                      queueMicrotask(() =>
                        document
                          .getElementById(getOtcControlId(`${row.localKey}:productName`))
                          ?.focus()
                      )
                    }}
                  />
                ))}
              </div>
            </div>
          ) : null}

          {state.statusMessage !== null && state.saveStatus !== 'ERROR' ? (
            <div className="otc-step-status" role="status" aria-live="polite">
              {state.statusMessage}
            </div>
          ) : null}
          {state.saveStatus === 'ERROR' ? (
            <div
              id="otc-validation-summary"
              className="otc-step-status otc-step-error"
              role="alert"
              aria-live="assertive"
              tabIndex={-1}
            >
              {state.statusMessage ?? 'Check the highlighted OTC fields.'}
              {state.statusMessage?.includes('changed elsewhere') ? (
                <button className="button button-secondary" type="button" onClick={onReload}>
                  Reload
                </button>
              ) : null}
            </div>
          ) : null}
        </>
      )}

      <div className="screening-encounter-actions">
        <button className="button button-secondary" type="button" onClick={onBackToFood}>
          Previous
        </button>
        <div className="otc-action-group">
          <button
            className="button button-secondary"
            type="button"
            disabled={!canSave}
            onClick={onSaveDraft}
          >
            {state.saveStatus === 'SAVING' ? 'Saving draft...' : 'Save draft'}
          </button>
          <button
            className="button button-primary"
            type="button"
            disabled={!canSave}
            onClick={onContinue}
          >
            Continue
          </button>
        </div>
      </div>
    </section>
  )
}

function OtcRow({
  row,
  index,
  rowCount,
  disabled,
  recentMedications,
  errors,
  onUpdate,
  onRemove,
  onMove
}: {
  readonly row: OtcDraftRowState
  readonly index: number
  readonly rowCount: number
  readonly disabled: boolean
  readonly recentMedications: readonly ScreeningOtcRecentMedication[]
  readonly errors: readonly { readonly fieldId: string; readonly message: string }[]
  onUpdate(update: (row: OtcDraftRowState) => OtcDraftRowState): void
  onRemove(): void
  onMove(direction: 'UP' | 'DOWN'): void
}): React.JSX.Element {
  const field = (name: string): string => `${row.localKey}:${name}`
  const nameField = field('productName')
  const reasonField = field('reasonForUse')
  const doseField = field('doseText')
  const frequencyField = field('frequencyText')
  const durationField = field('durationText')
  const sourceField = field('sourceOfMedication')
  const takingField = field('currentlyTakingResponse')
  const suggestions = recentMedications.filter((suggestion) =>
    suggestion.productNameSnapshot
      .toLocaleLowerCase('en-US')
      .includes(row.productName.trim().toLocaleLowerCase('en-US'))
  )

  return (
    <fieldset className="otc-row">
      <legend>Medication {index + 1}</legend>
      <OtcTextField
        className="otc-field-product-name"
        id={nameField}
        label="Medication name"
        value={row.productName}
        disabled={disabled}
        error={getOtcFieldError(errors, nameField)}
        inputClassName="otc-product-name-input"
        onChange={(value) => onUpdate((current) => ({ ...current, productName: value }))}
      >
        {suggestions.length > 0 ? (
          <div className="otc-suggestions" aria-label={`Recent medications for row ${index + 1}`}>
            {suggestions.map((suggestion) => (
              <button
                className="otc-suggestion"
                type="button"
                key={suggestion.productNameSnapshot}
                disabled={disabled}
                onClick={() =>
                  onUpdate((current) => ({
                    ...current,
                    productName: suggestion.productNameSnapshot
                  }))
                }
              >
                {suggestion.productNameSnapshot}
              </button>
            ))}
          </div>
        ) : null}
      </OtcTextField>
      <OtcTextField
        className="otc-field-reason"
        id={reasonField}
        label="Reason for use"
        value={row.reasonForUse}
        disabled={disabled}
        error={getOtcFieldError(errors, reasonField)}
        onChange={(value) => onUpdate((current) => ({ ...current, reasonForUse: value }))}
      />
      <OtcSelectField
        className="otc-field-taking"
        id={takingField}
        label="Currently taking?"
        value={row.currentlyTakingResponse}
        disabled={disabled}
        error={getOtcFieldError(errors, takingField)}
        options={otcCurrentlyTakingOptions}
        onChange={(value) => {
          const parsed = parseOtcCurrentlyTakingDraft(value)
          if (parsed !== null)
            onUpdate((current) => ({ ...current, currentlyTakingResponse: parsed }))
        }}
      />
      <OtcTextField
        className="otc-field-dose"
        id={doseField}
        label="Dose (optional)"
        value={row.doseText}
        disabled={disabled}
        error={getOtcFieldError(errors, doseField)}
        onChange={(value) => onUpdate((current) => ({ ...current, doseText: value }))}
      />
      <OtcTextField
        className="otc-field-frequency"
        id={frequencyField}
        label="Frequency (optional)"
        value={row.frequencyText}
        disabled={disabled}
        error={getOtcFieldError(errors, frequencyField)}
        onChange={(value) => onUpdate((current) => ({ ...current, frequencyText: value }))}
      />
      <OtcTextField
        className="otc-field-duration"
        id={durationField}
        label="Duration (optional)"
        value={row.durationText}
        disabled={disabled}
        error={getOtcFieldError(errors, durationField)}
        onChange={(value) => onUpdate((current) => ({ ...current, durationText: value }))}
      />
      <OtcTextField
        className="otc-field-source"
        id={sourceField}
        label="Source (optional)"
        value={row.sourceOfMedication}
        disabled={disabled}
        error={getOtcFieldError(errors, sourceField)}
        onChange={(value) => onUpdate((current) => ({ ...current, sourceOfMedication: value }))}
      />
      <div className="otc-row-actions">
        <button
          className="button button-secondary"
          type="button"
          onClick={onRemove}
          disabled={disabled}
        >
          Remove
        </button>
        <button
          className="button button-secondary"
          type="button"
          onClick={() => onMove('UP')}
          disabled={disabled || index === 0}
        >
          Move up
        </button>
        <button
          className="button button-secondary"
          type="button"
          onClick={() => onMove('DOWN')}
          disabled={disabled || index === rowCount - 1}
        >
          Move down
        </button>
      </div>
    </fieldset>
  )
}

function OtcTextField({
  className,
  id,
  label,
  value,
  disabled,
  error,
  inputClassName,
  onChange,
  children
}: {
  readonly className: string
  readonly id: string
  readonly label: string
  readonly value: string
  readonly disabled: boolean
  readonly error: { readonly fieldId: string; readonly message: string } | undefined
  readonly inputClassName?: string
  readonly children?: ReactNode
  onChange(value: string): void
}): React.JSX.Element {
  return (
    <div className={`otc-field ${className}`}>
      <label htmlFor={getOtcControlId(id)}>{label}</label>
      <input
        id={getOtcControlId(id)}
        className={inputClassName}
        type="text"
        value={value}
        disabled={disabled}
        aria-label={label}
        aria-invalid={error !== undefined}
        aria-describedby={getOtcDescribedBy(error === undefined ? [] : [error], id)}
        onChange={(event) => onChange(event.currentTarget.value)}
      />
      {children}
      <span
        id={getOtcErrorId(id)}
        className={`otc-field-error${error ? ' otc-field-error-visible' : ''}`}
      >
        {error?.message ?? 'No field error.'}
      </span>
    </div>
  )
}

function OtcSelectField({
  className,
  id,
  label,
  value,
  disabled,
  error,
  options,
  onChange
}: {
  readonly className: string
  readonly id: string
  readonly label: string
  readonly value: string
  readonly disabled: boolean
  readonly error: { readonly fieldId: string; readonly message: string } | undefined
  readonly options: readonly { readonly value: string; readonly label: string }[]
  onChange(value: string): void
}): React.JSX.Element {
  return (
    <div className={`otc-field ${className}`}>
      <label htmlFor={getOtcControlId(id)}>{label}</label>
      <select
        id={getOtcControlId(id)}
        value={value}
        disabled={disabled}
        aria-label={label}
        aria-invalid={error !== undefined}
        aria-describedby={getOtcDescribedBy(error === undefined ? [] : [error], id)}
        onChange={(event) => onChange(event.currentTarget.value)}
      >
        {options.map((option) => (
          <option value={option.value} key={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <span
        id={getOtcErrorId(id)}
        className={`otc-field-error${error ? ' otc-field-error-visible' : ''}`}
      >
        {error?.message ?? 'No field error.'}
      </span>
    </div>
  )
}

function focusNearestOtcRow(index: number): void {
  const rows = document.querySelectorAll<HTMLInputElement>('.otc-product-name-input')
  const target = rows.item(index) ?? rows.item(index - 1)
  if (target !== null) target.focus()
  else document.getElementById('otc-add-button')?.focus()
}
