// Use constructed stylesheets so the production style-src 'self' policy stays intact.
export function createAuditReportPageStyle(deploymentName: string, reportedBy: string): string {
  return `@media print { @page audit-report {
    @bottom-left { content: "${cssText(wrapFooter(deploymentName, 32))}"; }
    @bottom-right { content: "${cssText(wrapFooter(`Reported by: ${reportedBy}`, 46))}"; }
  } }`
}

// Page margin boxes do not reliably wrap unbroken names in Chromium. Explicit breaks
// keep long identifiers within their own column; the heading retains the full name.
function wrapFooter(value: string, width: number): string {
  const lines: string[] = []
  const remaining = Array.from(value)
  while (remaining.length > width) {
    const candidate = remaining.slice(0, width)
    const space = candidate.lastIndexOf(' ')
    const split = space >= width / 2 ? space + 1 : width
    lines.push(remaining.splice(0, split).join(''))
  }
  if (remaining.length > 0) lines.push(remaining.join(''))
  return lines.join('\n')
}

function cssText(value: string): string {
  return Array.from(value, (character) => `\\${character.codePointAt(0)!.toString(16)} `).join('')
}
