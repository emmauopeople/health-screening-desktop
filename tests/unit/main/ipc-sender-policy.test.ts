import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'

import {
  createDevelopmentNavigationPolicy,
  createProductionNavigationPolicy
} from '@main/app/navigation-policy'
import { isIpcSenderAllowed, type IpcSenderValidationEvent } from '@main/ipc/sender-policy'

describe('IPC sender policy', () => {
  it('accepts the approved development main frame', () => {
    const policy = createDevelopmentNavigationPolicy('http://localhost:5173/')
    const event = createSenderEvent('http://localhost:5173/src/renderer.tsx')

    expect(isIpcSenderAllowed(event, policy)).toBe(true)
  })

  it('accepts the approved packaged renderer main frame including same-document hash', () => {
    const rendererPath = 'E:\\health-app\\health-screening-desktop\\out\\renderer\\index.html'
    const policy = createProductionNavigationPolicy(rendererPath)
    const event = createSenderEvent(`${pathToFileURL(rendererPath).href}#status`)

    expect(isIpcSenderAllowed(event, policy)).toBe(true)
  })

  it('rejects missing and subframe senders', () => {
    const policy = createDevelopmentNavigationPolicy('http://localhost:5173/')
    const mainFrame = { url: 'http://localhost:5173/' }
    const subFrame = { url: 'http://localhost:5173/' }

    expect(
      isIpcSenderAllowed(
        {
          sender: { mainFrame },
          senderFrame: null
        },
        policy
      )
    ).toBe(false)
    expect(
      isIpcSenderAllowed(
        {
          sender: { mainFrame },
          senderFrame: subFrame
        },
        policy
      )
    ).toBe(false)
  })

  it('rejects unapproved development origins and malformed URLs', () => {
    const policy = createDevelopmentNavigationPolicy('http://localhost:5173/')

    expect(isIpcSenderAllowed(createSenderEvent('http://localhost:5174/'), policy)).toBe(false)
    expect(isIpcSenderAllowed(createSenderEvent('https://localhost:5173/'), policy)).toBe(false)
    expect(isIpcSenderAllowed(createSenderEvent('https://example.invalid/'), policy)).toBe(false)
    expect(isIpcSenderAllowed(createSenderEvent('not a url'), policy)).toBe(false)
  })

  it('rejects unrelated files and mismatched navigation policies', () => {
    const rendererPath = 'E:\\health-app\\health-screening-desktop\\out\\renderer\\index.html'
    const policy = createProductionNavigationPolicy(rendererPath)

    expect(
      isIpcSenderAllowed(
        createSenderEvent(pathToFileURL('E:\\health-app\\other\\index.html').href),
        policy
      )
    ).toBe(false)
    expect(isIpcSenderAllowed(createSenderEvent('http://localhost:5173/'), policy)).toBe(false)
  })
})

function createSenderEvent(url: string): IpcSenderValidationEvent {
  const mainFrame = { url }

  return {
    sender: { mainFrame },
    senderFrame: mainFrame
  }
}
