# HSD-069 — Users administration

Administration → Users gives local administrators a searchable, paginated user list and an independently scrolling account detail panel. Search matches display names and usernames; the status filter selects all, active or inactive accounts. Each page contains up to 25 users, ordered by normalized username and ID.

Administrators can create a local administrator, nurse or trained screener; edit a display name and role; activate or deactivate an account; reset its password; and clear login lockout. Usernames stay fixed after creation. Account changes require an audit reason. Accounts are retained to preserve clinical and audit references.

Creation and password reset use the existing scrypt credential service and require a password change at next sign-in. Password fields clear after submission, and password hashes/salts are never returned to the renderer or included in audit metadata. The logged-in administrator cannot manage their own account here; another administrator must do so. Unsaved form changes participate in the shell navigation guard, and navigation is blocked while saving.

The two fixed IPC methods, `userAdministration.search` and `userAdministration.mutate`, validate requests and responses. Both enforce local administrator authority in the main process. The service rereads the actor's current account state and rechecks the active session after asynchronous password hashing. Updates carry the selected account's `updatedAt` version; stale changes are rejected and the UI refreshes the account. User changes and `USER_ADMIN_*` audit events commit in the same transaction. A failure to write the audit record rolls back the account change.

This feature uses the existing local user table and password-change flow. It does not introduce user synchronization or a database migration. Styling is isolated in `users-administration.css`.

## Verification

Service integration tests use migrated SQLite databases and real password hashing to cover creation, duplicates, search/pagination, account changes, password reset, unlock, authorization, session changes, input validation and audit rollback. IPC/preload tests cover sender containment, fixed channels, strict schemas and sanitized failures. Renderer tests exercise list/detail selection, filtering, pagination, account forms, password confirmation, unsaved changes and stale versions.

For local review, sign in as a local administrator, open Administration → Users, create a test nurse with a temporary password, then sign in as that nurse and complete the required password change. Return as the administrator to review role/status edits, reset and unlock. Each successful change should appear in Audit Reports.
