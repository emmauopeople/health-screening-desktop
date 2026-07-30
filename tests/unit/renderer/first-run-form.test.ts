import { describe, expect, it } from 'vitest'

import {
  createFirstRunInitializeRequest,
  firstRunLocationTypeOptions,
  optionalText,
  readFirstRunSetupFormValues,
  type FirstRunSetupFormValues
} from '../../../src/renderer/src/app/first-run/first-run-form'

const baseValues: FirstRunSetupFormValues = {
  deploymentName: ' Raw Deployment ',
  timeZone: 'Africa/Douala',
  username: 'Admin.User',
  displayName: ' Admin Display ',
  temporaryPassword: 'temporary-passphrase',
  confirmTemporaryPassword: 'temporary-passphrase',
  locationName: ' Initial Site ',
  locationType: 'CHURCH',
  village: '',
  subdivision: '   ',
  region: null,
  directions: ''
}

describe('first-run form command builder', () => {
  it('builds the exact HSD-015 initialize command and excludes password confirmation', () => {
    const command = createFirstRunInitializeRequest(baseValues)

    expect(command).toEqual({
      deploymentName: ' Raw Deployment ',
      timeZone: 'Africa/Douala',
      administrator: {
        username: 'Admin.User',
        displayName: ' Admin Display ',
        temporaryPassword: 'temporary-passphrase'
      },
      initialLocation: {
        name: ' Initial Site ',
        locationType: 'CHURCH',
        village: null,
        subdivision: null,
        region: null,
        directions: null
      }
    })
    expect(JSON.stringify(command)).not.toContain('confirmTemporaryPassword')
  })

  it('converts empty or whitespace optional fields to null', () => {
    expect(optionalText('')).toBeNull()
    expect(optionalText('   ')).toBeNull()
    expect(optionalText(null)).toBeNull()
  })

  it('preserves nonblank optional text exactly instead of trimming or normalizing', () => {
    expect(optionalText('  Keep these spaces  ')).toBe('  Keep these spaces  ')
    expect(
      createFirstRunInitializeRequest({
        ...baseValues,
        village: '  Village One  ',
        subdivision: 'Subdivision\tA',
        region: 'Région',
        directions: ' Follow the north road. '
      }).initialLocation
    ).toMatchObject({
      village: '  Village One  ',
      subdivision: 'Subdivision\tA',
      region: 'Région',
      directions: ' Follow the north road. '
    })
  })

  it('maps each exact reviewed location type', () => {
    for (const option of firstRunLocationTypeOptions) {
      expect(
        createFirstRunInitializeRequest({ ...baseValues, locationType: option.value })
      ).toMatchObject({
        initialLocation: {
          locationType: option.value
        }
      })
    }
  })

  it('reads only string form fields and keeps missing entries as null', () => {
    const values = readFirstRunSetupFormValues({
      get(name) {
        if (name === 'deploymentName') return 'Deployment'
        if (name === 'timeZone') return 'Africa/Douala'
        if (name === 'username') return 'admin'
        if (name === 'displayName') return 'Admin'
        if (name === 'temporaryPassword') return 'temporary-passphrase'
        if (name === 'confirmTemporaryPassword') return 'temporary-passphrase'
        if (name === 'locationName') return 'Location'
        if (name === 'locationType') return 'CHURCH'
        return { notAString: true }
      }
    })

    expect(values).toEqual({
      deploymentName: 'Deployment',
      timeZone: 'Africa/Douala',
      username: 'admin',
      displayName: 'Admin',
      temporaryPassword: 'temporary-passphrase',
      confirmTemporaryPassword: 'temporary-passphrase',
      locationName: 'Location',
      locationType: 'CHURCH',
      village: null,
      subdivision: null,
      region: null,
      directions: null
    })
  })
})
