import {
  parseAuditActionCode,
  parseAuditEntityType,
  parseCompleteLifestyleAlcoholWeeklyInput,
  parseCompleteLifestylePhysicalActivityWeeklyInput,
  parseCompleteLifestyleTobaccoWeeklyInput,
  parseLifestyleAlcoholBaselineInput,
  parseLifestyleDraftUpdateInput,
  parseLifestyleTobaccoBaselineInput,
  parseLifestyleWorkBaselineInput,
  readDataProperties,
  RepositoryDataIntegrityError,
  RepositoryValidationError,
  type AuditMetadata,
  type InstallationRecord,
  type LifestyleAlcoholBaselineInput,
  type LifestyleAlcoholWeeklyInput,
  type LifestyleDraftRecord,
  type LifestyleDraftUpdateInput,
  type LifestyleOtherActivityInput,
  type LifestylePhysicalActivityWeeklyInput,
  type LifestyleRepository,
  type ScreeningEncounterRecord,
  type ScreeningSessionRecord,
  type LifestyleTobaccoBaselineInput,
  type LifestyleTobaccoWeeklyInput,
  type LifestyleWorkBaselineInput,
  type LifestyleWorkWeeklyInput
} from '@main/database'
import type { DatabaseTransactionConnection } from '@main/database/transaction'
import { parseEntityId, type EntityId } from '@main/foundation/entity-id'
import type { UtcTimestamp } from '@main/foundation/utc-clock'

import {
  LocalSessionAuthorizationError,
  LocalSessionLockedError,
  LocalSessionPasswordChangeRequiredError,
  LocalSessionUnauthenticatedError,
  isLocalSessionError
} from '../authentication/session'
import type {
  CompleteLifestyleRequest,
  CompleteLifestyleResult,
  GetLifestyleWorkspaceRequest,
  GetLifestyleWorkspaceResult,
  LifestyleServiceControlledStatus,
  LifestyleWorkspaceSummary,
  SaveLifestyleAlcoholBaselineRequest,
  SaveLifestyleDraftRequest,
  SaveLifestyleResult,
  SaveLifestyleTobaccoBaselineRequest,
  SaveLifestyleWorkBaselineRequest,
  ScreeningLifestyleService,
  ScreeningLifestyleServiceDependencies
} from './screening-lifestyle-service-types'

const allowedRoles = Object.freeze(['LOCAL_ADMIN', 'NURSE', 'TRAINED_SCREENER'] as const)
const screeningEncounterEntityType = parseAuditEntityType('SCREENING_ENCOUNTER')
const alcoholBaselineAction = parseAuditActionCode('SCREENING_LIFESTYLE_ALCOHOL_BASELINE_CREATED')
const tobaccoBaselineAction = parseAuditActionCode('SCREENING_LIFESTYLE_TOBACCO_BASELINE_CREATED')
const workBaselineAction = parseAuditActionCode('SCREENING_LIFESTYLE_WORK_BASELINE_CREATED')
const draftSavedAction = parseAuditActionCode('SCREENING_LIFESTYLE_DRAFT_SAVED')
const stepCompletedAction = parseAuditActionCode('SCREENING_LIFESTYLE_STEP_COMPLETED')

const getRequestKeys = Object.freeze(['encounterId'] as const)
const baselineCommonKeys = Object.freeze([
  'encounterId',
  'expectedBaselineVersion',
  'expectedDraftVersion'
] as const)
const draftRequestKeys = Object.freeze([
  'encounterId',
  'expectedVersion',
  'alcohol',
  'tobacco',
  'physicalActivity',
  'work',
  'otherActivities'
] as const)

type ValidatedActor = Readonly<{ userId: EntityId }>
type ValidatedContext = Readonly<{
  installation: InstallationRecord
  encounter: ScreeningEncounterRecord
  session: ScreeningSessionRecord
}>

interface ParsedGetCommand {
  readonly encounterId: EntityId
}

interface ParsedBaselineCommand {
  readonly encounterId: EntityId
  readonly expectedBaselineVersion: number | null
  readonly expectedDraftVersion: number | null
  readonly fields: Record<string, unknown>
}

interface ParsedDraftCommand {
  readonly encounterId: EntityId
  readonly expectedVersion: number | null
  readonly fields: Record<string, unknown>
}

type BaselineDomain = 'alcohol' | 'tobacco' | 'work'

