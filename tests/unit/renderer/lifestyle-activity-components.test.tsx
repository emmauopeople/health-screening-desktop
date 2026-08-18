// @vitest-environment jsdom

import { act, createElement, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { OtherActivityCard } from '../../../src/renderer/src/app/screening/lifestyle/OtherActivityCard'
import { PhysicalActivityCard } from '../../../src/renderer/src/app/screening/lifestyle/PhysicalActivityCard'
import {
  createEmptyActivityRow,
  createEmptyOtherActivityRow,
  createInitialOtherActivityForm,
  createInitialPhysicalActivityForm,
  type OtherActivityForm,
  type PhysicalActivityForm
} from '../../../src/renderer/src/app/screening/lifestyle/activity-workspace-model'

describe('Lifestyle activity card interactions', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.append(container)
  })

  afterEach(() => {
    act(() => root?.unmount())
    container.remove()
  })

  it('focuses the new Physical Activity domain after Add activity', () => {
    const initialForm: PhysicalActivityForm = {
      ...createInitialPhysicalActivityForm(),
      weeklyResponse: 'YES',
      activities: []
    }
    function Harness(): React.JSX.Element {
      const [current, setCurrent] = useState(initialForm)
      return createElement(PhysicalActivityCard, {
        form: current,
        errors: [],
        expanded: true,
        encounterStatus: 'DRAFT',
        saving: false,
        onUpdate: (update: (value: PhysicalActivityForm) => PhysicalActivityForm) =>
          setCurrent(update),
        onToggleExpanded: () => undefined
      })
    }

    act(() => {
      root = createRoot(container)
      root.render(createElement(Harness))
    })
    const add = container.querySelector<HTMLButtonElement>('#physical-add-activity')
    expect(add).not.toBeNull()

    act(() => add?.click())

    const domain = container.querySelector<HTMLSelectElement>('select[id$="-domain"]')
    expect(domain).not.toBeNull()
    expect(document.activeElement).toBe(domain)
  })

  it('renders the compact activity card fields and duration group', () => {
    const initialForm: PhysicalActivityForm = {
      ...createInitialPhysicalActivityForm(),
      weeklyResponse: 'YES',
      activities: [createEmptyActivityRow(1)]
    }
    function Harness(): React.JSX.Element {
      return createElement(PhysicalActivityCard, {
        form: initialForm,
        errors: [],
        expanded: true,
        encounterStatus: 'DRAFT',
        saving: false,
        onUpdate: () => undefined,
        onToggleExpanded: () => undefined
      })
    }

    act(() => {
      root = createRoot(container)
      root.render(createElement(Harness))
    })

    expect(container.querySelector('.lifestyle-activity-row')).not.toBeNull()
    expect(container.querySelector('.lifestyle-activity-duration-fields')).toBeNull()
    expect(container.querySelectorAll('.lifestyle-activity-field')).toHaveLength(6)
    expect(container.querySelectorAll('.lifestyle-field-error')).toHaveLength(6)
    for (const label of [
      'Type of activity',
      'Intensity',
      'Description (optional)',
      'Days per week',
      'Average time per day',
      'Hours',
      'Minutes'
    ]) {
      expect(container.textContent).toContain(label)
    }
  })

  it('marks Other Activity descriptions as optional', () => {
    const initialForm: OtherActivityForm = {
      ...createInitialOtherActivityForm(),
      weeklyResponse: 'YES',
      activities: [createEmptyOtherActivityRow(1)]
    }
    function Harness(): React.JSX.Element {
      return createElement(OtherActivityCard, {
        form: initialForm,
        errors: [],
        expanded: true,
        encounterStatus: 'DRAFT',
        saving: false,
        onUpdate: () => undefined,
        onToggleExpanded: () => undefined
      })
    }

    act(() => {
      root = createRoot(container)
      root.render(createElement(Harness))
    })

    expect(container.textContent).toContain('Description (optional)')
    expect(container.querySelector('[id$="-description"]')).not.toBeNull()
    expect(container.querySelector('[id$="-description"]')?.getAttribute('aria-invalid')).toBe(
      'false'
    )
  })

  it('uses the same six-field structure and compact action classes for both activity rows', () => {
    const physicalForm: PhysicalActivityForm = {
      ...createInitialPhysicalActivityForm(),
      weeklyResponse: 'YES',
      activities: [createEmptyActivityRow(1)]
    }
    const otherForm: OtherActivityForm = {
      ...createInitialOtherActivityForm(),
      weeklyResponse: 'YES',
      activities: [createEmptyOtherActivityRow(1)]
    }
    function Harness(): React.JSX.Element {
      return createElement(
        'div',
        null,
        createElement(PhysicalActivityCard, {
          form: physicalForm,
          errors: [],
          expanded: true,
          encounterStatus: 'DRAFT',
          saving: false,
          onUpdate: () => undefined,
          onToggleExpanded: () => undefined
        }),
        createElement(OtherActivityCard, {
          form: otherForm,
          errors: [],
          expanded: true,
          encounterStatus: 'DRAFT',
          saving: false,
          onUpdate: () => undefined,
          onToggleExpanded: () => undefined
        })
      )
    }

    act(() => {
      root = createRoot(container)
      root.render(createElement(Harness))
    })

    const rows = Array.from(container.querySelectorAll('.lifestyle-activity-row'))
    expect(rows).toHaveLength(2)
    expect(rows.map((row) => row.querySelectorAll('.lifestyle-activity-field').length)).toEqual([
      6, 6
    ])
    expect(rows.every((row) => row.querySelector('.lifestyle-activity-actions'))).toBe(true)
    expect(container.querySelectorAll('.lifestyle-activity-add')).toHaveLength(2)
    expect(container.querySelectorAll('.lifestyle-activity-add.button')).toHaveLength(2)
  })

  it('keeps all error slots and field structure when validation errors are displayed', () => {
    const row = createEmptyActivityRow(1)
    const initialForm: PhysicalActivityForm = {
      ...createInitialPhysicalActivityForm(),
      weeklyResponse: 'YES',
      activities: [row]
    }
    const errors = [
      {
        fieldId: `physical-activity-${row.clientKey}-domain`,
        message: 'Select an activity domain.'
      },
      { fieldId: `physical-activity-${row.clientKey}-hours`, message: 'Enter a duration.' }
    ]
    function Harness(): React.JSX.Element {
      return createElement(PhysicalActivityCard, {
        form: initialForm,
        errors,
        expanded: true,
        encounterStatus: 'DRAFT',
        saving: false,
        onUpdate: () => undefined,
        onToggleExpanded: () => undefined
      })
    }

    act(() => {
      root = createRoot(container)
      root.render(createElement(Harness))
    })

    expect(container.querySelectorAll('.lifestyle-activity-field')).toHaveLength(6)
    expect(container.querySelectorAll('.lifestyle-field-error')).toHaveLength(6)
    expect(
      container.querySelector(`#error-physical-activity-${row.clientKey}-domain`)
    ).not.toBeNull()
    expect(
      container
        .querySelector(`#physical-activity-${row.clientKey}-domain`)
        ?.getAttribute('aria-describedby')
    ).toBe(`error-physical-activity-${row.clientKey}-domain`)
    expect(
      container
        .querySelector(`#physical-activity-${row.clientKey}-description`)
        ?.hasAttribute('aria-describedby')
    ).toBe(false)
  })

  it('focuses the Add activity button after removing the last Other Activity row', () => {
    const initialForm: OtherActivityForm = {
      ...createInitialOtherActivityForm(),
      weeklyResponse: 'YES',
      activities: [createEmptyOtherActivityRow(1)]
    }
    function Harness(): React.JSX.Element {
      const [current, setCurrent] = useState(initialForm)
      return createElement(OtherActivityCard, {
        form: current,
        errors: [],
        expanded: true,
        encounterStatus: 'DRAFT',
        saving: false,
        onUpdate: (update: (value: OtherActivityForm) => OtherActivityForm) => setCurrent(update),
        onToggleExpanded: () => undefined
      })
    }

    act(() => {
      root = createRoot(container)
      root.render(createElement(Harness))
    })
    const remove = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(
      (button) => button.textContent?.trim() === 'Remove'
    )
    expect(remove).not.toBeNull()

    act(() => remove?.click())

    expect(document.activeElement).toBe(
      container.querySelector<HTMLButtonElement>('#other-add-activity')
    )
  })

  it('keeps stable row controls when moving an existing activity', () => {
    const first = createEmptyActivityRow(1)
    const second = createEmptyActivityRow(2)
    const initialForm: PhysicalActivityForm = {
      ...createInitialPhysicalActivityForm(),
      weeklyResponse: 'YES',
      activities: [first, second]
    }
    function Harness(): React.JSX.Element {
      const [current, setCurrent] = useState(initialForm)
      return createElement(PhysicalActivityCard, {
        form: current,
        errors: [],
        expanded: true,
        encounterStatus: 'DRAFT',
        saving: false,
        onUpdate: (update: (value: PhysicalActivityForm) => PhysicalActivityForm) =>
          setCurrent(update),
        onToggleExpanded: () => undefined
      })
    }

    act(() => {
      root = createRoot(container)
      root.render(createElement(Harness))
    })
    const moveDown = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(
      (button) => button.textContent?.trim() === 'Move down'
    )
    const movedRowDomain = container.querySelector<HTMLSelectElement>(
      `#physical-activity-${first.clientKey}-domain`
    )
    expect(moveDown).not.toBeNull()
    expect(movedRowDomain).not.toBeNull()

    act(() => moveDown?.click())

    expect(document.activeElement).toBe(movedRowDomain)
  })
})
