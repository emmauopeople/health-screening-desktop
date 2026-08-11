import { useEffect, useRef, type ReactNode } from 'react'

interface AuthenticationLayoutProps {
  readonly headingId: string
  readonly heading: string
  readonly statement?: string
  readonly showEyebrow?: boolean
  readonly className?: string
  readonly children?: ReactNode
  readonly busy?: boolean
  readonly shell?: boolean
}

export function AuthenticationLayout({
  headingId,
  heading,
  statement,
  showEyebrow = true,
  className,
  children,
  busy = false,
  shell = false
}: AuthenticationLayoutProps): React.JSX.Element {
  const headingRef = useRef<HTMLHeadingElement | null>(null)
  const layoutClassName = shell ? 'auth-workspace' : 'foundation-panel auth-panel'
  const panelClassName =
    className === undefined ? layoutClassName : `${layoutClassName} ${className}`

  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true })
  }, [heading])

  return (
    <section className={panelClassName} aria-labelledby={headingId} aria-busy={busy}>
      {showEyebrow ? <div className="foundation-eyebrow">Local authentication</div> : null}
      <h1 ref={headingRef} id={headingId} tabIndex={-1}>
        {heading}
      </h1>
      {statement ? <p className="foundation-statement">{statement}</p> : null}
      {children}
    </section>
  )
}