export function createScreeningLifestyleService({
  authenticationSessionService,
  currentScreeningSessionService,
  installationLocationService,
  installationRepository,
  locationRepository,
  screeningSessionRepository,
  screeningEncounterRepository,
  lifestyleRepository,
  screeningEncounterOutboxRepository,
  auditEventRepository,
  transactionExecutor
}: ScreeningLifestyleServiceDependencies): ScreeningLifestyleService {
  return Object.freeze({
    getLifestyleWorkspace(request: GetLifestyleWorkspaceRequest): GetLifestyleWorkspaceResult {
      const actorResult = resolveTrustedActor(authenticationSessionService)
      if (actorResult.status !== 'VALID') return statusResult(actorResult.statusCode)

      const command = parseGetCommand(request)
      if (command === null) return statusResult('VALIDATION_FAILED')

      const locationResult = installationLocationService.resolveConfiguredInstallationLocation()
      if (locationResult.status !== 'RESOLVED') return statusResult(locationResult.status)

      try {
        return transactionExecutor.run<GetLifestyleWorkspaceResult>((context) => {
          const encounterContext = validateEncounterContext(
            context.connection,
            command.encounterId,
            locationResult.location.id,
            {
              installationRepository,
              locationRepository,
              screeningSessionRepository,
              screeningEncounterRepository
            }
          )
          if (encounterContext.status !== 'VALID') return statusResult(encounterContext.statusCode)

          const draft = lifestyleRepository.findDraftByEncounterForWrite(
            context.connection,
            command.encounterId
          )
          if (draft !== null && !matchesContext(draft, encounterContext.context)) {
            return statusResult('UNAVAILABLE')
          }

          return Object.freeze({
            status: 'LOADED' as const,
            workspace: loadWorkspace(
              lifestyleRepository,
              context.connection,
              command.encounterId,
              draft,
              encounterContext.context
            )
          })
        })
      } catch {
        return statusResult('UNAVAILABLE')
      }
    },

    saveAlcoholBaseline(request: SaveLifestyleAlcoholBaselineRequest): SaveLifestyleResult {
      return saveBaseline({
        domain: 'alcohol',
        request,
        action: alcoholBaselineAction,
        operation: 'SCREENING_LIFESTYLE_ALCOHOL_BASELINE_CREATED',
        schemaVersion: 'screening-encounter.lifestyle-alcohol-baseline-created.v1',
        authenticationSessionService,
        currentScreeningSessionService,
        installationLocationService,
        installationRepository,
        locationRepository,
        screeningSessionRepository,
        screeningEncounterRepository,
        lifestyleRepository,
        screeningEncounterOutboxRepository,
        auditEventRepository,
        transactionExecutor
      })
    },

    saveTobaccoBaseline(request: SaveLifestyleTobaccoBaselineRequest): SaveLifestyleResult {
      return saveBaseline({
        domain: 'tobacco',
        request,
        action: tobaccoBaselineAction,
        operation: 'SCREENING_LIFESTYLE_TOBACCO_BASELINE_CREATED',
        schemaVersion: 'screening-encounter.lifestyle-tobacco-baseline-created.v1',
        authenticationSessionService,
        currentScreeningSessionService,
        installationLocationService,
        installationRepository,
        locationRepository,
        screeningSessionRepository,
        screeningEncounterRepository,
        lifestyleRepository,
        screeningEncounterOutboxRepository,
        auditEventRepository,
        transactionExecutor
      })
    },

    saveWorkBaseline(request: SaveLifestyleWorkBaselineRequest): SaveLifestyleResult {
      return saveBaseline({
        domain: 'work',
        request,
        action: workBaselineAction,
        operation: 'SCREENING_LIFESTYLE_WORK_BASELINE_CREATED',
        schemaVersion: 'screening-encounter.lifestyle-work-baseline-created.v1',
        authenticationSessionService,
        currentScreeningSessionService,
        installationLocationService,
        installationRepository,
        locationRepository,
        screeningSessionRepository,
        screeningEncounterRepository,
        lifestyleRepository,
        screeningEncounterOutboxRepository,
        auditEventRepository,
        transactionExecutor
      })
    },

    saveLifestyleDraft(request: SaveLifestyleDraftRequest): SaveLifestyleResult {
      return saveDraft({
        request,
        targetStatus: 'IN_PROGRESS',
        action: draftSavedAction,
        operation: 'SCREENING_LIFESTYLE_DRAFT_SAVED',
        schemaVersion: 'screening-encounter.lifestyle-draft-saved.v1',
        authenticationSessionService,
        currentScreeningSessionService,
        installationLocationService,
        installationRepository,
        locationRepository,
        screeningSessionRepository,
        screeningEncounterRepository,
        lifestyleRepository,
        screeningEncounterOutboxRepository,
        auditEventRepository,
        transactionExecutor
      })
    },

    completeLifestyle(request: CompleteLifestyleRequest): CompleteLifestyleResult {
      return completeDraft({
        request,
        authenticationSessionService,
        currentScreeningSessionService,
        installationLocationService,
        installationRepository,
        locationRepository,
        screeningSessionRepository,
        screeningEncounterRepository,
        lifestyleRepository,
        screeningEncounterOutboxRepository,
        auditEventRepository,
        transactionExecutor
      })
    }
  })
}

type ServiceDependencies = ScreeningLifestyleServiceDependencies

function saveBaseline({
  domain,
  request,
  action,
  operation,
  schemaVersion,
  ...dependencies
}: ServiceDependencies & {
  readonly domain: BaselineDomain
  readonly request:
    | SaveLifestyleAlcoholBaselineRequest
    | SaveLifestyleTobaccoBaselineRequest
    | SaveLifestyleWorkBaselineRequest
  readonly action: ReturnType<typeof parseAuditActionCode>
  readonly operation:
    | 'SCREENING_LIFESTYLE_ALCOHOL_BASELINE_CREATED'
    | 'SCREENING_LIFESTYLE_TOBACCO_BASELINE_CREATED'
    | 'SCREENING_LIFESTYLE_WORK_BASELINE_CREATED'
  readonly schemaVersion:
    | 'screening-encounter.lifestyle-alcohol-baseline-created.v1'
    | 'screening-encounter.lifestyle-tobacco-baseline-created.v1'
    | 'screening-encounter.lifestyle-work-baseline-created.v1'
}): SaveLifestyleResult {
  const actorResult = resolveTrustedActor(dependencies.authenticationSessionService)
  if (actorResult.status !== 'VALID') return statusResult(actorResult.statusCode)

  const command = parseBaselineCommand(request, domain)
  if (command === null) return statusResult('VALIDATION_FAILED')

  const locationResult =
    dependencies.installationLocationService.resolveConfiguredInstallationLocation()
  if (locationResult.status !== 'RESOLVED') return statusResult(locationResult.status)

  try {
    return dependencies.transactionExecutor.run<SaveLifestyleResult>((context) => {
      const occurredAt = context.nowUtc()
      const encounterContext = validateEncounterContext(
        context.connection,
        command.encounterId,
        locationResult.location.id,
        dependencies
      )
      if (encounterContext.status !== 'VALID') return statusResult(encounterContext.statusCode)

      let draft = dependencies.lifestyleRepository.findDraftByEncounterForWrite(
        context.connection,
        command.encounterId
      )
      if (draft !== null && !matchesContext(draft, encounterContext.context)) {
        return statusResult('UNAVAILABLE')
      }
      const versionStatus = validateExpectedVersion(
        draft?.rowVersion ?? null,
        command.expectedDraftVersion
      )
      if (versionStatus !== null) return statusResult(versionStatus)

      let baselineInput: LifestyleBaselineInput
      try {
        baselineInput = createBaselineInput(
          domain,
          command.fields,
          context.newEntityId(),
          encounterContext.context,
          command.expectedBaselineVersion,
          actorResult.actor.userId,
          occurredAt
        )
      } catch {
        return statusResult('VALIDATION_FAILED')
      }

      if (draft === null) {
        const currentSessionStatus = requireCurrentSession(
          dependencies.currentScreeningSessionService,
          context.connection,
          occurredAt,
          encounterContext.context.encounter.screeningSessionId
        )
        if (currentSessionStatus !== null) return statusResult(currentSessionStatus)
      }

      const baselineResult = insertBaseline(
        dependencies.lifestyleRepository,
        domain,
        context.connection,
        baselineInput
      )
      if (baselineResult.status === 'VERSION_CONFLICT') return statusResult('VERSION_CONFLICT')

      if (draft === null) {
        draft = createDraft(
          dependencies.lifestyleRepository,
          context.connection,
          encounterContext.context,
          actorResult.actor.userId,
          occurredAt,
          context.newEntityId()
        )
      }
      if (draft === null) throw new RepositoryDataIntegrityError()

      const references = referencesWithBaseline(draft, domain, baselineResult.record.id)
      const referenceResult = dependencies.lifestyleRepository.updateDraftBaselineReferences(
        context.connection,
        {
          id: draft.id,
          expectedRowVersion: draft.rowVersion,
          ...references,
          actorId: actorResult.actor.userId,
          occurredAt
        }
      )
      if (referenceResult.status !== 'UPDATED') throw new RepositoryDataIntegrityError()

      insertLifestyleEvents({
        dependencies,
        connection: context.connection,
        installation: encounterContext.context.installation,
        actorId: actorResult.actor.userId,
        encounter: encounterContext.context.encounter,
        draft: referenceResult.draft,
        action,
        operation,
        schemaVersion,
        occurredAt,
        baselineDomain: domain,
        baselineId: baselineResult.record.id,
        baselineVersion: baselineResult.record.version,
        auditId: context.newEntityId(),
        outboxId: context.newEntityId()
      })

      return savedWorkspaceResult(
        dependencies.lifestyleRepository,
        context.connection,
        command.encounterId,
        encounterContext.context
      )
    })
  } catch {
    return statusResult('UNAVAILABLE')
  }
}

