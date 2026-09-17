import { describe, expect, it } from 'vitest'
import { createSessionReportPageStyle } from '../../../src/renderer/src/app/reports/session-report-page-style'

describe('session report page margins', () => {
  it('encodes display names as CSS text without permitting rule injection', () => {
    const name = 'Nurse "}; } body { display: none } /* Émile'
    const css = createSessionReportPageStyle('2026-09-17', name)
    expect(css).not.toContain(name)
    expect(css).not.toContain('display: none')
    const decoded = css.replace(/\\([0-9a-f]+) /gu, (_, code: string) =>
      String.fromCodePoint(parseInt(code, 16))
    )
    expect(decoded).toContain('Session 17 Sept 2026')
    expect(decoded).toContain(`Reported by: ${name}`)
    expect(css.match(/@page/gu)).toHaveLength(1)
  })
})
