import { describe, expect, it } from 'vitest'
import { createAuditReportPageStyle } from '../../../src/renderer/src/app/reports/audit-report-page-style'

describe('audit report page margins', () => {
  it('encodes display names as CSS text without permitting rule injection', () => {
    const name = 'Nurse "}; } body { display: none } /* Émile'
    const css = createAuditReportPageStyle('Babungo', name)
    expect(css).not.toContain(name)
    expect(css).not.toContain('display: none')
    const decoded = css.replace(/\\([0-9a-f]+) /gu, (_, code: string) =>
      String.fromCodePoint(parseInt(code, 16))
    )
    expect(decoded).toContain('Babungo')
    expect(decoded.replaceAll('\n', '')).toContain(`Reported by: ${name}`)
    expect(css.match(/@page/gu)).toHaveLength(1)
  })
  it('wraps long unbroken deployment names and reporter names within separate footer columns', () => {
    const css = createAuditReportPageStyle('X'.repeat(120), 'Y'.repeat(160))
    const decoded = css.replace(/\\([0-9a-f]+) /gu, (_, code: string) =>
      String.fromCodePoint(parseInt(code, 16))
    )
    const contents = [...decoded.matchAll(/content: "([^"]*)"/gu)].map((match) => match[1]!)
    expect(contents[0]!.split('\n').every((line) => line.length <= 32)).toBe(true)
    expect(contents[1]!.split('\n').every((line) => line.length <= 46)).toBe(true)
    expect(contents[0]!.replaceAll('\n', '')).toBe('X'.repeat(120))
    expect(contents[1]!.replaceAll('\n', '')).toBe('Reported by: ' + 'Y'.repeat(160))
  })
})