function saveDraft({
  request,
  targetStatus,
  action,
  operation,
  schemaVersion,
  ...dependencies
}: ServiceDependencies & {
  readonly request: SaveLifestyleDraftRequest
  readonly targetStatus: 'IN_PROGRESS'
  readonly action: ReturnType<typeof parseAuditActionCode>
  readonly operation: 'SCREENING_LIFESTYLE_DRAFT_SAVED'
  readonly schemaVersion: 'screening-encounter.lifestyle-draft-saved.v1'
}): SaveLifestyleResult {
  const actorResult = resolveTrustedActor(dependencies.authenticationSessionService)
  if (actorResult.status !== 'VALID') return statusResult(actorResult.statusCode)

  const command = parseDraftCommand(request)
  if (command === null) return statusResult('VALIDATION_FAILED')

  const locationResult =
    dependencies.installationLocationService.resolveConfiguredInstallationLocation()
  if (locationResult.status !== 'RESOLVED') return statusResult(locationResult.status)

  try {
    return dependencies.transactionExecutor.run<SaveLifestyleResult>((context) => {
      const occurredAt = context.nowUtc()
      const encounterContext = validateEncounterContext(
        context.connection,
        command.encounterId,
        locationResult.location.id,
        dependencies
      )
      if (encounterContext.status !== 'VALID') return statusResult(encounterContext.statusCode)

      let existing = dependencies.lifestyleRepository.findDraftByEncounterForWrite(
        context.connection,
        command.encounterId
      )
      if (existing !== null && !matchesContext(existing, encounterContext.context)) {
        return statusResult('UNAVAILABLE')
      }
      if (existing === null && command.expectedVersion !== null)
        return statusResult('VERSION_CONFLICT')

      const createdDraft = existing === null
      if (createdDraft) {
        const currentSessionStatus = requireCurrentSession(
          dependencies.currentScreeningSessionService,
          context.connection,
          occurredAt,
          encounterContext.context.encounter.screeningSessionId
        )
        if (currentSessionStatus !== null) return statusResult(currentSessionStatus)
      }

      const draftId = existing?.id ?? context.newEntityId()

      const parsed = normalizeDraftUpdate(
        command.fields,
        context.newEntityId,
        existing?.rowVersion ?? 1,
        targetStatus,
        existing?.alcoholBaselineVersionId ?? null,
        existing?.tobaccoBaselineVersionId ?? null,
        existing?.workBaselineVersionId ?? null,
        actorResult.actor.userId,
        occurredAt,
        draftId
      )
      if (parsed === null) return statusResult('VALIDATION_FAILED')

      if (createdDraft) {
        existing = createDraft(
          dependencies.lifestyleRepository,
          context.connection,
          encounterContext.context,
          actorResult.actor.userId,
          occurredAt,
          draftId
        )
      }
      if (existing === null) throw new RepositoryDataIntegrityError()

      const versionStatus = createdDraft
        ? null
        : validateExpectedVersion(existing.rowVersion, command.expectedVersion)
      if (isDraftEquivalent(existing, parsed, 'IN_PROGRESS'))
        return savedWorkspaceResult(
          dependencies.lifestyleRepository,
          context.connection,
          command.encounterId,
          encounterContext.context
        )
      if (versionStatus !== null) return statusResult(versionStatus)

      const updateResult = dependencies.lifestyleRepository.updateDraft(context.connection, parsed)
      if (updateResult.status !== 'UPDATED') {
        if (createdDraft) throw new RepositoryDataIntegrityError()
        return statusResult('VERSION_CONFLICT')
      }

      insertLifestyleEvents({
        dependencies,
        connection: context.connection,
        installation: encounterContext.context.installation,
        actorId: actorResult.actor.userId,
        encounter: encounterContext.context.encounter,
        draft: updateResult.draft,
        action,
        operation,
        schemaVersion,
        occurredAt,
        auditId: context.newEntityId(),
        outboxId: context.newEntityId()
      })

      return savedWorkspaceResult(
        dependencies.lifestyleRepository,
        context.connection,
        command.encounterId,
        encounterContext.context
      )
    })
  } catch {
    return statusResult('UNAVAILABLE')
  }
}

