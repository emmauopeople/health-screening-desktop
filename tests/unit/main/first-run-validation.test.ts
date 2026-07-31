import { describe, expect, it, vi } from 'vitest'

import {
  createFirstRunBootstrapService,
  FirstRunValidationError,
  parseFirstRunInitializationInput
} from '@main/application'
import type {
  AuditEventRepository,
  InstallationRepository,
  LocalUserRepository,
  LocationRepository
} from '@main/database'
import type { DatabaseTransactionExecutor } from '@main/database/transaction'
import type { PasswordCredentialService } from '@main/security'

const validCommand = Object.freeze({
  deploymentName: '  Cameroon   Pilot  ',
  timeZone: 'UTC',
  administrator: Object.freeze({
    username: ' \uff21dmin.User ',
    displayName: ' Dr.  Ada   Lovelace ',
    temporaryPassword: 'ValidPassw0rd!'
  }),
  initialLocation: Object.freeze({
    name: ' Central   Church ',
    locationType: 'CHURCH',
    village: ' Messa ',
    subdivision: ' Yaounde  I ',
    region: ' Centre ',
    directions: ' Opposite   market gate. '
  })
})

describe('first-run initialization validation', () => {
  it('accepts one exact command and composes reviewed parsers', () => {
    const parsed = parseFirstRunInitializationInput(validCommand)

    expect(parsed).toEqual({
      deploymentName: 'Cameroon Pilot',
      timeZone: 'UTC',
      administrator: {
        username: 'Admin.User',
        displayName: 'Dr. Ada Lovelace',
        temporaryPassword: 'ValidPassw0rd!'
      },
      initialLocation: {
        name: 'Central Church',
        locationType: 'CHURCH',
        village: 'Messa',
        subdivision: 'Yaounde I',
        region: 'Centre',
        directions: 'Opposite market gate.'
      }
    })
    expect(Object.isFrozen(parsed)).toBe(true)
    expect(Object.isFrozen(parsed.administrator)).toBe(true)
    expect(Object.isFrozen(parsed.initialLocation)).toBe(true)
    expect(parsed).not.toBe(validCommand)
    expect(parsed.administrator).not.toBe(validCommand.administrator)
    expect(parsed.initialLocation).not.toBe(validCommand.initialLocation)
  })

  it('rejects exact-shape violations at the top level and nested levels', () => {
    class CommandWithCustomPrototype {
      readonly deploymentName = 'Cameroon Pilot'
      readonly timeZone = 'UTC'
      readonly administrator = validCommand.administrator
      readonly initialLocation = validCommand.initialLocation
    }

    class AdministratorWithCustomPrototype {
      readonly username = 'Admin.User'
      readonly displayName = 'Admin User'
      readonly temporaryPassword = 'ValidPassw0rd!'
    }

    const inheritedCommand = Object.create(validCommand) as unknown

    for (const value of [
      null,
      [],
      'command',
      12,
      {},
      { ...validCommand, extra: true },
      Object.defineProperty({ ...validCommand }, Symbol('secret'), {
        value: true,
        enumerable: true
      }),
      Object.fromEntries(Object.entries(validCommand).filter(([key]) => key !== 'deploymentName')),
      inheritedCommand,
      new CommandWithCustomPrototype(),
      { ...validCommand, administrator: null },
      { ...validCommand, administrator: [] },
      { ...validCommand, administrator: { ...validCommand.administrator, extra: true } },
      { ...validCommand, administrator: new AdministratorWithCustomPrototype() },
      {
        ...validCommand,
        administrator: Object.fromEntries(
          Object.entries(validCommand.administrator).filter(([key]) => key !== 'username')
        )
      },
      { ...validCommand, initialLocation: null },
      { ...validCommand, initialLocation: [] },
      { ...validCommand, initialLocation: { ...validCommand.initialLocation, extra: true } },
      {
        ...validCommand,
        initialLocation: Object.fromEntries(
          Object.entries(validCommand.initialLocation).filter(([key]) => key !== 'directions')
        )
      }
    ]) {
      expectSafeValidationError(captureError(() => parseFirstRunInitializationInput(value)))
    }
  })

  it('rejects accessors, setters, and proxy traps without invoking caller code', () => {
    let topGetterInvoked = false
    const accessorCommand = { ...validCommand }
    Object.defineProperty(accessorCommand, 'deploymentName', {
      enumerable: true,
      get() {
        topGetterInvoked = true
        throw new Error('C:\\secret\\deployment-getter.txt')
      }
    })

    let nestedSetterInvoked = false
    const setterAdministrator = { ...validCommand.administrator }
    Object.defineProperty(setterAdministrator, 'username', {
      enumerable: true,
      set() {
        nestedSetterInvoked = true
        throw new Error('C:\\secret\\username-setter.txt')
      }
    })

    let nestedGetterInvoked = false
    const accessorLocation = { ...validCommand.initialLocation }
    Object.defineProperty(accessorLocation, 'name', {
      enumerable: true,
      get() {
        nestedGetterInvoked = true
        throw new Error('C:\\secret\\location-getter.txt')
      }
    })

    for (const value of [
      accessorCommand,
      { ...validCommand, administrator: setterAdministrator },
      { ...validCommand, initialLocation: accessorLocation },
      new Proxy(
        { ...validCommand },
        {
          ownKeys() {
            throw new Error('C:\\secret\\command-ownKeys.txt')
          }
        }
      ),
      {
        ...validCommand,
        administrator: new Proxy(
          { ...validCommand.administrator },
          {
            getOwnPropertyDescriptor() {
              throw new Error('C:\\secret\\administrator-descriptor.txt')
            }
          }
        )
      }
    ]) {
      expectSafeValidationError(captureError(() => parseFirstRunInitializationInput(value)))
    }

    expect(topGetterInvoked).toBe(false)
    expect(nestedSetterInvoked).toBe(false)
    expect(nestedGetterInvoked).toBe(false)
  })

  it('rejects invalid domain fields through the first-run validation boundary', () => {
    for (const value of [
      { ...validCommand, deploymentName: 'Secret\u0000Deployment' },
      { ...validCommand, timeZone: '+05:30' },
      {
        ...validCommand,
        administrator: { ...validCommand.administrator, username: 'ab' }
      },
      {
        ...validCommand,
        administrator: { ...validCommand.administrator, displayName: '\u2028' }
      },
      {
        ...validCommand,
        initialLocation: { ...validCommand.initialLocation, name: '   ' }
      },
      {
        ...validCommand,
        initialLocation: { ...validCommand.initialLocation, locationType: 'HOSPITAL' }
      },
      {
        ...validCommand,
        initialLocation: { ...validCommand.initialLocation, village: '' }
      },
      {
        ...validCommand,
        initialLocation: { ...validCommand.initialLocation, directions: 'bad\u0000directions' }
      }
    ]) {
      expectSafeValidationError(captureError(() => parseFirstRunInitializationInput(value)))
    }
  })

  it('does not hash or open a transaction when non-password validation fails', async () => {
    const dependencies = createValidationOnlyDependencies()
    const service = createFirstRunBootstrapService(dependencies)

    await expect(
      service.initialize({
        ...validCommand,
        initialLocation: { ...validCommand.initialLocation, locationType: 'HOSPITAL' }
      })
    ).rejects.toBeInstanceOf(FirstRunValidationError)

    expect(dependencies.passwordCredentialService.hash).not.toHaveBeenCalled()
    expect(dependencies.transactionExecutor.run).not.toHaveBeenCalled()
    expect(dependencies.installationRepository.getState).not.toHaveBeenCalled()
    expect(dependencies.localUserRepository.hasAny).not.toHaveBeenCalled()
    expect(dependencies.locationRepository.hasAny).not.toHaveBeenCalled()
  })
})

