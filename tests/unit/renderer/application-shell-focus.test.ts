import { describe, expect, it } from 'vitest'

import {
  createApplicationShellFocusCycler,
  getMenuFromIndex,
  getNextFocusZoneIndex,
  resolvePrimaryMenuKey,
  type ApplicationShellFocusZoneDefinition,
  type ApplicationShellKeyboardEventTarget
} from '../../../src/renderer/src/app/shell/application-shell-focus'
import type { PrimaryApplicationMenu } from '../../../src/renderer/src/app/shell/application-shell-types'

describe('application shell focus helpers', () => {
  it('resolves primary menu keyboard commands deterministically', () => {
    expect(resolvePrimaryMenuKey('ArrowRight', 1, 4)).toEqual({ kind: 'MOVE', nextIndex: 2 })
    expect(resolvePrimaryMenuKey('ArrowLeft', 0, 4)).toEqual({ kind: 'MOVE', nextIndex: 3 })
    expect(resolvePrimaryMenuKey('Home', 2, 4)).toEqual({ kind: 'MOVE', nextIndex: 0 })
    expect(resolvePrimaryMenuKey('End', 1, 4)).toEqual({ kind: 'MOVE', nextIndex: 3 })
    expect(resolvePrimaryMenuKey('Enter', 1, 4)).toEqual({ kind: 'TOGGLE' })
    expect(resolvePrimaryMenuKey(' ', 1, 4)).toEqual({ kind: 'TOGGLE' })
    expect(resolvePrimaryMenuKey('Escape', 1, 4)).toEqual({ kind: 'CLOSE_COMMAND_PANEL' })
    expect(resolvePrimaryMenuKey('A', 1, 4)).toEqual({ kind: 'NONE' })
  })

  it('returns visible menus by roving index', () => {
    const menus: readonly PrimaryApplicationMenu[] = ['HOME', 'PATIENTS', 'SCREENING']

    expect(getMenuFromIndex(menus, 1)).toBe('PATIENTS')
    expect(getMenuFromIndex(menus, 3)).toBeNull()
  })

  it('cycles F6 through available focus zones and removes listeners on dispose', () => {
    const keyboardTarget = new FakeKeyboardTarget()
    const topBar = new FakeFocusable()
    const commandPanel = new FakeFocusable()
    const workspace = new FakeFocusable()
    const documentTarget = { activeElement: topBar as unknown }
    const zones: readonly ApplicationShellFocusZoneDefinition[] = [
      { id: 'TOP_BAR', getElement: () => topBar },
      { id: 'COMMAND_PANEL', getElement: () => commandPanel },
      { id: 'PATIENT_TABS', getElement: () => null },
      { id: 'WORKSPACE', getElement: () => workspace }
    ]
    const cycler = createApplicationShellFocusCycler({
      keyboardTarget,
      documentTarget,
      getZones: () => zones
    })

    keyboardTarget.dispatch('F6')
    expect(commandPanel.focusCount).toBe(1)
    documentTarget.activeElement = commandPanel

    keyboardTarget.dispatch('F6')
    expect(workspace.focusCount).toBe(1)
    documentTarget.activeElement = workspace

    keyboardTarget.dispatch('F6', true)
    expect(commandPanel.focusCount).toBe(2)

    expect(getNextFocusZoneIndex(-1, 3, false)).toBe(0)
    expect(getNextFocusZoneIndex(0, 3, true)).toBe(2)

    cycler.dispose()
    keyboardTarget.dispatch('F6')

    expect(keyboardTarget.removedTypes).toEqual(['keydown'])
    expect(workspace.focusCount).toBe(1)
  })
})

class FakeFocusable {
  focusCount = 0

  focus(): void {
    this.focusCount += 1
  }

  contains(candidate: unknown): boolean {
    return candidate === this
  }
}

class FakeKeyboardTarget implements ApplicationShellKeyboardEventTarget {
  listener: EventListener | null = null
  removedTypes: string[] = []

  addEventListener(_type: string, listener: EventListener): void {
    this.listener = listener
  }

  removeEventListener(type: string, listener: EventListener): void {
    if (this.listener === listener) {
      this.listener = null
    }

    this.removedTypes.push(type)
  }

  dispatch(key: string, shiftKey = false): void {
    const event = {
      key,
      shiftKey,
      preventDefault() {
        return undefined
      }
    }

    this.listener?.(event as unknown as Event)
  }
}