function completeDraft({
  request,
  ...dependencies
}: ServiceDependencies & {
  readonly request: CompleteLifestyleRequest
}): CompleteLifestyleResult {
  const actorResult = resolveTrustedActor(dependencies.authenticationSessionService)
  if (actorResult.status !== 'VALID') return statusResult(actorResult.statusCode)

  const command = parseDraftCommand(request)
  if (command === null) return statusResult('VALIDATION_FAILED')
  const locationResult =
    dependencies.installationLocationService.resolveConfiguredInstallationLocation()
  if (locationResult.status !== 'RESOLVED') return statusResult(locationResult.status)

  try {
    return dependencies.transactionExecutor.run<CompleteLifestyleResult>((context) => {
      const occurredAt = context.nowUtc()
      const encounterContext = validateEncounterContext(
        context.connection,
        command.encounterId,
        locationResult.location.id,
        dependencies
      )
      if (encounterContext.status !== 'VALID') return statusResult(encounterContext.statusCode)

      const existing = dependencies.lifestyleRepository.findDraftByEncounterForWrite(
        context.connection,
        command.encounterId
      )
      if (existing === null || !matchesContext(existing, encounterContext.context)) {
        return statusResult(existing === null ? 'VALIDATION_FAILED' : 'UNAVAILABLE')
      }
      const versionStatus = validateExpectedVersion(existing.rowVersion, command.expectedVersion)
      if (versionStatus !== null && versionStatus !== 'VERSION_CONFLICT')
        return statusResult(versionStatus)

      const parsed = normalizeDraftUpdate(
        command.fields,
        context.newEntityId,
        existing.rowVersion,
        'COMPLETE',
        existing.alcoholBaselineVersionId,
        existing.tobaccoBaselineVersionId,
        existing.workBaselineVersionId,
        actorResult.actor.userId,
        occurredAt,
        existing.id
      )
      if (parsed === null || !isCompleteLifestyleInput(parsed))
        return statusResult('VALIDATION_FAILED')
      if (
        !hasCompleteBaselineReferences(
          existing,
          dependencies.lifestyleRepository,
          context.connection
        )
      )
        return statusResult('VALIDATION_FAILED')

      if (isDraftEquivalent(existing, parsed, 'COMPLETE'))
        return completedWorkspaceResult(
          dependencies.lifestyleRepository,
          context.connection,
          command.encounterId,
          encounterContext.context
        )
      if (versionStatus === 'VERSION_CONFLICT') return statusResult('VERSION_CONFLICT')

      const updateResult = dependencies.lifestyleRepository.updateDraft(context.connection, parsed)
      if (updateResult.status !== 'UPDATED') return statusResult('VERSION_CONFLICT')

      insertLifestyleEvents({
        dependencies,
        connection: context.connection,
        installation: encounterContext.context.installation,
        actorId: actorResult.actor.userId,
        encounter: encounterContext.context.encounter,
        draft: updateResult.draft,
        action: stepCompletedAction,
        operation: 'SCREENING_LIFESTYLE_STEP_COMPLETED',
        schemaVersion: 'screening-encounter.lifestyle-step-completed.v1',
        occurredAt,
        auditId: context.newEntityId(),
        outboxId: context.newEntityId()
      })

      return completedWorkspaceResult(
        dependencies.lifestyleRepository,
        context.connection,
        command.encounterId,
        encounterContext.context
      )
    })
  } catch {
    return statusResult('UNAVAILABLE')
  }
}

function validateEncounterContext(
  connection: DatabaseTransactionConnection,
  encounterId: EntityId,
  configuredLocationId: EntityId,
  dependencies: Pick<
    ServiceDependencies,
    | 'installationRepository'
    | 'locationRepository'
    | 'screeningSessionRepository'
    | 'screeningEncounterRepository'
  >
):
  | { readonly status: 'VALID'; readonly context: ValidatedContext }
  | { readonly status: 'INVALID'; readonly statusCode: LifestyleServiceControlledStatus } {
  const installation = dependencies.installationRepository.get()
  if (installation === null) return invalidContext('UNAVAILABLE')
  const encounter = dependencies.screeningEncounterRepository.getByIdForWrite(
    connection,
    encounterId
  )
  if (encounter === null || encounter.amendmentOfEncounterId !== null)
    return invalidContext('ENCOUNTER_NOT_FOUND')
  if (encounter.status !== 'DRAFT') return invalidContext('ENCOUNTER_NOT_EDITABLE')

  const session = dependencies.screeningSessionRepository.getByIdForWrite(
    connection,
    encounter.screeningSessionId
  )
  if (session === null) return invalidContext('SESSION_NOT_FOUND')
  const location = dependencies.locationRepository.getByIdForWrite(connection, configuredLocationId)
  if (location === null) return invalidContext('LOCATION_NOT_FOUND')
  if (!location.isActive) return invalidContext('LOCATION_INACTIVE')
  if (session.status !== 'OPEN') return invalidContext('SESSION_CLOSED')
  if (
    encounter.locationId !== configuredLocationId ||
    session.locationId !== configuredLocationId ||
    encounter.screeningSessionId !== session.id
  )
    return invalidContext('SESSION_NOT_CURRENT')

  return { status: 'VALID', context: { installation, encounter, session } }
}

function requireCurrentSession(
  service: ServiceDependencies['currentScreeningSessionService'],
  connection: DatabaseTransactionConnection,
  occurredAt: UtcTimestamp,
  encounterSessionId: EntityId
): LifestyleServiceControlledStatus | null {
  const result = service.findCurrentScreeningSessionInTransaction({ connection, occurredAt })
  if (result.status === 'FOUND') {
    return result.session.id === encounterSessionId ? null : 'SESSION_NOT_CURRENT'
  }
  if (result.status === 'SESSION_CLOSED') return 'SESSION_CLOSED'
  if (result.status === 'SESSION_NOT_FOUND') return 'SESSION_NOT_CURRENT'
  return result.status
}

