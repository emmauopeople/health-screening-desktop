import type { ActivityFieldError } from './activity-workspace-model'

interface ActivityFieldProps {
  readonly id: string
  readonly label: string
  readonly value: string
  readonly error?: ActivityFieldError
  readonly disabled: boolean
  readonly type?: 'text' | 'number'
  readonly min?: number
  readonly max?: number
  readonly className?: string
  readonly options?: readonly { readonly value: string; readonly label: string }[]
  onChange(value: string): void
}

export function ActivityField({
  id,
  label,
  value,
  error,
  disabled,
  onChange,
  type = 'text',
  min,
  max,
  className = '',
  options
}: ActivityFieldProps): React.JSX.Element {
  const errorId = `error-${id}`
  return (
    <div className={`lifestyle-field lifestyle-activity-field ${className}`.trim()}>
      <label htmlFor={id}>{label}</label>
      {options ? (
        <select
          id={id}
          value={value}
          disabled={disabled}
          aria-invalid={error !== undefined}
          aria-describedby={error ? errorId : undefined}
          onChange={(event) => onChange(event.target.value)}
        >
          <option value="">Select</option>
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      ) : (
        <input
          id={id}
          type={type}
          value={value}
          disabled={disabled}
          min={min}
          max={max}
          aria-invalid={error !== undefined}
          aria-describedby={error ? errorId : undefined}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
      <p
        id={errorId}
        className={`lifestyle-field-error${error ? ' lifestyle-field-error-visible' : ''}`}
        aria-hidden={error === undefined}
      >
        {error?.message ?? ''}
      </p>
    </div>
  )
}
