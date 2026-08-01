import { isNavigationAllowed, type NavigationPolicy } from '@main/app/navigation-policy'
import {
  ipcChannels,
  publicAuthenticationSessionSchema,
  type PublicAuthenticationSession
} from '@shared/ipc'

export interface AuthenticationSessionPublishTarget {
  readonly mainFrame: {
    readonly url: string
  }
  isDestroyed(): boolean
  send(channel: string, payload: unknown): void
}

export interface AuthenticationSessionPublisher {
  publish(session: PublicAuthenticationSession): boolean
  dispose(): void
}

export interface AuthenticationSessionPublisherOptions {
  readonly navigationPolicy: NavigationPolicy
  readonly getWebContents: () => AuthenticationSessionPublishTarget | null | undefined
}

export function createAuthenticationSessionPublisher({
  navigationPolicy,
  getWebContents
}: AuthenticationSessionPublisherOptions): AuthenticationSessionPublisher {
  let disposed = false

  return Object.freeze({
    publish(session: PublicAuthenticationSession): boolean {
      if (disposed) {
        return false
      }

      let target: AuthenticationSessionPublishTarget | null | undefined

      try {
        target = getWebContents()
      } catch {
        return false
      }

      if (!target) {
        return false
      }

      try {
        if (target.isDestroyed()) {
          return false
        }
      } catch {
        return false
      }

      let targetUrl: string

      try {
        targetUrl = target.mainFrame.url
      } catch {
        return false
      }

      try {
        if (!isNavigationAllowed(targetUrl, navigationPolicy)) {
          return false
        }
      } catch {
        return false
      }

      let payloadResult: ReturnType<typeof publicAuthenticationSessionSchema.safeParse>

      try {
        payloadResult = publicAuthenticationSessionSchema.safeParse(session)
      } catch {
        return false
      }

      if (!payloadResult.success) {
        return false
      }

      try {
        target.send(ipcChannels.auth.sessionChanged, payloadResult.data)
      } catch {
        return false
      }

      return true
    },
    dispose(): void {
      disposed = true
    }
  })
}