function createDraft(
  repository: LifestyleRepository,
  connection: DatabaseTransactionConnection,
  context: ValidatedContext,
  actorId: EntityId,
  occurredAt: UtcTimestamp,
  id: EntityId
): LifestyleDraftRecord {
  const periodEnd = context.session.sessionDate as unknown as LifestyleDraftRecord['periodEnd']
  const periodStart = shiftLifestyleDate(periodEnd, -6)
  return repository.insertDraft(connection, {
    id,
    encounterId: context.encounter.id,
    patientId: context.encounter.patientId,
    screeningSessionId: context.encounter.screeningSessionId,
    locationId: context.encounter.locationId,
    installationId: context.installation.id,
    periodStart,
    periodEnd,
    actorId,
    occurredAt
  })
}

function loadWorkspace(
  repository: LifestyleRepository,
  connection: DatabaseTransactionConnection,
  encounterId: EntityId,
  draft: LifestyleDraftRecord | null,
  context: ValidatedContext
): LifestyleWorkspaceSummary {
  const patientId = context.encounter.patientId
  const installationId = context.installation.id
  const activeAlcoholBaseline = repository.findActiveAlcoholBaselineForWrite(
    connection,
    patientId,
    installationId
  )
  const activeTobaccoBaseline = repository.findActiveTobaccoBaselineForWrite(
    connection,
    patientId,
    installationId
  )
  const activeWorkBaseline = repository.findActiveWorkBaselineForWrite(
    connection,
    patientId,
    installationId
  )
  return deepFreeze({
    encounterId,
    draft,
    activeAlcoholBaseline,
    activeTobaccoBaseline,
    activeWorkBaseline,
    referencedAlcoholBaseline:
      draft?.alcoholBaselineVersionId === null || draft?.alcoholBaselineVersionId === undefined
        ? null
        : repository.findAlcoholBaselineByIdForWrite(
            connection,
            draft.alcoholBaselineVersionId,
            patientId,
            installationId
          ),
    referencedTobaccoBaseline:
      draft?.tobaccoBaselineVersionId === null || draft?.tobaccoBaselineVersionId === undefined
        ? null
        : repository.findTobaccoBaselineByIdForWrite(
            connection,
            draft.tobaccoBaselineVersionId,
            patientId,
            installationId
          ),
    referencedWorkBaseline:
      draft?.workBaselineVersionId === null || draft?.workBaselineVersionId === undefined
        ? null
        : repository.findWorkBaselineByIdForWrite(
            connection,
            draft.workBaselineVersionId,
            patientId,
            installationId
          )
  })
}

function savedWorkspaceResult(
  repository: LifestyleRepository,
  connection: DatabaseTransactionConnection,
  encounterId: EntityId,
  context: ValidatedContext
): SaveLifestyleResult {
  const draft = repository.findDraftByEncounterForWrite(connection, encounterId)
  if (draft === null) throw new RepositoryDataIntegrityError()
  return {
    status: 'SAVED',
    workspace: loadWorkspace(repository, connection, encounterId, draft, context)
  }
}

function completedWorkspaceResult(
  repository: LifestyleRepository,
  connection: DatabaseTransactionConnection,
  encounterId: EntityId,
  context: ValidatedContext
): CompleteLifestyleResult {
  const draft = repository.findDraftByEncounterForWrite(connection, encounterId)
  if (draft === null) throw new RepositoryDataIntegrityError()
  return {
    status: 'COMPLETED',
    workspace: loadWorkspace(repository, connection, encounterId, draft, context)
  }
}

type LifestyleBaselineInput =
  LifestyleAlcoholBaselineInput | LifestyleTobaccoBaselineInput | LifestyleWorkBaselineInput

function createBaselineInput(
  domain: BaselineDomain,
  fields: Record<string, unknown>,
  id: EntityId,
  context: ValidatedContext,
  expectedCurrentVersion: number | null,
  actorId: EntityId,
  occurredAt: UtcTimestamp
): LifestyleBaselineInput {
  const common = {
    ...fields,
    id,
    patientId: context.encounter.patientId,
    installationId: context.installation.id,
    expectedCurrentVersion,
    actorId,
    occurredAt
  }
  if (domain === 'alcohol')
    return parseLifestyleAlcoholBaselineInput(common as LifestyleAlcoholBaselineInput)
  if (domain === 'tobacco')
    return parseLifestyleTobaccoBaselineInput(common as LifestyleTobaccoBaselineInput)
  return parseLifestyleWorkBaselineInput(common as LifestyleWorkBaselineInput)
}

function insertBaseline(
  repository: LifestyleRepository,
  domain: BaselineDomain,
  connection: DatabaseTransactionConnection,
  input: LifestyleBaselineInput
):
  | ReturnType<LifestyleRepository['insertAlcoholBaseline']>
  | ReturnType<LifestyleRepository['insertTobaccoBaseline']>
  | ReturnType<LifestyleRepository['insertWorkBaseline']> {
  if (domain === 'alcohol')
    return repository.insertAlcoholBaseline(connection, input as LifestyleAlcoholBaselineInput)
  if (domain === 'tobacco')
    return repository.insertTobaccoBaseline(connection, input as LifestyleTobaccoBaselineInput)
  return repository.insertWorkBaseline(connection, input as LifestyleWorkBaselineInput)
}

function referencesWithBaseline(
  draft: LifestyleDraftRecord,
  domain: BaselineDomain,
  baselineId: EntityId
): {
  readonly alcoholBaselineVersionId: EntityId | null
  readonly tobaccoBaselineVersionId: EntityId | null
  readonly workBaselineVersionId: EntityId | null
} {
  return {
    alcoholBaselineVersionId: domain === 'alcohol' ? baselineId : draft.alcoholBaselineVersionId,
    tobaccoBaselineVersionId: domain === 'tobacco' ? baselineId : draft.tobaccoBaselineVersionId,
    workBaselineVersionId: domain === 'work' ? baselineId : draft.workBaselineVersionId
  }
}

