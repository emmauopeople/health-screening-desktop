import type { PrimaryApplicationMenu } from './application-shell-types'

export type ApplicationShellFocusZone = 'TOP_BAR' | 'COMMAND_PANEL' | 'PATIENT_TABS' | 'WORKSPACE'

export type PrimaryMenuKeyResult =
  | { readonly kind: 'NONE' }
  | { readonly kind: 'MOVE'; readonly nextIndex: number }
  | { readonly kind: 'TOGGLE' }
  | { readonly kind: 'CLOSE_COMMAND_PANEL' }

export interface ApplicationShellKeyboardEventTarget {
  addEventListener(type: string, listener: EventListener): void
  removeEventListener(type: string, listener: EventListener): void
}

export interface ApplicationShellDocumentTarget {
  readonly activeElement: unknown
}

export interface ApplicationShellFocusable {
  focus(options?: { readonly preventScroll?: boolean }): void
  contains?(candidate: unknown): boolean
}

export interface ApplicationShellFocusZoneDefinition {
  readonly id: ApplicationShellFocusZone
  getContainer(): ApplicationShellFocusable | null
  getFocusTarget(): ApplicationShellFocusable | null
}

export interface ApplicationShellFocusCycler {
  dispose(): void
}

export interface ApplicationShellFocusCyclerOptions {
  readonly keyboardTarget?: ApplicationShellKeyboardEventTarget | null
  readonly documentTarget?: ApplicationShellDocumentTarget | null
  getZones(): readonly ApplicationShellFocusZoneDefinition[]
}

const noPrimaryMenuKeyResult: PrimaryMenuKeyResult = Object.freeze({ kind: 'NONE' })

export function resolvePrimaryMenuKey(
  key: string,
  currentIndex: number,
  itemCount: number
): PrimaryMenuKeyResult {
  if (itemCount <= 0) {
    return noPrimaryMenuKeyResult
  }

  switch (key) {
    case 'ArrowLeft':
      return { kind: 'MOVE', nextIndex: wrapIndex(currentIndex - 1, itemCount) }
    case 'ArrowRight':
      return { kind: 'MOVE', nextIndex: wrapIndex(currentIndex + 1, itemCount) }
    case 'Home':
      return { kind: 'MOVE', nextIndex: 0 }
    case 'End':
      return { kind: 'MOVE', nextIndex: itemCount - 1 }
    case 'Enter':
    case ' ':
    case 'Spacebar':
      return { kind: 'TOGGLE' }
    case 'Escape':
      return { kind: 'CLOSE_COMMAND_PANEL' }
    default:
      return noPrimaryMenuKeyResult
  }
}

export function getNextFocusZoneIndex(
  currentIndex: number,
  zoneCount: number,
  reverse: boolean
): number {
  if (zoneCount <= 0) {
    return -1
  }

  if (currentIndex < 0) {
    return reverse ? zoneCount - 1 : 0
  }

  return wrapIndex(currentIndex + (reverse ? -1 : 1), zoneCount)
}

export function getMenuFromIndex(
  menus: readonly PrimaryApplicationMenu[],
  index: number
): PrimaryApplicationMenu | null {
  return menus[index] ?? null
}

export function createApplicationShellFocusCycler({
  keyboardTarget = getDefaultKeyboardTarget(),
  documentTarget = getDefaultDocumentTarget(),
  getZones
}: ApplicationShellFocusCyclerOptions): ApplicationShellFocusCycler {
  let disposed = false

  const listener: EventListener = (event) => {
    const keyboardEvent = event as KeyboardEvent

    if (keyboardEvent.key !== 'F6' || disposed) {
      return
    }

    keyboardEvent.preventDefault()
    cycleFocus(Boolean(keyboardEvent.shiftKey))
  }

  keyboardTarget?.addEventListener('keydown', listener)

  function cycleFocus(reverse: boolean): void {
    const zones = getZones().filter(
      (zone) => zone.getContainer() !== null && zone.getFocusTarget() !== null
    )

    if (zones.length === 0) {
      return
    }

    const activeElement = documentTarget?.activeElement ?? null
    const currentIndex = zones.findIndex((zone) => {
      const element = zone.getContainer()

      return element !== null && focusableContains(element, activeElement)
    })
    const nextIndex = getNextFocusZoneIndex(currentIndex, zones.length, reverse)
    const nextZone = zones[nextIndex]

    nextZone?.getFocusTarget()?.focus({ preventScroll: true })
  }

  return Object.freeze({
    dispose(): void {
      disposed = true
      keyboardTarget?.removeEventListener('keydown', listener)
    }
  })
}

function wrapIndex(index: number, count: number): number {
  return ((index % count) + count) % count
}

function focusableContains(element: ApplicationShellFocusable, activeElement: unknown): boolean {
  return (
    element === activeElement ||
    (typeof element.contains === 'function' && activeElement !== null
      ? element.contains(activeElement)
      : false)
  )
}

function getDefaultKeyboardTarget(): ApplicationShellKeyboardEventTarget | null {
  return typeof window === 'undefined' ? null : window
}

function getDefaultDocumentTarget(): ApplicationShellDocumentTarget | null {
  return typeof document === 'undefined' ? null : document
}
