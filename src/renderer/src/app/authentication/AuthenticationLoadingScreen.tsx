import { authenticationRouteCopy } from './authentication-route-controller'
import { AuthenticationLayout } from './AuthenticationLayout'

export function AuthenticationLoadingScreen(): React.JSX.Element {
  return (
    <AuthenticationLayout
      headingId="auth-loading-heading"
      heading={authenticationRouteCopy.loadingHeading}
      statement={authenticationRouteCopy.loading}
      busy
    />
  )
}
