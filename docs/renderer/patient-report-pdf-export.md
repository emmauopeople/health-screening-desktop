# Patient report PDF export

The Reports > Export / Print workspace reuses the patient-report workflow: select a patient,
choose General, Vitals, Lifestyle, or Referrals, choose the last 7 days, last 30 days, or a custom
inclusive date range, and open Print preview.

The preview contains two document actions:

- **Save PDF** opens the native save dialog and creates a real A4 PDF suitable for downloading,
  exporting, or sending digitally.
- **Print** opens the native operating system print dialog.

The PDF is rendered from the report document rather than captured from the screen. Text remains
searchable and the blood-pressure and weight trends remain vector SVG graphics. Encounter IDs and
browser-only Open controls are excluded from print output.

The General PDF contains patient demographics, summary values, clean vitals, blood-pressure and
weight trend graphs, lifestyle answers including alcohol, tobacco, and physical activity, food,
OTC medication, current referral-reported medication, and a referral overview. The focused Vitals,
Lifestyle, and Referrals reports limit their sections accordingly. Referral output includes date,
reason and triggering blood pressure, status, initial treatment, medication, status history,
follow-up details, treatment actions, and medication changes.

Print-only identity elements include the Community Health Screening masthead, the bold disclaimer
`Screening guidance is not a diagnosis`, and a repeating footer with patient name/date of birth,
page number, and the current user's display name. The logo does not appear in the browser report.
