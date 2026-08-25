export const SCREENING_BP_PROTOCOL_V1 = Object.freeze({
  key: 'community-bp-screening',
  version: '1',
  configuration: Object.freeze({
    initialRestMinutes: 5,
    repeatIntervalMinutes: 1,
    repeatSystolicThreshold: 140,
    repeatDiastolicThreshold: 90,
    urgentSystolicThreshold: 180,
    urgentDiastolicThreshold: 120,
    summaryMethod: 'MEAN_OF_LAST_TWO' as const
  })
})

export type ScreeningBpNextAction = 'ROUTINE' | 'REPEAT_REQUIRED' | 'REFER' | 'URGENT_REFERRAL'

export interface ScreeningBpReading {
  readonly sequenceNumber: number
  readonly systolic: number
  readonly diastolic: number
  readonly pulse: number
}

export interface ScreeningBpDecision {
  readonly nextAction: ScreeningBpNextAction
  readonly summarySystolic: number
  readonly summaryDiastolic: number
  readonly summaryPulse: number
  readonly evidence: {
    readonly protocolKey: typeof SCREENING_BP_PROTOCOL_V1.key
    readonly protocolVersion: typeof SCREENING_BP_PROTOCOL_V1.version
    readonly calculationMethod: 'SINGLE_READING' | 'MEAN_OF_LAST_TWO'
    readonly readingSequenceNumbers: readonly number[]
    readonly repeatSystolicThreshold: number
    readonly repeatDiastolicThreshold: number
    readonly urgentSystolicThreshold: number
    readonly urgentDiastolicThreshold: number
  }
}

export function evaluateScreeningBloodPressure(
  readings: readonly ScreeningBpReading[]
): ScreeningBpDecision | null {
  if (readings.length === 0) return null

  const ordered = readings.slice().sort((left, right) => left.sequenceNumber - right.sequenceNumber)
  const summaryReadings = ordered.slice(-2)
  const summary = summarize(summaryReadings)
  const latest = ordered[ordered.length - 1]!
  const configuration = SCREENING_BP_PROTOCOL_V1.configuration
  const repeatIndicated =
    ordered.some(
      (reading) =>
        reading.systolic >= configuration.repeatSystolicThreshold ||
        reading.diastolic >= configuration.repeatDiastolicThreshold
    ) && ordered.length < 2

  const urgent =
    ordered.length >= 2 &&
    (latest.systolic >= configuration.urgentSystolicThreshold ||
      latest.diastolic >= configuration.urgentDiastolicThreshold ||
      summary.systolic >= configuration.urgentSystolicThreshold ||
      summary.diastolic >= configuration.urgentDiastolicThreshold)
  const referral =
    ordered.length >= 2 &&
    (summary.systolic >= configuration.repeatSystolicThreshold ||
      summary.diastolic >= configuration.repeatDiastolicThreshold)

  return Object.freeze({
    nextAction: repeatIndicated
      ? 'REPEAT_REQUIRED'
      : urgent
        ? 'URGENT_REFERRAL'
        : referral
          ? 'REFER'
          : 'ROUTINE',
    summarySystolic: summary.systolic,
    summaryDiastolic: summary.diastolic,
    summaryPulse: summary.pulse,
    evidence: Object.freeze({
      protocolKey: SCREENING_BP_PROTOCOL_V1.key,
      protocolVersion: SCREENING_BP_PROTOCOL_V1.version,
      calculationMethod: summaryReadings.length === 1 ? 'SINGLE_READING' : 'MEAN_OF_LAST_TWO',
      readingSequenceNumbers: Object.freeze(
        summaryReadings.map((reading) => reading.sequenceNumber)
      ),
      repeatSystolicThreshold: configuration.repeatSystolicThreshold,
      repeatDiastolicThreshold: configuration.repeatDiastolicThreshold,
      urgentSystolicThreshold: configuration.urgentSystolicThreshold,
      urgentDiastolicThreshold: configuration.urgentDiastolicThreshold
    })
  })
}

export function getScreeningBpInstruction(decision: ScreeningBpDecision): string {
  switch (decision.nextAction) {
    case 'REPEAT_REQUIRED':
      return `Ask the patient to sit quietly with back supported, feet flat, and arm supported at heart level. Wait at least ${SCREENING_BP_PROTOCOL_V1.configuration.repeatIntervalMinutes} minute, then add a second blood-pressure reading before continuing.`
    case 'URGENT_REFERRAL':
      return 'Your blood pressure is running high. You need to see a doctor as soon as possible.'
    case 'REFER':
      return 'The repeated blood-pressure readings meet the screening threshold for professional medical review.'
    case 'ROUTINE':
      return 'No blood-pressure referral threshold was identified by this screening protocol.'
  }
}

function summarize(readings: readonly ScreeningBpReading[]): {
  readonly systolic: number
  readonly diastolic: number
  readonly pulse: number
} {
  const divisor = readings.length
  return Object.freeze({
    systolic: Math.round(
      readings.reduce((total, reading) => total + reading.systolic, 0) / divisor
    ),
    diastolic: Math.round(
      readings.reduce((total, reading) => total + reading.diastolic, 0) / divisor
    ),
    pulse: Math.round(readings.reduce((total, reading) => total + reading.pulse, 0) / divisor)
  })
}
