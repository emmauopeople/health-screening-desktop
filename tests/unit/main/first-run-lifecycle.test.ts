import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('first-run IPC lifecycle and scope', () => {
  it('composes first-run IPC after database initialization without invoking setup at startup', () => {
    const lifecycle = readSource('src/main/app/lifecycle.ts')
    const compositionStatement =
      'const firstRunBootstrapService = createProductionFirstRunBootstrapService'
    const registrationStatement = 'const disposeIpcHandlers = registerApplicationIpcHandlers'
    const initialWindowStatement = 'await createOrFocusMainWindow(configuration)'

    expect(lifecycle).toContain(compositionStatement)
    expect(lifecycle.indexOf('databaseRuntime.initialize()')).toBeLessThan(
      lifecycle.indexOf(compositionStatement)
    )
    expect(lifecycle.indexOf('databaseRuntime.getConnection()')).toBeLessThan(
      lifecycle.indexOf(registrationStatement)
    )
    expect(lifecycle.indexOf(compositionStatement)).toBeLessThan(
      lifecycle.indexOf(registrationStatement)
    )
    expect(lifecycle.indexOf(registrationStatement)).toBeLessThan(
      lifecycle.indexOf(initialWindowStatement)
    )
    expect(lifecycle).not.toMatch(/firstRunBootstrapService\.(getState|initialize)\(/u)
  })

  it('keeps renderer source unchanged from consuming first-run and preserves shell status text', () => {
    const rendererSource = readAllSource('src/renderer')

    expect(rendererSource).not.toContain('firstRun')
    expect(rendererSource).not.toContain('first-run')
    expect(rendererSource).toContain('Clinical workflows')
    expect(rendererSource).toContain('Not implemented')
    expect(rendererSource).toContain('Database')
    expect(rendererSource).toContain('Desktop IPC')
  })

  it('keeps shared and preload first-run code out of main-process internals', () => {
    const sharedAndPreload = [
      readSource('src/shared/ipc/first-run-contracts.ts'),
      readSource('src/preload/api.ts')
    ].join('\n')

    expect(sharedAndPreload).not.toContain('@main/')
    expect(sharedAndPreload).not.toContain('better-sqlite3')
    expect(sharedAndPreload).not.toContain('node:')
    expect(sharedAndPreload).not.toContain('passwordHash')
    expect(sharedAndPreload).not.toContain('passwordSalt')
  })

  it('keeps main first-run IPC handlers free of direct SQL and credential serialization', () => {
    const handlerSource = readSource('src/main/ipc/handlers/first-run-handlers.ts')

    expect(handlerSource).not.toMatch(
      /\b(SELECT|INSERT|UPDATE|DELETE|BEGIN|COMMIT|ROLLBACK|SAVEPOINT|RELEASE)\b/u
    )
    expect(handlerSource).not.toContain('transaction(')
    expect(handlerSource).not.toContain('passwordHash')
    expect(handlerSource).not.toContain('passwordSalt')
    expect(handlerSource).not.toContain('StoredPasswordCredential')
  })
})

function readSource(relativePath: string): string {
  return readFileSync(join(process.cwd(), relativePath), 'utf8')
}

function readAllSource(relativeDirectory: string): string {
  const files = [
    'src/renderer/src/app/App.tsx',
    'src/renderer/src/app/status-mapping.ts',
    'src/renderer/src/main.tsx',
    'src/renderer/src/styles/main.css'
  ]

  if (relativeDirectory !== 'src/renderer') {
    throw new Error('Unexpected source directory')
  }

  return files.map(readSource).join('\n')
}