function insertLifestyleEvents({
  dependencies,
  connection,
  installation,
  actorId,
  encounter,
  draft,
  action,
  operation,
  schemaVersion,
  occurredAt,
  auditId,
  outboxId,
  baselineDomain,
  baselineId,
  baselineVersion
}: {
  readonly dependencies: ServiceDependencies
  readonly connection: DatabaseTransactionConnection
  readonly installation: InstallationRecord
  readonly actorId: EntityId
  readonly encounter: ScreeningEncounterRecord
  readonly draft: LifestyleDraftRecord
  readonly action: ReturnType<typeof parseAuditActionCode>
  readonly operation: Parameters<
    ServiceDependencies['screeningEncounterOutboxRepository']['insert']
  >[1]['operation']
  readonly schemaVersion: Parameters<
    ServiceDependencies['screeningEncounterOutboxRepository']['insert']
  >[1]['payloadSchemaVersion']
  readonly occurredAt: UtcTimestamp
  readonly auditId: EntityId
  readonly outboxId: EntityId
  readonly baselineDomain?: BaselineDomain
  readonly baselineId?: EntityId
  readonly baselineVersion?: number
}): void {
  const metadata = createEventMetadata(draft, baselineDomain, baselineId, baselineVersion)
  dependencies.auditEventRepository.insert(connection, {
    id: auditId,
    installationId: installation.id,
    userId: actorId,
    action,
    entityType: screeningEncounterEntityType,
    entityId: encounter.id,
    occurredAt,
    metadata
  })
  dependencies.screeningEncounterOutboxRepository.insert(connection, {
    id: outboxId,
    aggregateId: encounter.id,
    operation,
    payloadSchemaVersion: schemaVersion,
    createdAt: occurredAt,
    payload: metadata
  })
}

function createEventMetadata(
  draft: LifestyleDraftRecord,
  baselineDomain?: BaselineDomain,
  baselineId?: EntityId,
  baselineVersion?: number
): AuditMetadata {
  const metadata: Record<string, string | number> = {
    draft_id: draft.id,
    encounter_id: draft.encounterId,
    draft_status: draft.status,
    row_version: draft.rowVersion,
    alcohol_baseline_reference_id: draft.alcoholBaselineVersionId ?? '',
    tobacco_baseline_reference_id: draft.tobaccoBaselineVersionId ?? '',
    work_baseline_reference_id: draft.workBaselineVersionId ?? '',
    alcohol_record_count: draft.alcohol === null ? 0 : 1,
    tobacco_product_count: draft.tobacco?.products.length ?? 0,
    activity_row_count: draft.physicalActivity?.activities.length ?? 0,
    other_activity_row_count: draft.otherActivities.length
  }
  if (baselineDomain !== undefined) metadata.baseline_domain = baselineDomain
  if (baselineId !== undefined) metadata.baseline_version_id = baselineId
  if (baselineVersion !== undefined) metadata.baseline_version_number = baselineVersion
  return Object.freeze(metadata)
}

function normalizeDraftUpdate(
  fields: Record<string, unknown>,
  newEntityId: () => EntityId,
  expectedRowVersion: number,
  status: 'IN_PROGRESS' | 'COMPLETE',
  alcoholBaselineVersionId: EntityId | null,
  tobaccoBaselineVersionId: EntityId | null,
  workBaselineVersionId: EntityId | null,
  actorId: EntityId,
  occurredAt: UtcTimestamp,
  draftId: EntityId
): LifestyleDraftUpdateInput | null {
  try {
    const alcohol = normalizeAlcohol(
      fields.alcohol,
      newEntityId
    ) as LifestyleAlcoholWeeklyInput | null
    const tobacco = normalizeTobacco(
      fields.tobacco,
      newEntityId
    ) as LifestyleTobaccoWeeklyInput | null
    const physicalActivity = normalizePhysical(
      fields.physicalActivity,
      newEntityId
    ) as LifestylePhysicalActivityWeeklyInput | null
    const work = normalizeWork(fields.work, newEntityId) as LifestyleWorkWeeklyInput | null
    const otherActivities = normalizeOtherActivities(
      fields.otherActivities,
      newEntityId
    ) as readonly LifestyleOtherActivityInput[]
    return parseLifestyleDraftUpdateInput({
      id: draftId,
      expectedRowVersion,
      status,
      alcoholBaselineVersionId,
      tobaccoBaselineVersionId,
      workBaselineVersionId,
      actorId,
      occurredAt,
      alcohol,
      tobacco,
      physicalActivity,
      work,
      otherActivities
    })
  } catch {
    return null
  }
}

function normalizeAlcohol(value: unknown, newEntityId: () => EntityId): unknown {
  if (value === null) return null
  const data = readDataProperties(value, [
    'id',
    'weeklyResponse',
    'drinkingDays',
    'totalStandardizedDrinks',
    'largestOneDayAmount',
    'daysAtLargestAmount',
    'commonBeverageTypes',
    'otherBeverageDescription'
  ])
  return { ...data, id: normalizeId(data.id, newEntityId) }
}

function normalizeTobacco(value: unknown, newEntityId: () => EntityId): unknown {
  if (value === null) return null
  const data = readDataProperties(value, ['id', 'weeklyResponse', 'products'])
  return {
    ...data,
    id: normalizeId(data.id, newEntityId),
    products: normalizeRows(data.products, newEntityId, [
      'id',
      'sequenceNumber',
      'productType',
      'daysUsed',
      'averageQuantityPerUseDay',
      'unit',
      'secondhandSmokeExposure',
      'otherProductDescription',
      'otherUnitDescription'
    ])
  }
}

function normalizePhysical(value: unknown, newEntityId: () => EntityId): unknown {
  if (value === null) return null
  const data = readDataProperties(value, [
    'id',
    'weeklyResponse',
    'sedentaryMinutesPerDay',
    'activities'
  ])
  return {
    ...data,
    id: normalizeId(data.id, newEntityId),
    activities: normalizeRows(data.activities, newEntityId, [
      'id',
      'sequenceNumber',
      'activityDomain',
      'description',
      'intensity',
      'daysInPastSevenDays',
      'averageMinutesPerActiveDay'
    ])
  }
}

function normalizeWork(value: unknown, newEntityId: () => EntityId): unknown {
  if (value === null) return null
  const data = readDataProperties(value, ['id', 'weeklyResponse'])
  return { ...data, id: normalizeId(data.id, newEntityId) }
}

function normalizeOtherActivities(value: unknown, newEntityId: () => EntityId): readonly unknown[] {
  return normalizeRows(value, newEntityId, [
    'id',
    'sequenceNumber',
    'category',
    'description',
    'daysInPastSevenDays',
    'averageMinutesPerDay',
    'intensity'
  ])
}

