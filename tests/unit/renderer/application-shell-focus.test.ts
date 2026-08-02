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
    const focusState: { activeElement: FakeFocusable | null } = { activeElement: null }
    const topBar = new FakeFocusable(focusState)
    const primaryMenu = topBar.addChild(new FakeFocusable(focusState))
    const lock = topBar.addChild(new FakeFocusable(focusState))
    const signOut = topBar.addChild(new FakeFocusable(focusState))
    const commandPanel = new FakeFocusable(focusState)
    const firstCommand = commandPanel.addChild(new FakeFocusable(focusState))
    const laterCommand = commandPanel.addChild(new FakeFocusable(focusState))
    const workspace = new FakeFocusable(focusState)
    const workspaceHeading = workspace.addChild(new FakeFocusable(focusState))
    const documentTarget = {
      get activeElement(): FakeFocusable | null {
        return focusState.activeElement
      }
    }
    let panelOpen = true
    const zones: readonly ApplicationShellFocusZoneDefinition[] = [
      {
        id: 'TOP_BAR',
        getContainer: () => topBar,
        getFocusTarget: () => primaryMenu
      },
      {
        id: 'COMMAND_PANEL',
        getContainer: () => (panelOpen ? commandPanel : null),
        getFocusTarget: () => (panelOpen ? firstCommand : null)
      },
      {
        id: 'PATIENT_TABS',
        getContainer: () => null,
        getFocusTarget: () => null
      },
      {
        id: 'WORKSPACE',
        getContainer: () => workspace,
        getFocusTarget: () => workspaceHeading
      }
    ]
    const cycler = createApplicationShellFocusCycler({
      keyboardTarget,
      documentTarget,
      getZones: () => zones
    })

    for (const topBarFocus of [primaryMenu, lock, signOut]) {
      focusState.activeElement = topBarFocus
      keyboardTarget.dispatch('F6')
      expect(focusState.activeElement).toBe(firstCommand)
    }

    for (const commandPanelFocus of [firstCommand, laterCommand]) {
      focusState.activeElement = commandPanelFocus
      keyboardTarget.dispatch('F6')
      expect(focusState.activeElement).toBe(workspaceHeading)
    }

    focusState.activeElement = workspaceHeading
    keyboardTarget.dispatch('F6')
    expect(focusState.activeElement).toBe(primaryMenu)

    panelOpen = false
    focusState.activeElement = lock
    keyboardTarget.dispatch('F6')
    expect(focusState.activeElement).toBe(workspaceHeading)

    panelOpen = true
    focusState.activeElement = primaryMenu
    keyboardTarget.dispatch('F6', true)
    expect(focusState.activeElement).toBe(workspaceHeading)

    keyboardTarget.dispatch('F6', true)
    expect(focusState.activeElement).toBe(firstCommand)

    expect(getNextFocusZoneIndex(-1, 3, false)).toBe(0)
    expect(getNextFocusZoneIndex(0, 3, true)).toBe(2)

    cycler.dispose()
    focusState.activeElement = primaryMenu
    keyboardTarget.dispatch('F6')

    expect(keyboardTarget.removedTypes).toEqual(['keydown'])
    expect(focusState.activeElement).toBe(primaryMenu)
  })
})

class FakeFocusable {
  private readonly children = new Set<unknown>()
  focusCount = 0

  constructor(private readonly focusState: { activeElement: FakeFocusable | null }) {}

  focus(): void {
    this.focusCount += 1
    this.focusState.activeElement = this
  }

  addChild<T extends FakeFocusable>(child: T): T {
    this.children.add(child)

    return child
  }

  contains(candidate: unknown): boolean {
    return candidate === this || this.children.has(candidate)
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
