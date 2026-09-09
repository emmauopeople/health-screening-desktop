# Report document IPC

Patient report export uses two fixed request/response channels:

- `health-screening:report-documents:save-pdf`
- `health-screening:report-documents:print`

Both accept a strict request containing only the patient UUID, report kind, and a safe suggested
PDF filename. HTML, filesystem paths, actor identity, roles, and clinical report data are never
accepted from the renderer through this boundary.

The main process validates the sender and requires an active local authentication session before
using the requesting renderer's `webContents`. PDF export calls Chromium's `printToPDF` with A4,
print backgrounds, and CSS page-size support, then writes the returned PDF bytes only after the
user chooses a destination in the native save dialog. The success response contains the saved
basename, never its local path.

Printing opens the operating system print dialog with print backgrounds enabled. Save and print
cancellation are normal success states so the renderer can distinguish them from service failure.
Errors and operational logs use bounded codes and error types; they do not include patient IDs,
report filenames, report contents, or destination paths.

The PDF content is the already-rendered dedicated print-preview document. Print CSS removes all
application controls and browser-only links, retains the report masthead, footer, tables, and SVG
trend graphs, and supplies page counters through paged-media CSS.
