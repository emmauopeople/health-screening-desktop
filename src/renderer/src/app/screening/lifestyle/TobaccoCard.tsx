import { useEffect, useRef } from 'react'

import type { PublicScreeningEncounterStartSummary } from '@shared/ipc'

import {
  getTobaccoBaselineForInterpretation,
  getTobaccoCardStatus,
  getTobaccoCardSummary,
  createEmptyTobaccoProductForm,
  tobaccoFrequencyOptions,
  tobaccoProductOptions,
  tobaccoUnitOptions,
  tobaccoWeeklyOptions,
  toggleTobaccoBaselineProduct,
  type LifestyleDraftState,
  type TobaccoBaselineForm,
  type TobaccoFieldError,
  type TobaccoProductForm,
  type TobaccoWeeklyForm
} from './lifestyle-workspace-model'

interface TobaccoCardProps {
  readonly state: LifestyleDraftState
  readonly encounterStatus: PublicScreeningEncounterStartSummary['status']
  onUpdateBaseline(update: (form: TobaccoBaselineForm) => TobaccoBaselineForm): void
  onUpdateTobacco(update: (form: TobaccoWeeklyForm) => TobaccoWeeklyForm): void
  onToggleBaseline(): void
  onToggleExpanded(): void
  onSaveBaseline(): void
}

export function TobaccoCard({
  state,
  encounterStatus,
  onUpdateBaseline,
  onUpdateTobacco,
  onToggleBaseline,
  onToggleExpanded,
  onSaveBaseline
}: TobaccoCardProps): React.JSX.Element {
  const editable = encounterStatus === 'DRAFT'
  const controlsDisabled = !editable || state.saveStatus === 'SAVING'
  const status = getTobaccoCardStatus(state, editable)
  const summary = getTobaccoCardSummary(state, editable)
  const baseline = state.workspace ? getTobaccoBaselineForInterpretation(state.workspace) : null
  const hasBaseline = baseline !== null && baseline !== undefined
  const errors = state.tobaccoValidationErrors

  useEffect(() => {
    const error = errors[0]
    if (error === undefined) return
    const focusId = tobaccoErrorFocusId(error.fieldId)
    document.getElementById(focusId)?.focus()
  }, [errors])

  return (
    <section
      className={`lifestyle-card lifestyle-card-status-${status.toLowerCase()}`}
      aria-labelledby="lifestyle-tobacco-title"
    >
      <button
        className="lifestyle-card-header"
        type="button"
        aria-expanded={state.tobaccoExpanded}
        aria-controls="lifestyle-tobacco-content"
        disabled={!editable && !hasBaseline}
        onClick={onToggleExpanded}
      >
        <span>
          <span className="lifestyle-card-kicker">2</span>
          <strong id="lifestyle-tobacco-title">Tobacco and nicotine</strong>
        </span>
        <span
          className="lifestyle-card-status"
          aria-label={`Tobacco status: ${formatStatus(status)}`}
        >
          <span aria-hidden="true" className="lifestyle-status-mark" />
          {formatStatus(status)}
        </span>
      </button>
      <p className="lifestyle-card-summary">{summary}</p>

      {state.tobaccoExpanded ? (
        <div id="lifestyle-tobacco-content" className="lifestyle-card-content">
          <button
            className="button button-secondary lifestyle-inline-button"
            type="button"
            aria-expanded={state.tobaccoBaselineOpen}
            aria-controls="lifestyle-tobacco-baseline-panel"
            disabled={controlsDisabled}
            onClick={onToggleBaseline}
          >
            Tobacco Baseline
          </button>

          {state.tobaccoBaselineOpen ? (
            <TobaccoBaselinePanel
              form={state.tobaccoBaselineForm}
              errors={errors}
              disabled={controlsDisabled}
              onUpdate={onUpdateBaseline}
              onCancel={onToggleBaseline}
              onSave={onSaveBaseline}
            />
          ) : null}

          {hasBaseline ? (
            <TobaccoWeeklyPanel
              form={state.tobacco}
              baselineStatus={baseline?.status}
              errors={errors}
              disabled={controlsDisabled}
              onUpdate={onUpdateTobacco}
            />
          ) : (
            <p className="lifestyle-inline-note">Baseline required.</p>
          )}
        </div>
      ) : null}
    </section>
  )
}

