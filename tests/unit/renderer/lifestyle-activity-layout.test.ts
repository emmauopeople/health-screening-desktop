import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const stylesheet = readFileSync(resolve(process.cwd(), 'src/renderer/src/styles/main.css'), 'utf8')

describe('Lifestyle Activity layout contract', () => {
  it('uses one equal three-column desktop grid for both Activity sections', () => {
    const rowRule = stylesheet.match(/\.lifestyle-activity-row\s*\{([^}]*)\}/u)?.[1] ?? ''

    expect(rowRule).toContain('grid-template-columns: repeat(3, minmax(0, 1fr));')
    expect(rowRule).not.toMatch(/1\.15fr|0\.75fr|1\.8fr/u)
    expect(stylesheet).toContain('.lifestyle-activity-field-domain')
    expect(stylesheet).toContain('.lifestyle-activity-field-intensity')
    expect(stylesheet).toContain('.lifestyle-activity-field-description')
    expect(stylesheet).toContain('.lifestyle-activity-field-days')
    expect(stylesheet).toContain('.lifestyle-activity-field-hours')
    expect(stylesheet).toContain('.lifestyle-activity-field-minutes')
  })

  it('keeps Activity controls compact and stacks them at the existing narrow breakpoint', () => {
    expect(stylesheet).toContain('height: 38px;')
    expect(stylesheet).toContain('.lifestyle-activity-add {')
    expect(stylesheet).toContain('.lifestyle-field-error-visible')
    expect(stylesheet).toMatch(
      /@media \(max-width: 860px\)[\s\S]*\.lifestyle-activity-row[\s\S]*grid-template-columns: 1fr;/u
    )
  })
})