function normalizeRows(
  value: unknown,
  newEntityId: () => EntityId,
  keys: readonly string[]
): readonly Record<string, unknown>[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype)
    throw new RepositoryValidationError()
  return value.map((item) => {
    const data = readDataProperties(item, keys)
    return { ...data, id: normalizeId(data.id, newEntityId) }
  })
}

function normalizeId(value: unknown, newEntityId: () => EntityId): EntityId {
  return value === null ? newEntityId() : parseEntityId(value)
}

function isCompleteLifestyleInput(input: LifestyleDraftUpdateInput): boolean {
  if (
    input.alcohol === null ||
    input.tobacco === null ||
    input.physicalActivity === null ||
    input.work === null ||
    input.alcohol.weeklyResponse === null ||
    input.tobacco.weeklyResponse === null ||
    input.physicalActivity.weeklyResponse === null ||
    input.work.weeklyResponse === null
  )
    return false
  try {
    parseCompleteLifestyleAlcoholWeeklyInput(input.alcohol)
    parseCompleteLifestyleTobaccoWeeklyInput(input.tobacco)
    parseCompleteLifestylePhysicalActivityWeeklyInput(input.physicalActivity)
    return true
  } catch {
    return false
  }
}

function hasCompleteBaselineReferences(
  draft: LifestyleDraftRecord,
  repository: LifestyleRepository,
  connection: DatabaseTransactionConnection
): boolean {
  return (
    draft.alcoholBaselineVersionId !== null &&
    draft.tobaccoBaselineVersionId !== null &&
    draft.workBaselineVersionId !== null &&
    repository.findAlcoholBaselineByIdForWrite(
      connection,
      draft.alcoholBaselineVersionId,
      draft.patientId,
      draft.installationId
    ) !== null &&
    repository.findTobaccoBaselineByIdForWrite(
      connection,
      draft.tobaccoBaselineVersionId,
      draft.patientId,
      draft.installationId
    ) !== null &&
    repository.findWorkBaselineByIdForWrite(
      connection,
      draft.workBaselineVersionId,
      draft.patientId,
      draft.installationId
    ) !== null
  )
}

function isDraftEquivalent(
  existing: LifestyleDraftRecord,
  input: LifestyleDraftUpdateInput,
  status: LifestyleDraftRecord['status']
): boolean {
  return (
    existing.status === status &&
    existing.alcoholBaselineVersionId === input.alcoholBaselineVersionId &&
    existing.tobaccoBaselineVersionId === input.tobaccoBaselineVersionId &&
    existing.workBaselineVersionId === input.workBaselineVersionId &&
    sameAlcohol(existing.alcohol, input.alcohol) &&
    sameTobacco(existing.tobacco, input.tobacco) &&
    samePhysical(existing.physicalActivity, input.physicalActivity) &&
    sameWork(existing.work, input.work) &&
    sameOtherActivities(existing.otherActivities, input.otherActivities)
  )
}

function sameAlcohol(
  existing: LifestyleDraftRecord['alcohol'],
  next: LifestyleDraftUpdateInput['alcohol']
): boolean {
  if (existing === null || next === null) return existing === next
  return (
    existing.id === next.id &&
    existing.weeklyResponse === next.weeklyResponse &&
    existing.drinkingDays === next.drinkingDays &&
    existing.totalStandardizedDrinks === next.totalStandardizedDrinks &&
    existing.largestOneDayAmount === next.largestOneDayAmount &&
    existing.daysAtLargestAmount === next.daysAtLargestAmount &&
    sameArray(existing.commonBeverageTypes, next.commonBeverageTypes) &&
    existing.otherBeverageDescription === next.otherBeverageDescription
  )
}

function sameTobacco(
  existing: LifestyleDraftRecord['tobacco'],
  next: LifestyleDraftUpdateInput['tobacco']
): boolean {
  if (existing === null || next === null) return existing === next
  return (
    existing.id === next.id &&
    existing.weeklyResponse === next.weeklyResponse &&
    existing.products.length === next.products.length &&
    existing.products.every((row, index) => sameProduct(row, next.products[index]))
  )
}

function sameProduct(
  existing: NonNullable<LifestyleDraftRecord['tobacco']>['products'][number],
  next: NonNullable<LifestyleDraftUpdateInput['tobacco']>['products'][number] | undefined
): boolean {
  return (
    next !== undefined &&
    existing.id === next.id &&
    existing.sequenceNumber === next.sequenceNumber &&
    existing.productType === next.productType &&
    existing.daysUsed === next.daysUsed &&
    existing.averageQuantityPerUseDay === next.averageQuantityPerUseDay &&
    existing.unit === next.unit &&
    existing.secondhandSmokeExposure === next.secondhandSmokeExposure &&
    existing.otherProductDescription === next.otherProductDescription &&
    existing.otherUnitDescription === next.otherUnitDescription
  )
}

function samePhysical(
  existing: LifestyleDraftRecord['physicalActivity'],
  next: LifestyleDraftUpdateInput['physicalActivity']
): boolean {
  if (existing === null || next === null) return existing === next
  return (
    existing.id === next.id &&
    existing.weeklyResponse === next.weeklyResponse &&
    existing.sedentaryMinutesPerDay === next.sedentaryMinutesPerDay &&
    existing.activities.length === next.activities.length &&
    existing.activities.every((row, index) => {
      const candidate = next.activities[index]
      return (
        candidate !== undefined &&
        row.id === candidate.id &&
        row.sequenceNumber === candidate.sequenceNumber &&
        row.activityDomain === candidate.activityDomain &&
        row.description === candidate.description &&
        row.intensity === candidate.intensity &&
        row.daysInPastSevenDays === candidate.daysInPastSevenDays &&
        row.averageMinutesPerActiveDay === candidate.averageMinutesPerActiveDay
      )
    })
  )
}

function sameWork(
  existing: LifestyleDraftRecord['work'],
  next: LifestyleDraftUpdateInput['work']
): boolean {
  return existing === null || next === null
    ? existing === next
    : existing.id === next.id && existing.weeklyResponse === next.weeklyResponse
}

