import { useEffect, useRef, type ReactNode } from 'react'

interface AuthenticationLayoutProps {
  readonly headingId: string
  readonly heading: string
  readonly statement?: string
  readonly children?: ReactNode
  readonly busy?: boolean
  readonly shell?: boolean
}

export function AuthenticationLayout({
  headingId,
  heading,
  statement,
  children,
  busy = false,
  shell = false
}: AuthenticationLayoutProps): React.JSX.Element {
  const headingRef = useRef<HTMLHeadingElement | null>(null)

  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true })
  }, [heading])

  return (
    <section
      className={shell ? 'auth-workspace' : 'foundation-panel auth-panel'}
      aria-labelledby={headingId}
      aria-busy={busy}
    >
      <div className="foundation-eyebrow">Local authentication</div>
      <h1 ref={headingRef} id={headingId} tabIndex={-1}>
        {heading}
      </h1>
      {statement ? <p className="foundation-statement">{statement}</p> : null}
      {children}
    </section>
  )
}