function createValidationOnlyDependencies(): {
  installationRepository: InstallationRepository
  localUserRepository: LocalUserRepository
  locationRepository: LocationRepository
  auditEventRepository: AuditEventRepository
  passwordCredentialService: PasswordCredentialService & {
    hash: ReturnType<typeof vi.fn<PasswordCredentialService['hash']>>
  }
  transactionExecutor: DatabaseTransactionExecutor & {
    run: ReturnType<typeof vi.fn<DatabaseTransactionExecutor['run']>>
  }
} {
  return {
    installationRepository: {
      get: vi.fn(),
      getState: vi.fn(),
      insert: vi.fn()
    } as unknown as InstallationRepository,
    localUserRepository: {
      hasAny: vi.fn(),
      getById: vi.fn(),
      getByUsername: vi.fn(),
      getAuthenticationByUsername: vi.fn(),
      insert: vi.fn()
    } as unknown as LocalUserRepository,
    locationRepository: {
      hasAny: vi.fn(),
      getById: vi.fn(),
      listAll: vi.fn(),
      listActive: vi.fn(),
      insert: vi.fn()
    } as unknown as LocationRepository,
    auditEventRepository: {
      getById: vi.fn(),
      listRecent: vi.fn(),
      listForEntity: vi.fn(),
      insert: vi.fn()
    } as unknown as AuditEventRepository,
    passwordCredentialService: {
      validateCredential: vi.fn(),
      hash: vi.fn(),
      verify: vi.fn()
    } as unknown as PasswordCredentialService & {
      hash: ReturnType<typeof vi.fn<PasswordCredentialService['hash']>>
    },
    transactionExecutor: {
      run: vi.fn()
    } as unknown as DatabaseTransactionExecutor & {
      run: ReturnType<typeof vi.fn<DatabaseTransactionExecutor['run']>>
    }
  }
}

function expectSafeValidationError(error: unknown): void {
  expect(error).toBeInstanceOf(FirstRunValidationError)
  expect(error).not.toHaveProperty('cause')
  expect((error as Error).stack).toBeUndefined()

  const serialized = JSON.stringify(error)

  for (const unsafeFragment of [
    'Cameroon',
    'ValidPassw0rd',
    'Admin',
    'Ada',
    'Central',
    'Messa',
    'Yaounde',
    'Centre',
    'Opposite',
    'Secret',
    'deployment-getter',
    'username-setter',
    'location-getter',
    'ownKeys',
    'descriptor',
    'C:\\',
    'SELECT'
  ]) {
    expect(serialized).not.toContain(unsafeFragment)
  }
}

function captureError(action: () => void): unknown {
  try {
    action()
  } catch (error) {
    return error
  }

  throw new Error('Expected action to throw')
}