function sameOtherActivities(
  existing: LifestyleDraftRecord['otherActivities'],
  next: LifestyleDraftUpdateInput['otherActivities']
): boolean {
  return (
    existing.length === next.length &&
    existing.every((row, index) => {
      const candidate = next[index]
      return (
        candidate !== undefined &&
        row.id === candidate.id &&
        row.sequenceNumber === candidate.sequenceNumber &&
        row.category === candidate.category &&
        row.description === candidate.description &&
        row.daysInPastSevenDays === candidate.daysInPastSevenDays &&
        row.averageMinutesPerDay === candidate.averageMinutesPerDay &&
        row.intensity === candidate.intensity
      )
    })
  )
}

function sameArray(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function parseGetCommand(request: unknown): ParsedGetCommand | null {
  try {
    const data = readDataProperties(request, getRequestKeys)
    return { encounterId: parseEntityId(data.encounterId) }
  } catch {
    return null
  }
}

function parseBaselineCommand(
  request: unknown,
  domain: BaselineDomain
): ParsedBaselineCommand | null {
  try {
    const keys = [
      ...baselineCommonKeys,
      ...(domain === 'alcohol'
        ? [
            'status',
            'everConsumed',
            'consumedPast12Months',
            'commonBeverageTypes',
            'otherBeverageDescription'
          ]
        : domain === 'tobacco'
          ? [
              'status',
              'everRegularlyUsed',
              'formerUseApproximateStopDate',
              'currentUseFrequency',
              'productTypes',
              'otherProductDescription'
            ]
          : [
              'status',
              'occupationJobTitle',
              'usualPhysicalDemand',
              'typicalWorkdaysPerWeek',
              'typicalHoursPerWorkday',
              'shiftPattern',
              'description'
            ])
    ]
    const data = readDataProperties(request, keys)
    const fields: Record<string, unknown> = {}
    for (const key of keys.slice(baselineCommonKeys.length)) fields[key] = data[key]
    return {
      encounterId: parseEntityId(data.encounterId),
      expectedBaselineVersion: parseExpectedVersion(data.expectedBaselineVersion),
      expectedDraftVersion: parseExpectedVersion(data.expectedDraftVersion),
      fields
    }
  } catch {
    return null
  }
}

function parseDraftCommand(request: unknown): ParsedDraftCommand | null {
  try {
    const data = readDataProperties(request, draftRequestKeys)
    return {
      encounterId: parseEntityId(data.encounterId),
      expectedVersion: parseExpectedVersion(data.expectedVersion),
      fields: data
    }
  } catch {
    return null
  }
}

function parseExpectedVersion(value: unknown): number | null {
  if (value === null) return null
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) throw new Error()
  return value
}

function validateExpectedVersion(
  current: number | null,
  expected: number | null
): LifestyleServiceControlledStatus | null {
  if (current === null) return expected === null ? null : 'VERSION_CONFLICT'
  return expected === current ? null : 'VERSION_CONFLICT'
}

function matchesContext(draft: LifestyleDraftRecord, context: ValidatedContext): boolean {
  return (
    draft.encounterId === context.encounter.id &&
    draft.patientId === context.encounter.patientId &&
    draft.screeningSessionId === context.encounter.screeningSessionId &&
    draft.locationId === context.encounter.locationId &&
    draft.installationId === context.installation.id
  )
}

function resolveTrustedActor(
  authenticationSessionService: ServiceDependencies['authenticationSessionService']
):
  | { readonly status: 'VALID'; readonly actor: ValidatedActor }
  | { readonly status: 'INVALID'; readonly statusCode: LifestyleServiceControlledStatus } {
  try {
    const context = authenticationSessionService.requireAnyRole(allowedRoles)
    return { status: 'VALID', actor: { userId: context.user.id } }
  } catch (error) {
    return { status: 'INVALID', statusCode: mapAuthenticationFailure(error) }
  }
}

function mapAuthenticationFailure(error: unknown): LifestyleServiceControlledStatus {
  if (
    error instanceof LocalSessionUnauthenticatedError ||
    error instanceof LocalSessionLockedError ||
    error instanceof LocalSessionPasswordChangeRequiredError
  )
    return 'AUTHENTICATION_REQUIRED'
  if (error instanceof LocalSessionAuthorizationError) return 'FORBIDDEN'
  if (isLocalSessionError(error)) return 'UNAVAILABLE'
  return 'UNAVAILABLE'
}

function invalidContext(statusCode: LifestyleServiceControlledStatus): {
  readonly status: 'INVALID'
  readonly statusCode: LifestyleServiceControlledStatus
} {
  return { status: 'INVALID' as const, statusCode }
}

function statusResult(status: LifestyleServiceControlledStatus): {
  readonly status: LifestyleServiceControlledStatus
} {
  return Object.freeze({ status })
}

function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (typeof value !== 'object' || value === null || seen.has(value)) return value
  seen.add(value)
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child, seen)
  return Object.freeze(value)
}

function shiftLifestyleDate(
  value: string,
  days: number
): string & { readonly __brand: 'LifestyleDate' } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value)
  if (match === null) throw new RepositoryDataIntegrityError()
  let year = Number(match[1])
  let month = Number(match[2])
  let day = Number(match[3])
  if (!isValidCalendarDate(year, month, day)) throw new RepositoryDataIntegrityError()
  let remaining = Math.abs(days)
  const direction = days < 0 ? -1 : 1
  while (remaining > 0) {
    day += direction
    if (day < 1) {
      month -= 1
      if (month < 1) {
        month = 12
        year -= 1
      }
      day = daysInMonth(year, month)
    } else if (day > daysInMonth(year, month)) {
      day = 1
      month += 1
      if (month > 12) {
        month = 1
        year += 1
      }
    }
    remaining -= 1
  }
  if (year < 1 || year > 9999) throw new RepositoryDataIntegrityError()
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}` as string & {
    readonly __brand: 'LifestyleDate'
  }
}

function isValidCalendarDate(year: number, month: number, day: number): boolean {
  return (
    year >= 1 &&
    year <= 9999 &&
    month >= 1 &&
    month <= 12 &&
    day >= 1 &&
    day <= daysInMonth(year, month)
  )
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return year % 400 === 0 || (year % 4 === 0 && year % 100 !== 0) ? 29 : 28
  return [4, 6, 9, 11].includes(month) ? 30 : 31
}
