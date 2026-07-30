import { describe, expect, it } from 'vitest'

import {
  parseAuditActionCode,
  parseAuditEntityType,
  parseAuditMetadata,
  parseAuditQueryLimit,
  parseStoredAuditMetadataJson,
  RepositoryValidationError
} from '@main/database'

describe('audit event validation', () => {
  it('accepts canonical action and entity codes at reviewed boundaries', () => {
    expect(parseAuditActionCode('AA')).toBe('AA')
    expect(parseAuditActionCode(`A${'B'.repeat(63)}`)).toBe(`A${'B'.repeat(63)}`)
    expect(parseAuditActionCode('INSTALLATION_INITIALIZED')).toBe('INSTALLATION_INITIALIZED')
    expect(parseAuditEntityType('LOCAL_USER')).toBe('LOCAL_USER')
    expect(parseAuditEntityType('LOCATION')).toBe('LOCATION')
  })

  it('rejects noncanonical action and entity codes with clean validation errors', () => {
    for (const value of [
      'A',
      `A${'B'.repeat(64)}`,
      'LOCAL_USER_CREATED ',
      ' local_user',
      'local_user',
      '1LOCAL_USER',
      'LOCAL-USER',
      'LOCAL.USER',
      'LOCAL USER',
      'LOCAL\u0000USER',
      'LOCAL\nUSER',
      'LOCAL\u2028USER',
      '\ud800CODE',
      12,
      null,
      {}
    ]) {
      expectSafeValidationError(captureError(() => parseAuditActionCode(value)))
      expectSafeValidationError(captureError(() => parseAuditEntityType(value)))
    }
  })

  it('accepts only explicit query limits from 1 through 200', () => {
    expect(parseAuditQueryLimit(1)).toBe(1)
    expect(parseAuditQueryLimit(200)).toBe(200)

    for (const value of [0, -1, 201, 1.5, Number.NaN, Number.POSITIVE_INFINITY, '10', true, null]) {
      expectSafeValidationError(captureError(() => parseAuditQueryLimit(value)))
    }
  })

  it('canonicalizes metadata keys deterministically and deep-freezes a copied graph', () => {
    const input = {
      zeta: 1,
      alpha: [
        true,
        {
          beta: ' exact string '
        },
        null
      ],
      empty: {}
    }

    const parsed = parseAuditMetadata(input)

    expect(parsed.metadataJson).toBe(
      '{"alpha":[true,{"beta":" exact string "},null],"empty":{},"zeta":1}'
    )
    expect(parsed.metadata).toEqual({
      alpha: [true, { beta: ' exact string ' }, null],
      empty: {},
      zeta: 1
    })
    expect(parsed.metadata).not.toBe(input)
    expect(Object.isFrozen(parsed.metadata)).toBe(true)
    expect(Object.isFrozen(parsed.metadata.alpha)).toBe(true)
    expect(Object.isFrozen((parsed.metadata.alpha as readonly unknown[])[1])).toBe(true)

    input.zeta = 2
    expect(parsed.metadataJson).toContain('"zeta":1')
  })

  it('accepts reviewed scalar, dense array, nested object, and empty metadata values', () => {
    expect(
      parseAuditMetadata({
        array: [null, false, true, 0, 42, 'keep  spaces'],
        nested: {
          child: {
            leaf: 'value'
          }
        }
      }).metadataJson
    ).toBe('{"array":[null,false,true,0,42,"keep  spaces"],"nested":{"child":{"leaf":"value"}}}')
    expect(parseAuditMetadata({}).metadataJson).toBe('{}')
  })

  it('accepts only ordinary current-realm metadata arrays', () => {
    expect(parseAuditMetadata({ array: [true] }).metadataJson).toBe('{"array":[true]}')
    expect(parseAuditMetadata({ array: Object.freeze([true]) }).metadataJson).toBe(
      '{"array":[true]}'
    )
    expect(parseAuditMetadata({ array: [] }).metadataJson).toBe('{"array":[]}')

    class CustomAuditMetadataArray extends Array<unknown> {}

    const nullPrototypeArray = [true]
    Object.setPrototypeOf(nullPrototypeArray, null)

    const intermediatePrototypeArray = [true]
    Object.setPrototypeOf(intermediatePrototypeArray, Object.create(Array.prototype))

    const subclassArray = new CustomAuditMetadataArray(true)

    const nestedCustomPrototypeArray = [true]
    Object.setPrototypeOf(nestedCustomPrototypeArray, Object.create(Array.prototype))

    const throwingPrototypeProxy = new Proxy([true], {
      getPrototypeOf() {
        throw new Error('C:\\secret\\array-prototype.txt')
      }
    })

    for (const value of [
      { array: nullPrototypeArray },
      { array: intermediatePrototypeArray },
      { array: subclassArray },
      { nested: { array: nestedCustomPrototypeArray } },
      { array: throwingPrototypeProxy }
    ]) {
      expectSafeValidationError(captureError(() => parseAuditMetadata(value)))
    }
  })

  it('rejects unsafe metadata shapes, values, keys, and resource limits', () => {
    class CustomMetadata {
      readonly safe = true
    }

    for (const value of [
      null,
      [],
      undefined,
      { bad_key: undefined },
      { bad_key: () => undefined },
      { bad_key: Symbol('audit') },
      { bad_key: 1n },
      { bad_key: Number.NaN },
      { bad_key: Number.POSITIVE_INFINITY },
      { bad_key: -0 },
      { bad_key: Number.MAX_SAFE_INTEGER + 1 },
      { bad_key: 'value\u0000' },
      { bad_key: 'line\u2028break' },
      { bad_key: '\ud800value' },
      { bad_key: 'A'.repeat(257) },
      { BadKey: true },
      { '': true },
      createReservedProtoMetadata(),
      { prototype: true },
      { constructor: true },
      new CustomMetadata(),
      new Date('2026-07-29T12:34:56.789Z'),
      new Map([['safe', true]]),
      new Set([true]),
      Buffer.from([1, 2, 3]),
      new Uint8Array([1, 2, 3]),
      { deep: { a: { b: { c: { too_deep: true } } } } },
      Object.fromEntries(Array.from({ length: 51 }, (_, index) => [`k${index}`, index])),
      { rows: Array.from({ length: 51 }, (_, index) => index) },
      {
        left: Array.from({ length: 50 }, (_, index) => index),
        right: Array.from({ length: 50 }, (_, index) => index)
      },
      Object.fromEntries(Array.from({ length: 20 }, (_, index) => [`k${index}`, 'A'.repeat(256)]))
    ]) {
      expectSafeValidationError(captureError(() => parseAuditMetadata(value)))
    }
  })

  it('rejects cycles and hostile descriptors without invoking user code', () => {
    const cyclic: { child?: unknown } = {}
    cyclic.child = cyclic

    let objectGetterInvoked = false
    const accessorObject = Object.create(null) as { readonly safe: unknown }
    Object.defineProperty(accessorObject, 'safe', {
      enumerable: true,
      get() {
        objectGetterInvoked = true
        throw new Error('C:\\secret\\metadata-getter.txt')
      }
    })

    let arrayGetterInvoked = false
    const accessorArray: unknown[] = []
    Object.defineProperty(accessorArray, '0', {
      enumerable: true,
      get() {
        arrayGetterInvoked = true
        throw new Error('C:\\secret\\array-getter.txt')
      }
    })

    for (const value of [
      cyclic,
      accessorObject,
      { list: accessorArray },
      new Proxy(
        { safe: true },
        {
          ownKeys() {
            throw new Error('C:\\secret\\ownKeys.txt')
          }
        }
      ),
      new Proxy(
        { safe: true },
        {
          getOwnPropertyDescriptor() {
            throw new Error('C:\\secret\\descriptor.txt')
          }
        }
      )
    ]) {
      expectSafeValidationError(captureError(() => parseAuditMetadata(value)))
    }

    expect(objectGetterInvoked).toBe(false)
    expect(arrayGetterInvoked).toBe(false)
  })

  it('rejects noncanonical persisted metadata JSON', () => {
    expect(parseStoredAuditMetadataJson('{"a":1,"b":[true]}').metadataJson).toBe(
      '{"a":1,"b":[true]}'
    )

    for (const value of [
      '{"b":1,"a":2}',
      '{ "a": 1 }',
      '[]',
      'null',
      '{"a":null',
      '{"a":"line\\u2028break"}',
      12,
      null
    ]) {
      expectSafeValidationError(captureError(() => parseStoredAuditMetadataJson(value)))
    }
  })
})

function expectSafeValidationError(error: unknown): void {
  expect(error).toBeInstanceOf(RepositoryValidationError)
  expect(error).not.toHaveProperty('cause')
  expect((error as Error).stack).toBeUndefined()

  const serialized = JSON.stringify(error)

  for (const unsafeFragment of [
    'INSTALLATION_INITIALIZED',
    'LOCAL_USER',
    'exact string',
    'metadata-getter',
    'array-getter',
    'array-prototype',
    'ownKeys',
    'descriptor',
    'array',
    'nested',
    'C:\\',
    'secret',
    'SELECT',
    'password',
    'hash',
    'salt'
  ]) {
    expect(serialized).not.toContain(unsafeFragment)
  }
}

function createReservedProtoMetadata(): Record<string, unknown> {
  const value = Object.create(null) as Record<string, unknown>
  Object.defineProperty(value, '__proto__', {
    enumerable: true,
    value: true
  })

  return value
}

function captureError(action: () => void): unknown {
  try {
    action()
  } catch (error) {
    return error
  }

  throw new Error('Expected action to throw')
}
