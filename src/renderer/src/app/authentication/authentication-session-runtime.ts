import type { HealthScreeningApi } from '@shared/ipc'

import type { RendererAuthenticationRouteController } from './authentication-route-controller'
import type { RendererAuthenticationRoute } from './authentication-route-types'
import { shouldReconcileAfterAuthenticationFailure } from './authentication-message-mapping'

export const authenticationActivityEventTypes = [
  'pointerdown',
  'keydown',
  'touchstart',
  'wheel'
] as const

const defaultActivityThrottleMs = 60_000

type TimeoutHandle = ReturnType<typeof setTimeout>
type TimeoutScheduler = (callback: () => void, delayMs: number) => TimeoutHandle
type TimeoutCanceler = (handle: TimeoutHandle) => void

export interface AuthenticationEventTarget {
  addEventListener(type: string, listener: EventListener, options?: AddEventListenerOptions): void
  removeEventListener(type: string, listener: EventListener): void
}

export interface AuthenticationVisibilityTarget extends AuthenticationEventTarget {
  readonly visibilityState?: string
}

export interface AuthenticationActivityReporter {
  dispose(): void
}

export interface AuthenticationActivityReporterOptions {
  readonly api: HealthScreeningApi
  readonly controller: RendererAuthenticationRouteController
  readonly eventTarget?: AuthenticationEventTarget | null
  readonly now?: () => number
  readonly setTimeout?: TimeoutScheduler
  readonly clearTimeout?: TimeoutCanceler
  readonly throttleMs?: number
}

export function createAuthenticationActivityReporter({
  api,
  controller,
  eventTarget = getDefaultWindowTarget(),
  now = Date.now,
  setTimeout: scheduleTimeout = globalThis.setTimeout,
  clearTimeout: cancelTimeout = globalThis.clearTimeout,
  throttleMs = defaultActivityThrottleMs
}: AuthenticationActivityReporterOptions): AuthenticationActivityReporter {
  let disposed = false
  let inFlight = false
  let pendingTrailingActivity = false
  let lastAttemptAt: number | undefined
  let timer: TimeoutHandle | undefined

  const listener: EventListener = () => {
    handleActivity()
  }

  if (eventTarget !== null) {
    for (const eventType of authenticationActivityEventTypes) {
      eventTarget.addEventListener(eventType, listener, { passive: true })
    }
  }

  function handleActivity(): void {
    if (disposed) {
      return
    }

    if (inFlight || !canSendImmediately()) {
      pendingTrailingActivity = true
      scheduleTrailingSend()
      return
    }

    void sendActivity()
  }

  function canSendImmediately(): boolean {
    return lastAttemptAt === undefined || now() - lastAttemptAt >= throttleMs
  }

  function scheduleTrailingSend(): void {
    if (timer !== undefined) {
      return
    }

    timer = scheduleTimeout(runTrailingSend, getRemainingThrottleMs())
  }

  function getRemainingThrottleMs(): number {
    if (lastAttemptAt === undefined) {
      return 0
    }

    return Math.max(throttleMs - (now() - lastAttemptAt), 0)
  }

  function runTrailingSend(): void {
    timer = undefined

    if (disposed || !pendingTrailingActivity) {
      return
    }

    if (inFlight || !canSendImmediately()) {
      scheduleTrailingSend()
      return
    }

    pendingTrailingActivity = false
    void sendActivity()
  }

  async function sendActivity(): Promise<void> {
    if (disposed || inFlight) {
      return
    }

    inFlight = true
    lastAttemptAt = now()

    try {
      const result = await api.auth.recordActivity()

      if (disposed) {
        return
      }

      if (result.ok) {
        controller.acceptSession(result.data)
        return
      }

      if (shouldReconcileAfterAuthenticationFailure(result.error.code)) {
        await settleReconcile(controller)
      }
    } catch {
      return
    } finally {
      inFlight = false

      if (!disposed && pendingTrailingActivity) {
        scheduleTrailingSend()
      }
    }
  }

  return Object.freeze({
    dispose() {
      disposed = true

      if (timer !== undefined) {
        cancelTimeout(timer)
        timer = undefined
      }

      if (eventTarget !== null) {
        for (const eventType of authenticationActivityEventTypes) {
          eventTarget.removeEventListener(eventType, listener)
        }
      }
    }
  })
}

