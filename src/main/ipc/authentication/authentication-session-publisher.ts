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
  publish(session: PublicAuthenticationSession): void
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
    publish(session: PublicAuthenticationSession): void {
      if (disposed) {
        return
      }

      const target = getWebContents()

      if (!target || target.isDestroyed()) {
        return
      }

      if (!isNavigationAllowed(target.mainFrame.url, navigationPolicy)) {
        return
      }

      const payloadResult = publicAuthenticationSessionSchema.safeParse(session)

      if (!payloadResult.success) {
        return
      }

      target.send(ipcChannels.auth.sessionChanged, payloadResult.data)
    },
    dispose(): void {
      disposed = true
    }
  })
}