function TobaccoBaselinePanel({
  form,
  errors,
  disabled,
  onUpdate,
  onCancel,
  onSave
}: {
  readonly form: TobaccoBaselineForm
  readonly errors: readonly TobaccoFieldError[]
  readonly disabled: boolean
  onUpdate(update: (form: TobaccoBaselineForm) => TobaccoBaselineForm): void
  onCancel(): void
  onSave(): void
}): React.JSX.Element {
  const errorFor = (fieldId: string): TobaccoFieldError | undefined =>
    errors.find((error) => error.fieldId === fieldId)
  const mapping =
    form.everRegularlyUsed === 'YES' && form.currentUseFrequency === 'NOT_AT_ALL' ? 'FORMER' : null
  const productsApplicable =
    form.everRegularlyUsed === 'YES' || form.everRegularlyUsed === 'UNKNOWN'

  return (
    <section
      id="lifestyle-tobacco-baseline-panel"
      className="lifestyle-inline-panel"
      aria-labelledby="lifestyle-tobacco-baseline-title"
    >
      <h4 id="lifestyle-tobacco-baseline-title">Tobacco Baseline</h4>
      <fieldset
        id="tobacco-baseline-ever-used"
        aria-invalid={errorFor('tobacco-baseline-ever-used') !== undefined}
        aria-describedby={
          errorFor('tobacco-baseline-ever-used') ? errorId('tobacco-baseline-ever-used') : undefined
        }
      >
        <legend>Ever regularly used tobacco or nicotine?</legend>
        {(['YES', 'NO', 'UNKNOWN', 'DECLINED'] as const).map((value) => (
          <label className="lifestyle-choice" key={value}>
            <input
              id={`tobacco-baseline-ever-${value}`}
              type="radio"
              name="tobacco-ever-used"
              checked={form.everRegularlyUsed === value}
              disabled={disabled}
              onChange={() =>
                onUpdate((current) => ({
                  ...current,
                  everRegularlyUsed: value,
                  currentUseFrequency:
                    value === 'NO' || value === 'DECLINED' ? '' : current.currentUseFrequency,
                  formerUseApproximateStopDate: '',
                  productTypes: value === 'NO' || value === 'DECLINED' ? [] : current.productTypes,
                  otherProductDescription:
                    value === 'NO' || value === 'DECLINED' ? '' : current.otherProductDescription
                }))
              }
            />
            {formatResponse(value)}
          </label>
        ))}
      </fieldset>

      {form.everRegularlyUsed === 'YES' || form.everRegularlyUsed === 'UNKNOWN' ? (
        <fieldset
          id="tobacco-baseline-frequency"
          aria-invalid={errorFor('tobacco-baseline-frequency') !== undefined}
          aria-describedby={
            errorFor('tobacco-baseline-frequency')
              ? errorId('tobacco-baseline-frequency')
              : undefined
          }
        >
          <legend>Current use frequency</legend>
          {tobaccoFrequencyOptions.map((option) => (
            <label className="lifestyle-choice" key={option.value}>
              <input
                id={`tobacco-baseline-frequency-${option.value}`}
                type="radio"
                name="tobacco-current-frequency"
                checked={form.currentUseFrequency === option.value}
                disabled={disabled}
                onChange={() =>
                  onUpdate((current) => ({
                    ...current,
                    currentUseFrequency: option.value,
                    formerUseApproximateStopDate:
                      option.value === 'NOT_AT_ALL' ? current.formerUseApproximateStopDate : '',
                    productTypes:
                      option.value === 'NOT_AT_ALL' ? current.productTypes : current.productTypes
                  }))
                }
              />
              {option.label}
            </label>
          ))}
        </fieldset>
      ) : null}

      {mapping === 'FORMER' ? (
        <Field
          id="tobacco-baseline-stop-date"
          label="Approximate stop date (YYYY or YYYY-MM)"
          value={form.formerUseApproximateStopDate}
          error={errorFor('tobacco-baseline-stop-date')}
          disabled={disabled}
          onChange={(value) =>
            onUpdate((current) => ({ ...current, formerUseApproximateStopDate: value }))
          }
        />
      ) : null}

      {productsApplicable ? (
        <fieldset
          id="tobacco-baseline-product-types"
          tabIndex={-1}
          aria-invalid={errorFor('tobacco-baseline-product-types') !== undefined}
          aria-describedby={
            errorFor('tobacco-baseline-product-types')
              ? errorId('tobacco-baseline-product-types')
              : undefined
          }
        >
          <legend>Products used</legend>
          <div className="lifestyle-choice-grid">
            {tobaccoProductOptions.map((option) => (
              <label className="lifestyle-choice" key={option.value}>
                <input
                  id={`tobacco-baseline-product-${option.value}`}
                  type="checkbox"
                  checked={form.productTypes.includes(option.value)}
                  disabled={disabled}
                  onChange={() =>
                    onUpdate((current) => toggleTobaccoBaselineProduct(current, option.value))
                  }
                />
                {option.label}
              </label>
            ))}
          </div>
        </fieldset>
      ) : null}

      {form.productTypes.includes('OTHER') ? (
        <Field
          id="tobacco-baseline-other-product"
          label="Other product"
          value={form.otherProductDescription}
          error={errorFor('tobacco-baseline-other-product')}
          disabled={disabled}
          onChange={(value) =>
            onUpdate((current) => ({ ...current, otherProductDescription: value }))
          }
        />
      ) : null}

      <ValidationList
        errors={errors}
        ids={[
          'tobacco-baseline-ever-used',
          'tobacco-baseline-frequency',
          'tobacco-baseline-product-types'
        ]}
      />
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

function TobaccoWeeklyPanel({
  form,
  baselineStatus,
  errors,
  disabled,
  onUpdate
}: {
  readonly form: TobaccoWeeklyForm
  readonly baselineStatus?: string
  readonly errors: readonly TobaccoFieldError[]
  readonly disabled: boolean
  onUpdate(update: (form: TobaccoWeeklyForm) => TobaccoWeeklyForm): void
}): React.JSX.Element {
  const pendingFocusRef = useRef<string | null>(null)

  useEffect(() => {
    const focusId = pendingFocusRef.current
    if (focusId === null) return
    pendingFocusRef.current = null
    document.getElementById(focusId)?.focus()
  }, [form.products])

  return (
    <section className="lifestyle-weekly-panel" aria-labelledby="lifestyle-tobacco-weekly-title">
      <h4 id="lifestyle-tobacco-weekly-title">Weekly tobacco and nicotine</h4>
      <fieldset
        id="tobacco-weekly-response"
        aria-invalid={errors.some((error) => error.fieldId === 'tobacco-weekly-response')}
        aria-describedby={
          errors.some((error) => error.fieldId === 'tobacco-weekly-response')
            ? errorId('tobacco-weekly-response')
            : undefined
        }
      >
        <legend>
          {baselineStatus === 'UNKNOWN' || baselineStatus === 'DECLINED'
            ? 'Can tobacco or nicotine use be recorded for the past 7 days?'
            : 'Did you use any tobacco or nicotine product during the past 7 days?'}
        </legend>
        {tobaccoWeeklyOptions.map((option) => (
          <label className="lifestyle-choice" key={option.value}>
            <input
              id={`tobacco-weekly-response-${option.value}`}
              type="radio"
              name="tobacco-weekly-response"
              checked={form.weeklyResponse === option.value}
              disabled={disabled}
              onChange={() => onUpdate((current) => updateWeeklyResponse(current, option.value))}
            />
            {option.label}
          </label>
        ))}
      </fieldset>
      {form.weeklyResponse === 'YES' ? (
        <>
          {form.products.map((product, index) => (
            <ProductRow
              key={product.clientKey}
              product={product}
              index={index}
              count={form.products.length}
              errors={errors}
              disabled={disabled}
              onUpdate={(update) =>
                onUpdate((current) => ({
                  ...current,
                  products: current.products.map((item) =>
                    item.clientKey === product.clientKey ? update(item) : item
                  )
                }))
              }
              onRemove={() =>
                onUpdate((current) => {
                  const target = current.products[index + 1] ?? current.products[index - 1]
                  pendingFocusRef.current =
                    target === undefined
                      ? 'tobacco-add-product'
                      : `tobacco-product-${target.clientKey}-type`
                  return {
                    ...current,
                    products: current.products
                      .filter((item) => item.clientKey !== product.clientKey)
                      .map((item, rowIndex) => ({ ...item, sequenceNumber: rowIndex + 1 }))
                  }
                })
              }
              onMove={(direction) =>
                onUpdate((current) => reorderProducts(current, index, direction))
              }
            />
          ))}
          <button
            className="button button-secondary"
            id="tobacco-add-product"
            type="button"
            disabled={disabled || form.products.length >= 20}
            onClick={() =>
              onUpdate((current) => {
                const nextProduct = createProduct(current.products.length + 1)
                pendingFocusRef.current = `tobacco-product-${nextProduct.clientKey}-type`
                return { ...current, products: [...current.products, nextProduct] }
              })
            }
          >
            Add product
          </button>
        </>
      ) : null}
      <ValidationList errors={errors} ids={['tobacco-weekly-response', 'tobacco-products']} />
    </section>
  )
}

function ProductRow({
  product,
  index,
  count,
  errors,
  disabled,
  onUpdate,
  onRemove,
  onMove
}: {
  readonly product: TobaccoProductForm
  readonly index: number
  readonly count: number
  readonly errors: readonly TobaccoFieldError[]
  readonly disabled: boolean
  onUpdate(update: (product: TobaccoProductForm) => TobaccoProductForm): void
  onRemove(): void
  onMove(direction: -1 | 1): void
}): React.JSX.Element {
  const prefix = `tobacco-product-${product.clientKey}`
  const errorFor = (suffix: string): TobaccoFieldError | undefined =>
    errors.find((error) => error.fieldId === `${prefix}-${suffix}`)
  return (
    <fieldset className="lifestyle-product-row" aria-labelledby={`${prefix}-legend`}>
      <legend id={`${prefix}-legend`}>Product {index + 1}</legend>
      <label htmlFor={`${prefix}-type`}>Product type</label>
      <select
        aria-label="Product type"
        id={`${prefix}-type`}
        value={product.productType}
        disabled={disabled}
        aria-invalid={errorFor('type') !== undefined}
        aria-describedby={errorFor('type') ? errorId(`${prefix}-type`) : undefined}
        onChange={(event) =>
          onUpdate((current) => ({
            ...current,
            productType: event.target.value as TobaccoProductForm['productType'],
            otherProductDescription:
              event.target.value === 'OTHER' ? current.otherProductDescription : ''
          }))
        }
      >
        <option value="">Select product</option>
        {tobaccoProductOptions.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {errorFor('type') ? (
        <p id={errorId(`${prefix}-type`)} className="field-error">
          {errorFor('type')?.message}
        </p>
      ) : null}
      <Field
        id={`${prefix}-days`}
        label="Days used during the past 7 days"
        value={product.daysUsed}
        error={errorFor('days')}
        disabled={disabled}
        onChange={(value) => onUpdate((current) => ({ ...current, daysUsed: value }))}
        type="number"
      />
      <Field
        id={`${prefix}-quantity`}
        label="Average quantity per use day"
        value={product.averageQuantityPerUseDay}
        error={errorFor('quantity')}
        disabled={disabled}
        onChange={(value) =>
          onUpdate((current) => ({ ...current, averageQuantityPerUseDay: value }))
        }
        type="number"
      />
      <label htmlFor={`${prefix}-unit`}>Quantity unit</label>
      <select
        aria-label="Quantity unit"
        id={`${prefix}-unit`}
        value={product.unit}
        disabled={disabled}
        aria-invalid={errorFor('unit') !== undefined}
        aria-describedby={errorFor('unit') ? errorId(`${prefix}-unit`) : undefined}
        onChange={(event) =>
          onUpdate((current) => ({
            ...current,
            unit: event.target.value as TobaccoProductForm['unit'],
            otherUnitDescription: event.target.value === 'OTHER' ? current.otherUnitDescription : ''
          }))
        }
      >
        <option value="">Select unit</option>
        {tobaccoUnitOptions.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {errorFor('unit') ? (
        <p id={errorId(`${prefix}-unit`)} className="field-error">
          {errorFor('unit')?.message}
        </p>
      ) : null}
      {product.productType === 'OTHER' ? (
        <Field
          id={`${prefix}-other-product`}
          label="Other product"
          value={product.otherProductDescription}
          error={errorFor('other-product')}
          disabled={disabled}
          onChange={(value) =>
            onUpdate((current) => ({ ...current, otherProductDescription: value }))
          }
        />
      ) : null}
      {product.unit === 'OTHER' ? (
        <Field
          id={`${prefix}-other-unit`}
          label="Other unit"
          value={product.otherUnitDescription}
          error={errorFor('other-unit')}
          disabled={disabled}
          onChange={(value) => onUpdate((current) => ({ ...current, otherUnitDescription: value }))}
        />
      ) : null}
      <div className="lifestyle-inline-actions">
        <button
          className="button button-secondary"
          type="button"
          disabled={disabled}
          onClick={onRemove}
        >
          Remove
        </button>
        <button
          className="button button-secondary"
          type="button"
          disabled={disabled || index === 0}
          onClick={() => onMove(-1)}
        >
          Move up
        </button>
        <button
          className="button button-secondary"
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
  readonly error?: TobaccoFieldError
  readonly disabled: boolean
  readonly type?: 'text' | 'number'
  onChange(value: string): void
}): React.JSX.Element {
  const errorIdValue = error ? errorId(id) : undefined
  return (
    <div className="lifestyle-field">
      <label htmlFor={id}>{label}</label>
      <input
        aria-label={label}
        id={id}
        type={type}
        value={value}
        disabled={disabled}
        aria-invalid={error !== undefined}
        aria-describedby={errorIdValue}
        onChange={(event) => onChange(event.target.value)}
      />
      {error ? (
        <p id={errorIdValue} className="field-error">
          {error.message}
        </p>
      ) : null}
    </div>
  )
}

function ValidationList({
  errors,
  ids
}: {
  readonly errors: readonly TobaccoFieldError[]
  readonly ids: readonly string[]
}): React.JSX.Element | null {
  const visible = errors.filter((error) => ids.includes(error.fieldId))
  return visible.length === 0 ? null : (
    <div className="lifestyle-validation" role="alert" aria-live="assertive">
      {visible.map((error) => (
        <p id={errorId(error.fieldId)} key={`${error.fieldId}-${error.message}`}>
          {error.message}
        </p>
      ))}
    </div>
  )
}

function updateWeeklyResponse(
  form: TobaccoWeeklyForm,
  response: TobaccoWeeklyForm['weeklyResponse']
): TobaccoWeeklyForm {
  return response === 'YES' || response === ''
    ? { ...form, weeklyResponse: response }
    : { ...form, weeklyResponse: response, products: [] }
}

function createProduct(sequenceNumber: number): TobaccoProductForm {
  return createEmptyTobaccoProductForm(sequenceNumber)
}

function reorderProducts(
  form: TobaccoWeeklyForm,
  index: number,
  direction: -1 | 1
): TobaccoWeeklyForm {
  const nextIndex = index + direction
  if (nextIndex < 0 || nextIndex >= form.products.length) return form
  const products = [...form.products]
  const [item] = products.splice(index, 1)
  if (item === undefined) return form
  products.splice(nextIndex, 0, item)
  return {
    ...form,
    products: products.map((product, rowIndex) => ({ ...product, sequenceNumber: rowIndex + 1 }))
  }
}

function errorId(fieldId: string): string {
  return `${fieldId}-error`
}

function tobaccoErrorFocusId(fieldId: string): string {
  const focusTargets: Record<string, string> = {
    'tobacco-baseline-ever-used': 'tobacco-baseline-ever-YES',
    'tobacco-baseline-frequency': 'tobacco-baseline-frequency-EVERY_DAY',
    'tobacco-baseline-product-types': 'tobacco-baseline-product-CIGARETTE',
    'tobacco-baseline-stop-date': 'tobacco-baseline-stop-date',
    'tobacco-baseline-other-product': 'tobacco-baseline-other-product',
    'tobacco-weekly-response': 'tobacco-weekly-response-YES',
    'tobacco-products': 'tobacco-add-product'
  }
  return focusTargets[fieldId] ?? fieldId
}
function formatResponse(value: string): string {
  return value === 'YES'
    ? 'Yes'
    : value === 'NO'
      ? 'No'
      : value === 'UNKNOWN'
        ? 'Unknown'
        : 'Declined'
}
function formatStatus(status: string): string {
  return status === 'BASELINE_REVIEW'
    ? 'Baseline review required'
    : status === 'COMPLETE'
      ? 'Complete'
      : status === 'IN_PROGRESS'
        ? 'In progress'
        : status === 'LOCKED'
          ? 'Locked'
          : status === 'VALIDATION_ERROR'
            ? 'Validation error'
            : 'Not started'
}