export interface AuthenticationDeadlineReconciler {
  dispose(): void
}

export interface AuthenticationDeadlineReconcilerOptions {
  readonly route: RendererAuthenticationRoute
  readonly controller: RendererAuthenticationRouteController
  readonly windowTarget?: AuthenticationEventTarget | null
  readonly documentTarget?: AuthenticationVisibilityTarget | null
  readonly now?: () => number
  readonly setTimeout?: TimeoutScheduler
  readonly clearTimeout?: TimeoutCanceler
}

export function createAuthenticationDeadlineReconciler({
  route,
  controller,
  windowTarget = getDefaultWindowTarget(),
  documentTarget = getDefaultDocumentTarget(),
  now = Date.now,
  setTimeout: scheduleTimeout = globalThis.setTimeout,
  clearTimeout: cancelTimeout = globalThis.clearTimeout
}: AuthenticationDeadlineReconcilerOptions): AuthenticationDeadlineReconciler {
  let disposed = false
  let timer: TimeoutHandle | undefined
  const deadline = getAuthenticationRouteDeadlineMs(route)

  const reconcile = (): void => {
    if (!disposed) {
      void settleReconcile(controller)
    }
  }

  const visibilityListener: EventListener = () => {
    if (documentTarget?.visibilityState === 'visible') {
      reconcile()
    }
  }

  windowTarget?.addEventListener('focus', reconcile)
  documentTarget?.addEventListener('visibilitychange', visibilityListener)

  if (deadline !== null) {
    timer = scheduleTimeout(reconcile, Math.max(deadline - now(), 0))
  }

  return Object.freeze({
    dispose() {
      disposed = true

      if (timer !== undefined) {
        cancelTimeout(timer)
        timer = undefined
      }

      windowTarget?.removeEventListener('focus', reconcile)
      documentTarget?.removeEventListener('visibilitychange', visibilityListener)
    }
  })
}

export function getAuthenticationRouteDeadlineMs(
  route: RendererAuthenticationRoute
): number | null {
  switch (route.status) {
    case 'PASSWORD_CHANGE_REQUIRED':
      return parseDeadline(route.expiresAt)
    case 'SESSION_ACTIVE':
      return earliestDeadline(route.idleExpiresAt, route.absoluteExpiresAt)
    case 'SESSION_LOCKED':
      return parseDeadline(route.absoluteExpiresAt)
    case 'AUTH_LOADING':
    case 'AUTH_UNAVAILABLE':
    case 'LOGIN_REQUIRED':
      return null
  }
}

async function settleReconcile(controller: RendererAuthenticationRouteController): Promise<void> {
  try {
    await controller.reconcile()
  } catch {
    return
  }
}

function earliestDeadline(first: string, second: string): number | null {
  const firstDeadline = parseDeadline(first)
  const secondDeadline = parseDeadline(second)

  if (firstDeadline === null) {
    return secondDeadline
  }

  if (secondDeadline === null) {
    return firstDeadline
  }

  return Math.min(firstDeadline, secondDeadline)
}

function parseDeadline(timestamp: string): number | null {
  const deadline = Date.parse(timestamp)

  return Number.isFinite(deadline) ? deadline : null
}

function getDefaultWindowTarget(): AuthenticationEventTarget | null {
  return typeof window === 'undefined' ? null : window
}

function getDefaultDocumentTarget(): AuthenticationVisibilityTarget | null {
  return typeof document === 'undefined' ? null : document
}
