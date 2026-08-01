import type { PrimaryApplicationMenu } from './application-shell-types'

export function getPrimaryMenuButtonId(menu: PrimaryApplicationMenu): string {
  return `application-menu-${menu.toLowerCase()}`
}
