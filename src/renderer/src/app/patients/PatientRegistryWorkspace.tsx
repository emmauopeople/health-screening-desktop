import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { RefObject } from 'react'

import type {
  HealthScreeningApi,
  PatientEditableFields,
  PublicPatientDetail,
  PublicPatientDuplicateCandidate,
  PublicPatientDuplicatePair,
  PublicPatientSummary
} from '@shared/ipc'

import type { ApplicationCommandId } from '../shell/application-shell-types'

interface PatientRegistryWorkspaceProps {
  readonly api: HealthScreeningApi
  readonly commandId:
    | 'PATIENTS_PATIENT_SEARCH'
    | 'PATIENTS_REGISTER_NEW_PATIENT'
    | 'PATIENTS_RECENT_PATIENTS'
    | 'PATIENTS_POSSIBLE_DUPLICATES'
  readonly headingId: string
  readonly headingRef: RefObject<HTMLHeadingElement | null>
  readonly selectedPatient: PublicPatientDetail | null
  onSelectedPatientChange(patient: PublicPatientDetail | null): void
  onSelectCommand(commandId: ApplicationCommandId): void
}

const emptyEditableFields: PatientEditableFields = Object.freeze({
  givenName: null,
  familyName: null,
  otherNames: null,
  dateOfBirth: null,
  approximateAgeYears: null,
  ageAsOfDate: null,
  sex: 'UNKNOWN',
  village: null,
  quarter: null,
  phone: null,
  alternateContactName: null,
  alternateContactPhone: null,
  residenceNotes: null,
  status: 'ACTIVE',
  acknowledgmentStatus: 'NOT_REQUESTED'
})

