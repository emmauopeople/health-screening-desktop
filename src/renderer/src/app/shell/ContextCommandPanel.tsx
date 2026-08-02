import type { RefObject } from 'react'

import { primaryApplicationMenuLabels } from './application-navigation-catalog'
import { getPrimaryMenuButtonId } from './application-shell-dom-ids'
import type {
  ApplicationCommandDefinition,
  ApplicationCommandId,
  PrimaryApplicationMenu
} from './application-shell-types'

interface ContextCommandPanelProps {
  readonly id: string
  readonly panelRef: RefObject<HTMLElement | null>
  readonly menu: PrimaryApplicationMenu
  readonly commands: readonly ApplicationCommandDefinition[]
  readonly currentCommandId: ApplicationCommandId
  onCommand(commandId: ApplicationCommandId): void
}

export function ContextCommandPanel({
  id,
  panelRef,
  menu,
  commands,
  currentCommandId,
  onCommand
}: ContextCommandPanelProps): React.JSX.Element {
  const menuLabel = primaryApplicationMenuLabels[menu]

  return (
    <section
      ref={panelRef}
      id={id}
      className="application-command-panel"
      aria-label={`${menuLabel} commands`}
      aria-labelledby={getPrimaryMenuButtonId(menu)}
      data-shell-focus-zone="COMMAND_PANEL"
    >
      <div className="application-command-panel-heading">{menuLabel} commands</div>
      <div className="application-command-list">
        {commands.map((command) => (
          <button
            key={command.id}
            className="application-command-button"
            type="button"
            aria-current={currentCommandId === command.id ? 'page' : undefined}
            onClick={() => onCommand(command.id)}
          >
            <span>{command.label}</span>
            <span>{command.availability === 'AVAILABLE' ? 'Available' : 'Planned'}</span>
          </button>
        ))}
      </div>
    </section>
  )
}
