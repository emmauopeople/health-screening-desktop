import type { PublicAuthenticatedUser } from '@shared/ipc'

import { authenticationRouteCopy } from './authentication-route-controller'
import type { RendererAuthenticationRoute } from './authentication-route-types'

interface AuthenticationRoutePlaceholderProps {
  route: RendererAuthenticationRoute
}

export function AuthenticationRoutePlaceholder({
  route
}: AuthenticationRoutePlaceholderProps): React.JSX.Element {
  if (route.status === 'AUTH_LOADING') {
    return (
      <section className="foundation-panel auth-panel" aria-live="polite" aria-busy="true">
        <div className="foundation-eyebrow">Local authentication</div>
        <h1>{authenticationRouteCopy.unavailableHeading}</h1>
        <p className="foundation-statement">{authenticationRouteCopy.loading}</p>
      </section>
    )
  }

  if (route.status === 'AUTH_UNAVAILABLE') {
    return (
      <section className="foundation-panel auth-panel" aria-labelledby="auth-unavailable-heading">
        <div className="foundation-eyebrow">Local authentication</div>
        <h1 id="auth-unavailable-heading">{authenticationRouteCopy.unavailableHeading}</h1>
        <p className="foundation-statement">{route.message}</p>
      </section>
    )
  }

  const userSummary = 'user' in route ? createSafeUserSummary(route.user) : null
  const heading = getHeading(route)
  const statement = getStatement(route)

  return (
    <section className="foundation-panel auth-panel" aria-labelledby="auth-route-heading">
      <div className="foundation-eyebrow">Local authentication</div>
      <h1 id="auth-route-heading">{heading}</h1>
      <p className="foundation-statement">{statement}</p>
      {userSummary ? (
        <dl className="auth-identity-list" aria-label="Public session identity">
          <div>
            <dt>User</dt>
            <dd>{userSummary.displayName}</dd>
          </div>
          <div>
            <dt>Username</dt>
            <dd>{userSummary.username}</dd>
          </div>
          <div>
            <dt>Role</dt>
            <dd>{userSummary.role}</dd>
          </div>
        </dl>
      ) : null}
    </section>
  )
}

function getHeading(route: RendererAuthenticationRoute): string {
  switch (route.status) {
    case 'LOGIN_REQUIRED':
      return authenticationRouteCopy.loginRequiredHeading
    case 'PASSWORD_CHANGE_REQUIRED':
      return authenticationRouteCopy.passwordChangeHeading
    case 'SESSION_ACTIVE':
      return authenticationRouteCopy.activeHeading
    case 'SESSION_LOCKED':
      return authenticationRouteCopy.lockedHeading
    case 'AUTH_LOADING':
    case 'AUTH_UNAVAILABLE':
      return authenticationRouteCopy.unavailableHeading
  }
}

function getStatement(route: RendererAuthenticationRoute): string {
  switch (route.status) {
    case 'LOGIN_REQUIRED':
      return authenticationRouteCopy.loginRequiredStatement
    case 'PASSWORD_CHANGE_REQUIRED':
      return authenticationRouteCopy.passwordChangeStatement
    case 'SESSION_ACTIVE':
      return authenticationRouteCopy.activeStatement
    case 'SESSION_LOCKED':
      return authenticationRouteCopy.lockedStatement
    case 'AUTH_LOADING':
      return authenticationRouteCopy.loading
    case 'AUTH_UNAVAILABLE':
      return route.message
  }
}

function createSafeUserSummary(user: PublicAuthenticatedUser): {
  readonly username: string
  readonly displayName: string
  readonly role: string
} {
  return {
    username: user.username,
    displayName: user.displayName,
    role: user.role
  }
}
