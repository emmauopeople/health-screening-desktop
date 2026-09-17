// Constructed stylesheets preserve the production CSP: no inline style tags or relaxed policy.
export function createSessionReportPageStyle(sessionDate: string, reportedBy: string): string {
  const date = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeZone: 'UTC' }).format(
    new Date(`${sessionDate}T00:00:00Z`)
  )
  return `@media print { @page session-report {
    @bottom-left { content: "${cssText(`Session ${date}`)}"; }
    @bottom-right { content: "${cssText(`Reported by: ${reportedBy}`)}"; }
  } }`
}

// Encode every character so display names cannot terminate a CSS string.
function cssText(value: string): string {
  return Array.from(value, (character) => `\\${character.codePointAt(0)!.toString(16)} `).join('')
}