export function PatientRegistryWorkspace({
  api,
  commandId,
  headingId,
  headingRef,
  selectedPatient,
  onSelectedPatientChange,
  onSelectCommand
}: PatientRegistryWorkspaceProps): React.JSX.Element {
  const [editMode, setEditMode] = useState(false)
  const [draft, setDraft] = useState<PatientEditableFields>(emptyEditableFields)
  const [editDirty, setEditDirty] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [showDirtyGuard, setShowDirtyGuard] = useState(false)
  const pendingDirtyAction = useRef<(() => void) | null>(null)
  const searchInputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    const listener = (event: KeyboardEvent): void => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'k') {
        return
      }

      event.preventDefault()
      onSelectCommand('PATIENTS_PATIENT_SEARCH')
      window.setTimeout(() => searchInputRef.current?.focus({ preventScroll: true }), 0)
    }

    window.addEventListener('keydown', listener)

    return () => window.removeEventListener('keydown', listener)
  }, [onSelectCommand])

  const guardedAction = useCallback(
    (action: () => void) => {
      if (!editDirty) {
        action()
        return
      }

      pendingDirtyAction.current = action
      setShowDirtyGuard(true)
    },
    [editDirty]
  )

  const selectPatient = useCallback(
    (patientId: string) => {
      guardedAction(() => {
        void loadPatient(api, patientId, onSelectedPatientChange, setMessage).then((patient) => {
          if (patient !== null) {
            setEditMode(false)
            setEditDirty(false)
          }
        })
      })
    },
    [api, guardedAction, onSelectedPatientChange]
  )

  const saveDraft = useCallback(async (): Promise<boolean> => {
    if (selectedPatient === null) {
      return false
    }

    setSaving(true)
    setMessage(null)

    try {
      const result = await api.patient.update({
        patientId: selectedPatient.id,
        expectedRowVersion: selectedPatient.rowVersion,
        patch: draft
      })

      if (!result.ok) {
        setMessage(result.error.message)
        return false
      }

      onSelectedPatientChange(result.data.patient)
      setDraft(detailToEditable(result.data.patient))
      setEditDirty(false)

      if (result.data.status === 'PATIENT_VERSION_CONFLICT') {
        setMessage('The patient changed after you opened it. Review the latest details.')
        return false
      }

      setEditMode(false)
      setMessage('Changes saved.')
      return true
    } finally {
      setSaving(false)
    }
  }, [api, draft, onSelectedPatientChange, selectedPatient])

  const discardDraft = useCallback(() => {
    if (selectedPatient !== null) {
      setDraft(detailToEditable(selectedPatient))
    }

    setEditDirty(false)
    setEditMode(false)
    setMessage(null)
  }, [selectedPatient])

  const completePendingAction = useCallback(() => {
    const action = pendingDirtyAction.current
    pendingDirtyAction.current = null
    setShowDirtyGuard(false)
    action?.()
  }, [])

  const heading = useMemo(() => {
    switch (commandId) {
      case 'PATIENTS_REGISTER_NEW_PATIENT':
        return 'Register New Patient'
      case 'PATIENTS_RECENT_PATIENTS':
        return 'Recent Patients'
      case 'PATIENTS_POSSIBLE_DUPLICATES':
        return 'Possible Duplicates'
      case 'PATIENTS_PATIENT_SEARCH':
        return 'Patient Search and Management'
    }
  }, [commandId])

  return (
    <>
      <header className="application-workspace-heading patient-workspace-heading">
        <h1 ref={headingRef} id={headingId} tabIndex={-1}>
          {heading}
        </h1>
      </header>

      {message !== null ? (
        <div className="patient-alert" role="status">
          {message}
        </div>
      ) : null}

      {commandId === 'PATIENTS_REGISTER_NEW_PATIENT' ? (
        <PatientRegistrationWorkspace
          api={api}
          onMessage={setMessage}
          onPatientCreated={(patient) => {
            onSelectedPatientChange(patient)
            setEditMode(false)
            setEditDirty(false)
            onSelectCommand('PATIENTS_PATIENT_SEARCH')
          }}
          onCancel={() => onSelectCommand('PATIENTS_PATIENT_SEARCH')}
        />
      ) : (
        <div className="patient-management-layout">
          <section className="patient-list-pane" aria-label={heading}>
            {commandId === 'PATIENTS_PATIENT_SEARCH' ? (
              <PatientSearchPane
                api={api}
                selectedPatientId={selectedPatient?.id ?? null}
                searchInputRef={searchInputRef}
                onSelectPatient={selectPatient}
                onRegister={() =>
                  guardedAction(() => onSelectCommand('PATIENTS_REGISTER_NEW_PATIENT'))
                }
              />
            ) : null}
            {commandId === 'PATIENTS_RECENT_PATIENTS' ? (
              <RecentPatientsPane
                api={api}
                selectedPatientId={selectedPatient?.id ?? null}
                onSelectPatient={selectPatient}
              />
            ) : null}
            {commandId === 'PATIENTS_POSSIBLE_DUPLICATES' ? (
              <PossibleDuplicatesPane
                api={api}
                onSelectPatient={selectPatient}
                onMessage={setMessage}
              />
            ) : null}
          </section>

          <PatientDetailPane
            patient={selectedPatient}
            draft={draft}
            editMode={editMode}
            dirty={editDirty}
            saving={saving}
            onDraftChange={(nextDraft) => {
              setDraft(nextDraft)
              setEditDirty(true)
            }}
            onEdit={() => {
              if (selectedPatient !== null) {
                setDraft(detailToEditable(selectedPatient))
                setEditMode(true)
                setEditDirty(false)
              }
            }}
            onSave={() => {
              void saveDraft()
            }}
            onCancel={() => {
              if (editDirty) {
                guardedAction(discardDraft)
                return
              }

              discardDraft()
            }}
            onReload={() => {
              if (selectedPatient !== null) {
                void loadPatient(api, selectedPatient.id, onSelectedPatientChange, setMessage)
              }
            }}
          />
        </div>
      )}

      {showDirtyGuard ? (
        <div className="patient-dialog-backdrop" role="presentation">
          <div
            className="patient-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="dirty-title"
          >
            <h2 id="dirty-title">Unsaved patient changes</h2>
            <div className="patient-dialog-actions">
              <button
                type="button"
                className="button button-primary"
                onClick={() => {
                  void saveDraft().then((saved) => {
                    if (saved) {
                      completePendingAction()
                    }
                  })
                }}
              >
                Save changes
              </button>
              <button
                type="button"
                className="button button-secondary"
                onClick={() => {
                  discardDraft()
                  completePendingAction()
                }}
              >
                Discard edits
              </button>
              <button
                type="button"
                className="button button-secondary"
                onClick={() => {
                  pendingDirtyAction.current = null
                  setShowDirtyGuard(false)
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}

function PatientSearchPane({
  api,
  selectedPatientId,
  searchInputRef,
  onSelectPatient,
  onRegister
}: {
  readonly api: HealthScreeningApi
  readonly selectedPatientId: string | null
  readonly searchInputRef: RefObject<HTMLInputElement | null>
  onSelectPatient(patientId: string): void
  onRegister(): void
}): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [pageSize, setPageSize] = useState<25 | 50 | 100>(25)
  const [page, setPage] = useState(1)
  const [items, setItems] = useState<readonly PublicPatientSummary[]>([])
  const [total, setTotal] = useState(0)
  const [busy, setBusy] = useState(false)

  const runSearch = useCallback(
    async (nextPage: number) => {
      setBusy(true)
      const result = await api.patient.search({
        query,
        page: nextPage,
        pageSize
      })
      setBusy(false)

      if (result.ok) {
        setItems(result.data.items)
        setTotal(result.data.total)
        setPage(result.data.page)
      }
    },
    [api, pageSize, query]
  )

  useEffect(() => {
    let active = true

    const runInitialSearch = async (): Promise<void> => {
      await Promise.resolve()

      if (active) {
        await runSearch(1)
      }
    }

    void runInitialSearch()

    return () => {
      active = false
    }
  }, [runSearch])

  return (
    <>
      <div className="patient-search-toolbar">
        <input
          ref={searchInputRef}
          type="search"
          value={query}
          placeholder="Search by code, name, phone, DOB, age, sex, village, quarter"
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              void runSearch(1)
            }
          }}
        />
        <button type="button" className="button button-primary" onClick={() => void runSearch(1)}>
          Search
        </button>
        <button type="button" className="button button-secondary" onClick={onRegister}>
          Register New
        </button>
        <select
          value={pageSize}
          aria-label="Page size"
          onChange={(event) => {
            const value = Number(event.target.value)
            setPageSize(value === 50 || value === 100 ? value : 25)
          }}
        >
          <option value={25}>25</option>
          <option value={50}>50</option>
          <option value={100}>100</option>
        </select>
      </div>
      <PatientSummaryTable
        items={items}
        selectedPatientId={selectedPatientId}
        emptyText={busy ? 'Searching...' : 'No matching patients.'}
        onSelectPatient={onSelectPatient}
      />
      <div className="patient-pagination">
        <span>
          Page {page} / {Math.max(1, Math.ceil(total / pageSize))}
        </span>
        <button
          type="button"
          className="button button-secondary"
          disabled={page <= 1}
          onClick={() => void runSearch(page - 1)}
        >
          Previous
        </button>
        <button
          type="button"
          className="button button-secondary"
          disabled={page * pageSize >= total}
          onClick={() => void runSearch(page + 1)}
        >
          Next
        </button>
      </div>
    </>
  )
}

