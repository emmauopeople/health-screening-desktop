import { describe, expect, it, vi } from 'vitest'

import { registerApplicationShutdown } from '@main/app/shutdown'

describe('application shutdown registration', () => {
  it('registers one will-quit hook and disposes IPC before closing SQLite', () => {
    let listener: (() => void) | undefined
    const events = {
      once: vi.fn((event: 'will-quit', callback: () => void) => {
        void event
        listener = callback
      })
    }
    const order: string[] = []
    const disposeIpcHandlers = vi.fn(() => order.push('ipc'))
    const closeDatabase = vi.fn(() => order.push('database'))

    registerApplicationShutdown(events, disposeIpcHandlers, closeDatabase)

    expect(events.once).toHaveBeenCalledOnce()
    expect(events.once).toHaveBeenCalledWith('will-quit', expect.any(Function))
    listener?.()

    expect(disposeIpcHandlers).toHaveBeenCalledOnce()
    expect(closeDatabase).toHaveBeenCalledOnce()
    expect(order).toEqual(['ipc', 'database'])
  })
})
