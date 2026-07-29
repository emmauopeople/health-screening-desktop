import { isNavigationAllowed, type NavigationPolicy } from '@main/app/navigation-policy'

export interface IpcSenderFrame {
  readonly url: string
}

export interface IpcSenderValidationEvent {
  readonly sender: {
    readonly mainFrame: unknown
  }
  readonly senderFrame: IpcSenderFrame | null
}

export function isIpcSenderAllowed(
  event: IpcSenderValidationEvent,
  navigationPolicy: NavigationPolicy
): boolean {
  if (!event.senderFrame) {
    return false
  }

  if (event.senderFrame !== event.sender.mainFrame) {
    return false
  }

  return isNavigationAllowed(event.senderFrame.url, navigationPolicy)
}
