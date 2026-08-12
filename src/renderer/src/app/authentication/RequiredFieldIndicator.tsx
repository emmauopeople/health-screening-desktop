export function RequiredFieldIndicator(): React.JSX.Element {
  return (
    <>
      <span className="auth-required-indicator" aria-hidden="true">
        *
      </span>
      <span className="visually-hidden"> required</span>
    </>
  )
}
