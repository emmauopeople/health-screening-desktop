export interface ApplicationShutdownEvents {
  once(event: 'will-quit', listener: () => void): void
}

export function registerApplicationShutdown(
  events: ApplicationShutdownEvents,
  disposeIpcHandlers: () => void,
  closeDatabase: () => void
): void {
  events.once('will-quit', () => {
    disposeIpcHandlers()
    closeDatabase()
  })
}