function RecentPatientsPane({
  api,
  selectedPatientId,
  onSelectPatient
}: {
  readonly api: HealthScreeningApi
  readonly selectedPatientId: string | null
  onSelectPatient(patientId: string): void
}): React.JSX.Element {
  const [items, setItems] = useState<readonly PublicPatientSummary[]>([])

  useEffect(() => {
    void api.patient.listRecent({ limit: 25 }).then((result) => {
      if (result.ok) {
        setItems(result.data)
      }
    })
  }, [api])

  return (
    <PatientSummaryTable
      items={items}
      selectedPatientId={selectedPatientId}
      emptyText="No recent patients."
      onSelectPatient={onSelectPatient}
    />
  )
}

function PossibleDuplicatesPane({
  api,
  onSelectPatient,
  onMessage
}: {
  readonly api: HealthScreeningApi
  onSelectPatient(patientId: string): void
  onMessage(message: string | null): void
}): React.JSX.Element {
  const [pairs, setPairs] = useState<readonly PublicPatientDuplicatePair[]>([])
  const [selectedPair, setSelectedPair] = useState<PublicPatientDuplicatePair | null>(null)

  const loadPairs = useCallback(async () => {
    const result = await api.patient.findDuplicates({
      identity: null,
      patientId: null,
      limit: 25
    })

    if (result.ok) {
      setPairs(result.data.pairs)
      setSelectedPair(result.data.pairs[0] ?? null)
    }
  }, [api])

  useEffect(() => {
    let active = true

    const loadInitialPairs = async (): Promise<void> => {
      await Promise.resolve()

      if (active) {
        await loadPairs()
      }
    }

    void loadInitialPairs()

    return () => {
      active = false
    }
  }, [loadPairs])

  return (
    <div className="patient-duplicates-layout">
      <div className="patient-duplicate-pairs">
        {pairs.length === 0 ? <p className="patient-empty">No possible duplicates.</p> : null}
        {pairs.map((pair) => (
          <button
            key={pair.pairKey}
            type="button"
            className="patient-duplicate-pair"
            aria-pressed={selectedPair?.pairKey === pair.pairKey}
            onClick={() => setSelectedPair(pair)}
          >
            <span>{pair.first.patientCode}</span>
            <span>{pair.second.patientCode}</span>
            <strong>{pair.score}</strong>
          </button>
        ))}
      </div>
      <div className="patient-duplicate-comparison">
        {selectedPair === null ? (
          <p className="patient-empty">Select a duplicate pair.</p>
        ) : (
          <>
            <DuplicatePatientCard patient={selectedPair.first} />
            <DuplicatePatientCard patient={selectedPair.second} />
            <div className="patient-detail-actions">
              <button
                type="button"
                className="button button-secondary"
                onClick={() => onSelectPatient(selectedPair.first.id)}
              >
                View first
              </button>
              <button
                type="button"
                className="button button-secondary"
                onClick={() => onSelectPatient(selectedPair.second.id)}
              >
                View second
              </button>
              <button
                type="button"
                className="button button-primary"
                onClick={() => {
                  void api.patient
                    .markNotDuplicate({
                      patientIdA: selectedPair.first.id,
                      patientIdB: selectedPair.second.id,
                      reasonCodes: ['MANUAL_REVIEW']
                    })
                    .then((result) => {
                      if (result.ok) {
                        onMessage('Duplicate review saved.')
                        void loadPairs()
                      } else {
                        onMessage(result.error.message)
                      }
                    })
                }}
              >
                Mark not duplicate
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function PatientRegistrationWorkspace({
  api,
  onPatientCreated,
  onMessage,
  onCancel
}: {
  readonly api: HealthScreeningApi
  onPatientCreated(patient: PublicPatientDetail): void
  onMessage(message: string | null): void
  onCancel(): void
}): React.JSX.Element {
  const [draft, setDraft] = useState<PatientEditableFields>(emptyEditableFields)
  const [candidates, setCandidates] = useState<readonly PublicPatientDuplicateCandidate[]>([])
  const [duplicateReviewToken, setDuplicateReviewToken] = useState<string | null>(null)

  const checkDuplicates = async (): Promise<void> => {
    const result = await api.patient.findDuplicates({
      identity: draft,
      patientId: null,
      limit: 10
    })

    if (result.ok) {
      setCandidates(result.data.candidates)
      onMessage(result.data.candidates.length === 0 ? 'No likely duplicates found.' : null)
    } else {
      onMessage(result.error.message)
    }
  }

  const createPatient = async (): Promise<void> => {
    const result = await api.patient.create({
      ...draft,
      duplicateReviewToken
    })

    if (!result.ok) {
      onMessage(result.error.message)
      return
    }

    if (result.data.status === 'DUPLICATE_REVIEW_REQUIRED') {
      setCandidates(result.data.candidates)
      setDuplicateReviewToken(result.data.duplicateReviewToken)
      onMessage('Review possible duplicates before creating this patient.')
      return
    }

    onPatientCreated(result.data.patient)
    onMessage('Patient created.')
  }

  return (
    <section className="patient-registration">
      <PatientFieldsForm draft={draft} onDraftChange={setDraft} />
      {candidates.length > 0 ? (
        <div className="patient-duplicate-review">
          <h2>Possible duplicates</h2>
          {candidates.map((candidate) => (
            <DuplicatePatientCard key={candidate.patient.id} patient={candidate.patient} />
          ))}
        </div>
      ) : null}
      <div className="patient-detail-actions">
        <button
          type="button"
          className="button button-secondary"
          onClick={() => void checkDuplicates()}
        >
          Check duplicates
        </button>
        <button
          type="button"
          className="button button-primary"
          onClick={() => void createPatient()}
        >
          Create patient
        </button>
        <button type="button" className="button button-secondary" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </section>
  )
}

function PatientSummaryTable({
  items,
  selectedPatientId,
  emptyText,
  onSelectPatient
}: {
  readonly items: readonly PublicPatientSummary[]
  readonly selectedPatientId: string | null
  readonly emptyText: string
  onSelectPatient(patientId: string): void
}): React.JSX.Element {
  return (
    <div className="patient-table-scroll">
      <table className="patient-table">
        <thead>
          <tr>
            <th scope="col">Patient code</th>
            <th scope="col">Name</th>
            <th scope="col">Age / DOB</th>
            <th scope="col">Sex</th>
            <th scope="col">Village / quarter</th>
            <th scope="col">Phone</th>
            <th scope="col">Action</th>
          </tr>
        </thead>
        <tbody>
          {items.length === 0 ? (
            <tr>
              <td colSpan={7}>{emptyText}</td>
            </tr>
          ) : (
            items.map((patient) => (
              <tr
                key={patient.id}
                data-selected={patient.id === selectedPatientId ? 'true' : 'false'}
              >
                <td>{patient.patientCode}</td>
                <td>{patient.displayName}</td>
                <td>{formatAgeDob(patient)}</td>
                <td>{patient.sex}</td>
                <td>{formatVillageQuarter(patient)}</td>
                <td>{patient.phone ?? 'Not recorded'}</td>
                <td>
                  <button
                    type="button"
                    className="button button-secondary patient-row-action"
                    onClick={() => onSelectPatient(patient.id)}
                  >
                    Select
                  </button>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  )
}

function PatientDetailPane({
  patient,
  draft,
  editMode,
  dirty,
  saving,
  onDraftChange,
  onEdit,
  onSave,
  onCancel,
  onReload
}: {
  readonly patient: PublicPatientDetail | null
  readonly draft: PatientEditableFields
  readonly editMode: boolean
  readonly dirty: boolean
  readonly saving: boolean
  onDraftChange(draft: PatientEditableFields): void
  onEdit(): void
  onSave(): void
  onCancel(): void
  onReload(): void
}): React.JSX.Element {
  return (
    <aside className="patient-detail-pane" aria-label="Selected patient">
      {patient === null ? (
        <p className="patient-empty">Select a patient to view or update details.</p>
      ) : editMode ? (
        <>
          <div className="patient-detail-header">
            <h2>{patient.patientCode}</h2>
            <span>{dirty ? 'Unsaved edits' : 'Editing'}</span>
          </div>
          <PatientFieldsForm draft={draft} onDraftChange={onDraftChange} />
          <div className="patient-detail-actions">
            <button
              type="button"
              className="button button-primary"
              disabled={saving}
              onClick={onSave}
            >
              Save changes
            </button>
            <button type="button" className="button button-secondary" onClick={onCancel}>
              Cancel
            </button>
            <button type="button" className="button button-secondary" onClick={onReload}>
              Reload
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="patient-detail-header">
            <h2>{patient.patientCode}</h2>
            <button type="button" className="button button-secondary" onClick={onEdit}>
              Edit
            </button>
          </div>
          <dl className="patient-detail-list">
            <DetailRow label="Name" value={patient.displayName} />
            <DetailRow label="Age / DOB" value={formatAgeDob(patient)} />
            <DetailRow label="Sex" value={patient.sex} />
            <DetailRow label="Village / quarter" value={formatVillageQuarter(patient)} />
            <DetailRow label="Phone" value={patient.phone ?? 'Not recorded'} />
            <DetailRow label="Acknowledgment" value={patient.acknowledgment.status} />
            <DetailRow label="Clinical" value="Not available" />
            <DetailRow
              label="Created"
              value={`${patient.createdAt} by ${patient.createdByDisplayName}`}
            />
            <DetailRow
              label="Updated"
              value={`${patient.updatedAt} by ${patient.updatedByDisplayName}`}
            />
          </dl>
        </>
      )}
    </aside>
  )
}

function PatientFieldsForm({
  draft,
  onDraftChange
}: {
  readonly draft: PatientEditableFields
  onDraftChange(draft: PatientEditableFields): void
}): React.JSX.Element {
  const update = <TKey extends keyof PatientEditableFields>(
    key: TKey,
    value: PatientEditableFields[TKey]
  ): void => onDraftChange({ ...draft, [key]: value })

  return (
    <div className="patient-fields-grid">
      <TextField
        label="Given name"
        value={draft.givenName}
        onChange={(value) => update('givenName', value)}
      />
      <TextField
        label="Family name"
        value={draft.familyName}
        onChange={(value) => update('familyName', value)}
      />
      <TextField
        label="Other names"
        value={draft.otherNames}
        onChange={(value) => update('otherNames', value)}
      />
      <DateField
        label="Date of birth"
        value={draft.dateOfBirth}
        onChange={(value) => update('dateOfBirth', value)}
      />
      <NumberField
        label="Approximate age"
        value={draft.approximateAgeYears}
        onChange={(value) => update('approximateAgeYears', value)}
      />
      <DateField
        label="Age as of date"
        value={draft.ageAsOfDate}
        onChange={(value) => update('ageAsOfDate', value)}
      />
      <label>
        <span>Sex</span>
        <select
          value={draft.sex}
          onChange={(event) => update('sex', event.target.value as PatientEditableFields['sex'])}
        >
          <option value="UNKNOWN">Unknown</option>
          <option value="FEMALE">Female</option>
          <option value="MALE">Male</option>
          <option value="OTHER">Other</option>
        </select>
      </label>
      <TextField
        label="Village"
        value={draft.village}
        onChange={(value) => update('village', value)}
      />
      <TextField
        label="Quarter"
        value={draft.quarter}
        onChange={(value) => update('quarter', value)}
      />
      <TextField label="Phone" value={draft.phone} onChange={(value) => update('phone', value)} />
      <TextField
        label="Alternate contact"
        value={draft.alternateContactName}
        onChange={(value) => update('alternateContactName', value)}
      />
      <TextField
        label="Alternate phone"
        value={draft.alternateContactPhone}
        onChange={(value) => update('alternateContactPhone', value)}
      />
      <label className="patient-field-wide">
        <span>Residence notes</span>
        <textarea
          value={draft.residenceNotes ?? ''}
          onChange={(event) => update('residenceNotes', emptyToNull(event.target.value))}
        />
      </label>
      <label>
        <span>Status</span>
        <select
          value={draft.status}
          onChange={(event) =>
            update('status', event.target.value as PatientEditableFields['status'])
          }
        >
          <option value="ACTIVE">Active</option>
          <option value="INACTIVE">Inactive</option>
        </select>
      </label>
      <label>
        <span>Acknowledgment</span>
        <select
          value={draft.acknowledgmentStatus}
          onChange={(event) =>
            update(
              'acknowledgmentStatus',
              event.target.value as PatientEditableFields['acknowledgmentStatus']
            )
          }
        >
          <option value="NOT_REQUESTED">Not requested</option>
          <option value="ACKNOWLEDGED">Acknowledged</option>
          <option value="DECLINED">Declined</option>
        </select>
      </label>
    </div>
  )
}

function TextField({
  label,
  value,
  onChange
}: {
  readonly label: string
  readonly value: string | null
  onChange(value: string | null): void
}): React.JSX.Element {
  return (
    <label>
      <span>{label}</span>
      <input value={value ?? ''} onChange={(event) => onChange(emptyToNull(event.target.value))} />
    </label>
  )
}

function DateField({
  label,
  value,
  onChange
}: {
  readonly label: string
  readonly value: string | null
  onChange(value: string | null): void
}): React.JSX.Element {
  return (
    <label>
      <span>{label}</span>
      <input
        type="date"
        value={value ?? ''}
        onChange={(event) => onChange(emptyToNull(event.target.value))}
      />
    </label>
  )
}

function NumberField({
  label,
  value,
  onChange
}: {
  readonly label: string
  readonly value: number | null
  onChange(value: number | null): void
}): React.JSX.Element {
  return (
    <label>
      <span>{label}</span>
      <input
        type="number"
        min={0}
        max={120}
        value={value ?? ''}
        onChange={(event) =>
          onChange(event.target.value === '' ? null : Number(event.target.value))
        }
      />
    </label>
  )
}

function DuplicatePatientCard({
  patient
}: {
  readonly patient: PublicPatientSummary
}): React.JSX.Element {
  return (
    <div className="patient-duplicate-card">
      <strong>{patient.patientCode}</strong>
      <span>{patient.displayName}</span>
      <span>{formatAgeDob(patient)}</span>
      <span>{formatVillageQuarter(patient)}</span>
    </div>
  )
}

function DetailRow({
  label,
  value
}: {
  readonly label: string
  readonly value: string
}): React.JSX.Element {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  )
}

function detailToEditable(patient: PublicPatientDetail): PatientEditableFields {
  return {
    givenName: patient.givenName,
    familyName: patient.familyName,
    otherNames: patient.otherNames,
    dateOfBirth: patient.dateOfBirth,
    approximateAgeYears: patient.approximateAgeYears,
    ageAsOfDate: patient.ageAsOfDate,
    sex: patient.sex,
    village: patient.village,
    quarter: patient.quarter,
    phone: patient.phone,
    alternateContactName: patient.alternateContactName,
    alternateContactPhone: patient.alternateContactPhone,
    residenceNotes: patient.residenceNotes,
    status: patient.status,
    acknowledgmentStatus: patient.acknowledgment.status
  }
}

async function loadPatient(
  api: HealthScreeningApi,
  patientId: string,
  onSelectedPatientChange: (patient: PublicPatientDetail | null) => void,
  onMessage: (message: string | null) => void
): Promise<PublicPatientDetail | null> {
  const result = await api.patient.get({ patientId })

  if (!result.ok) {
    onMessage(result.error.message)
    return null
  }

  onMessage(null)
  onSelectedPatientChange(result.data)
  return result.data
}

function formatAgeDob(patient: PublicPatientSummary): string {
  if (patient.dateOfBirth !== null) {
    return patient.dateOfBirth
  }

  if (patient.approximateAgeYears !== null) {
    return `${patient.approximateAgeYears} as of ${patient.ageAsOfDate ?? 'unknown'}`
  }

  return 'Not recorded'
}

function formatVillageQuarter(patient: PublicPatientSummary): string {
  return [patient.village, patient.quarter].filter(Boolean).join(' / ') || 'Not recorded'
}

function emptyToNull(value: string): string | null {
  const trimmed = value.trim()

  return trimmed.length === 0 ? null : value
}
