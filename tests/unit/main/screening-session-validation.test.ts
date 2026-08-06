import { describe, expect, it } from 'vitest'

import {
  parseCloseScreeningSessionInput,
  parseInsertScreeningSessionInput,
  parseReopenScreeningSessionInput,
  parseScreeningSessionDate,
  parseScreeningSessionListInput,
  parseScreeningSessionNote,
  parseScreeningSessionReopenReason,
  parseScreeningSessionTransitionRowVersion,
  RepositoryValidationError,
  type InsertScreeningSessionInput
} from '@main/database'
import { parseEntityId } from '@main/foundation/entity-id'
import { parseUtcTimestamp } from '@main/foundation/utc-clock'

const sessionId = parseEntityId('11111111-1111-4111-8111-111111111111')
const lifecycleHistoryId = parseEntityId('22222222-2222-4222-8222-222222222222')
const locationId = parseEntityId('33333333-3333-4333-8333-333333333333')
const protocolVersionId = parseEntityId('44444444-4444-4444-8444-444444444444')
const userId = parseEntityId('55555555-5555-4555-8555-555555555555')
const now = parseUtcTimestamp('2026-07-29T12:34:56.789Z')

describe('screening session validation', () => {
  it('accepts exact canonical local session dates and rejects malformed dates', () => {
    expect(parseScreeningSessionDate('2026-02-28')).toBe('2026-02-28')
    expect(parseScreeningSessionDate('2024-02-29')).toBe('2024-02-29')

    for (const value of [
      '2026-02-29',
      '2026-02-30',
      '2026-13-01',
      '2026-00-01',
      '2026-01-00',
      '2026-1-01',
      '2026-01-01T00:00:00.000Z',
      'not-a-date',
      null
    ]) {
      expect(() => parseScreeningSessionDate(value)).toThrow(RepositoryValidationError)
    }
  })

  it('preserves valid bounded text exactly and rejects unsafe notes and reasons', () => {
    const supplementary = '🙂'.repeat(500)

    expect(parseScreeningSessionNote('  Valid note  ')).toBe('  Valid note  ')
    expect(parseScreeningSessionNote(supplementary)).toBe(supplementary)
    expect(parseScreeningSessionNote(null)).toBeNull()

    for (const value of [
      '',
      '   ',
      '🙂'.repeat(501),
      '\t',
      '\n',
      '\r',
      '\u001f',
      '\u007f',
      '\u0085',
      '\u009f',
      '\u2028',
      '\u2029',
      '\ud800',
      '\udc00'
    ]) {
      expect(() => parseScreeningSessionNote(value)).toThrow(RepositoryValidationError)
    }

    expect(() => parseScreeningSessionReopenReason(null)).toThrow(RepositoryValidationError)
    expect(() => parseScreeningSessionReopenReason('  ')).toThrow(RepositoryValidationError)
    expect(parseScreeningSessionReopenReason('  Reopened for follow-up  ')).toBe(
      '  Reopened for follow-up  '
    )
  })

  it('requires exact own-data transport objects without hostile inspection side effects', () => {
    const validInput = createValidInsertInput()

    expect(parseInsertScreeningSessionInput(validInput)).toMatchObject({
      id: sessionId,
      lifecycleHistoryId,
      locationId,
      protocolVersionId,
      sessionDate: '2026-07-29',
      notes: 'Mobile screening day.',
      createdBy: userId,
      createdAt: now
    })

    const accessorInput = { ...validInput }
    Object.defineProperty(accessorInput, 'notes', {
      enumerable: true,
      get() {
        throw new Error('C:\\secret\\screening-note.txt')
      }
    })

    const customPrototypeInput = Object.create({ leaked: 'value' }) as Record<string, unknown>
    Object.assign(customPrototypeInput, validInput)

    for (const input of [
      { ...validInput, extra: true },
      { ...validInput, [Symbol('extra')]: true },
      accessorInput,
      customPrototypeInput,
      new Proxy(validInput, {
        getPrototypeOf() {
          throw new Error('C:\\secret\\prototype.txt')
        }
      }),
      new Proxy(validInput, {
        ownKeys() {
          throw new Error('C:\\secret\\ownKeys.txt')
        }
      }),
      new Proxy(validInput, {
        getOwnPropertyDescriptor() {
          throw new Error('C:\\secret\\descriptor.txt')
        }
      }),
      []
    ]) {
      expect(() =>
        parseInsertScreeningSessionInput(input as unknown as InsertScreeningSessionInput)
      ).toThrow(RepositoryValidationError)
    }
  })

  it('validates close and reopen command shapes without normalizing caller text', () => {
    expect(
      parseCloseScreeningSessionInput({
        id: sessionId,
        lifecycleHistoryId,
        expectedRowVersion: 1,
        closedBy: userId,
        closedAt: now,
        reason: null
      })
    ).toMatchObject({
      id: sessionId,
      lifecycleHistoryId,
      expectedRowVersion: 1,
      closedBy: userId,
      closedAt: now,
      reason: null
    })

    expect(
      parseReopenScreeningSessionInput({
        id: sessionId,
        lifecycleHistoryId,
        expectedRowVersion: 2,
        reopenedBy: userId,
        reopenedAt: now,
        reason: '  Patient flow resumed  '
      })
    ).toMatchObject({
      id: sessionId,
      lifecycleHistoryId,
      expectedRowVersion: 2,
      reopenedBy: userId,
      reopenedAt: now,
      reason: '  Patient flow resumed  '
    })

    expect(() =>
      parseReopenScreeningSessionInput({
        id: sessionId,
        lifecycleHistoryId,
        expectedRowVersion: 2,
        reopenedBy: userId,
        reopenedAt: now,
        reason: null as unknown as string
      })
    ).toThrow(RepositoryValidationError)
  })

  it('requires transition row versions to have a safe resulting version', () => {
    expect(parseScreeningSessionTransitionRowVersion(Number.MAX_SAFE_INTEGER - 1)).toBe(
      Number.MAX_SAFE_INTEGER - 1
    )
    expect(() => parseScreeningSessionTransitionRowVersion(Number.MAX_SAFE_INTEGER)).toThrow(
      RepositoryValidationError
    )
    expect(() =>
      parseCloseScreeningSessionInput({
        id: sessionId,
        lifecycleHistoryId,
        expectedRowVersion: Number.MAX_SAFE_INTEGER,
        closedBy: userId,
        closedAt: now,
        reason: null
      })
    ).toThrow(RepositoryValidationError)
    expect(() =>
      parseReopenScreeningSessionInput({
        id: sessionId,
        lifecycleHistoryId,
        expectedRowVersion: Number.MAX_SAFE_INTEGER,
        reopenedBy: userId,
        reopenedAt: now,
        reason: 'Reopen'
      })
    ).toThrow(RepositoryValidationError)
  })

  it('rejects list offset overflow before repository SQL is needed', () => {
    expect(() =>
      parseScreeningSessionListInput({
        locationId: null,
        status: null,
        dateFrom: null,
        dateTo: null,
        page: Number.MAX_SAFE_INTEGER,
        pageSize: 100
      })
    ).toThrow(RepositoryValidationError)
  })
})

function createValidInsertInput(): InsertScreeningSessionInput {
  return Object.freeze({
    id: sessionId,
    lifecycleHistoryId,
    locationId,
    protocolVersionId,
    sessionDate: parseScreeningSessionDate('2026-07-29'),
    notes: 'Mobile screening day.',
    createdBy: userId,
    createdAt: now
  })
}
