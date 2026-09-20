# Responsive desktop validation

The main window opens within the primary display's work area, which accounts
for Windows display scaling and the taskbar. Its normal initial size remains
1100 × 720 logical pixels. The minimum is 640 × 480, reduced further if the
display work area is smaller.

Screen layouts use a compact navigation header on laptops. At narrower widths,
list/detail workspaces stack vertically; at short window heights, the workspace
scrolls so filters cannot consume all available space and hide the results.
Wide data tables retain their own horizontal scrolling. PDF page layouts use
their existing print styles independently of window dimensions.

## Windows acceptance checks

1. Launch on the laptop at its normal resolution and display scaling. Verify
   that the title bar, bottom edge, and Windows taskbar are accessible.
2. Check at 100%, 125%, and 150% scaling where supported. Relaunch after changing
   scaling, then maximize, restore, and resize the window.
3. Sign in, lock/unlock, and open configuration. Scroll to every action when
   the window is short; keyboard focus should bring controls into view.
4. Visit Dashboard, patient search/registration, Manage Encounters, referrals,
   all report workspaces, Users, Backup / Restore, and Protocols. At narrow
   widths, scroll past the results list to reach the selected record detail.
5. Open a screening, enter a reading, and continue to Lifestyle. Confirm that
   all form fields and Save/Continue actions remain reachable. Scroll wide
   readings tables horizontally where needed.
6. Open patient, session, and audit PDF previews. Confirm that preview controls
   remain reachable and saved/printed pages retain their normal A4 layout.

## Development verification

Window-option unit tests cover display work areas from 600 × 400 through
1920 × 1040. Browser layout checks use the real React application with synthetic
IPC fixtures, including 640 × 480, 860 × 560, 1093 × 614, 1366 × 768, and
1920 × 1080 viewports. These checks supplement Windows acceptance testing;
they do not simulate native Electron window chrome or physical monitor changes.
