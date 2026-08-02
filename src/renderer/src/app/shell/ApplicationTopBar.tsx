import type { LocalUserRole } from '@shared/ipc'
import type { RefObject } from 'react'

import { formatAuthenticationRole } from '../authentication/authentication-role-labels'
import type { ApplicationMenuNavigationDefinition } from './application-navigation-catalog'
import { getPrimaryMenuButtonId } from './application-shell-dom-ids'
import type { ApplicationShellContext, PrimaryApplicationMenu } from './application-shell-types'

interface ApplicationTopBarProps {
  readonly context: ApplicationShellContext
  readonly displayName: string
  readonly role: LocalUserRole
  readonly menus: readonly ApplicationMenuNavigationDefinition[]
  readonly activeMenu: PrimaryApplicationMenu
  readonly commandPanelMenu: PrimaryApplicationMenu | null
  readonly focusedMenu: PrimaryApplicationMenu
  readonly busy: boolean
  readonly commandPanelId: string
  readonly topBarRef: RefObject<HTMLElement | null>
  onMenuClick(menu: PrimaryApplicationMenu): void
  onMenuFocus(menu: PrimaryApplicationMenu): void
  onMenuKeyDown(menu: PrimaryApplicationMenu, event: React.KeyboardEvent<HTMLButtonElement>): void
  onLock(): void
  onLogout(): void
  registerMenuButton(menu: PrimaryApplicationMenu, element: HTMLButtonElement | null): void
}

export function ApplicationTopBar({
  context,
  displayName,
  role,
  menus,
  activeMenu,
  commandPanelMenu,
  focusedMenu,
  busy,
  commandPanelId,
  topBarRef,
  onMenuClick,
  onMenuFocus,
  onMenuKeyDown,
  onLock,
  onLogout,
  registerMenuButton
}: ApplicationTopBarProps): React.JSX.Element {
  return (
    <header
      ref={topBarRef}
      className="application-top-bar"
      data-shell-slot="top-bar"
      data-shell-focus-zone="TOP_BAR"
    >
      <div className="application-brand" title={context.applicationName}>
        <strong>{context.applicationName}</strong>
        <span>Version {context.applicationVersion}</span>
      </div>
      <nav className="application-primary-nav" aria-label="Primary application navigation">
        {menus.map((menu) => {
          const isOpen = commandPanelMenu === menu.id
          const isActive = activeMenu === menu.id

          return (
            <button
              key={menu.id}
              id={getPrimaryMenuButtonId(menu.id)}
              ref={(element) => registerMenuButton(menu.id, element)}
              className="application-primary-menu-button"
              type="button"
              aria-controls={commandPanelId}
              aria-expanded={isOpen}
              aria-current={isActive ? 'page' : undefined}
              tabIndex={focusedMenu === menu.id ? 0 : -1}
              onClick={() => onMenuClick(menu.id)}
              onFocus={() => onMenuFocus(menu.id)}
              onKeyDown={(event) => onMenuKeyDown(menu.id, event)}
            >
              {menu.label}
            </button>
          )
        })}
      </nav>
      <div className="application-readiness" aria-label="Local data readiness">
        <span className="application-status-dot" aria-hidden="true" />
        <span>Local data ready</span>
      </div>
      <div className="application-account" aria-label="Current local user">
        <span title={displayName}>{displayName}</span>
        <span>{formatAuthenticationRole(role)}</span>
      </div>
      <div className="application-session-actions">
        <button className="button button-secondary" type="button" onClick={onLock} disabled={busy}>
          Lock
        </button>
        <button
          className="button button-secondary"
          type="button"
          onClick={onLogout}
          disabled={busy}
        >
          Sign out
        </button>
      </div>
    </header>
  )
}
