# Engineering Standards

HSD-002 keeps the application in an engineering-foundation state. Tooling may improve reliability, but it must not introduce clinical workflows, persistence, authentication, routing, business IPC, or synchronization.

## TypeScript

TypeScript strictness is explicit for the Node-side and renderer-side projects:

- `strict`
- `noImplicitAny`
- `noUncheckedIndexedAccess`
- `noFallthroughCasesInSwitch`
- `noImplicitOverride`
- `forceConsistentCasingInFileNames`
- `useUnknownInCatchVariables`

The Electron Toolkit base config currently provides `skipLibCheck: true`; this project does not change that inherited framework setting in HSD-002.

## Import Boundaries

The application keeps Electron responsibilities separated by process:

- `src/main` owns trusted desktop behavior and future local data access.
- `src/preload` owns the narrow `contextBridge` API exposed to the renderer.
- `src/renderer` owns React presentation code only.
- `src/shared` owns process-neutral contracts and types.

Aliases are scoped by project:

- Main and preload TypeScript can resolve `@main/*`, `@preload/*`, and `@shared/*` when valid for their process.
- Renderer TypeScript can resolve `@renderer/*` and `@shared/*`.
- Vitest unit tests resolve `@shared/*`.

Renderer code cannot import Electron, Node built-ins, `src/main`, `src/preload`, `@main/*`, or `@preload/*`. ESLint enforces this boundary; renderer code must use the typed preload API exposed on `window.healthScreening`.

## Formatting And Linting

Prettier is the formatting authority.

- `pnpm format` writes formatting changes.
- `pnpm format:check` verifies formatting without modifying files.

ESLint enforces TypeScript, React hook, React refresh, and renderer-boundary rules. `pnpm lint` runs with `--max-warnings=0`, so warnings fail the quality gate.

## Tests

Unit tests live under `tests/unit` and use Vitest in a deterministic Node environment. Test files use the `*.test.ts` naming pattern.

Current unit tests cover shared bootstrap contracts and copy-return behavior without importing Electron or touching the filesystem.

## Verification

Run the quality gate before handoff:

```powershell
pnpm verify
```

`pnpm verify` runs formatting check, lint, TypeScript checks, and unit tests. Production build remains separate:

```powershell
pnpm build
```

## Renderer CSP And Session Permissions

Development and production use different CSP delivery mechanisms. Development uses an Electron
`session.webRequest.onHeadersReceived` response header for the approved Vite renderer origin so
Vite HMR can use its exact same-port WebSocket connection. Production uses a Vite build-time HTML
transform that injects one CSP meta tag into the packaged renderer HTML.

The only development CSP exceptions are `style-src 'unsafe-inline'` for Vite style injection,
`script-src 'nonce-health-screening-vite-dev'` for Vite React's development preamble, and
`connect-src 'self' <exact-websocket-origin>` for the configured loopback renderer port. Development
must not add script `unsafe-inline`, `unsafe-eval`, broad `ws:` or `wss:` sources, wildcard hosts,
or all-localhost-port access.

Production currently has a no-network renderer policy: `connect-src 'none'`. Later backend or sync
connectivity must be added through a narrowly reviewed `connect-src` change for the exact required
origin; wildcard network access is not allowed.

Electron session permissions are denied by default through both permission-check and
permission-request handlers. Any future use of notifications, geolocation, media, clipboard,
display capture, USB, HID, serial, Bluetooth, or an unknown browser permission requires a later
reviewed task before it can be enabled.

After building, verify the packaged CSP output:

```powershell
Select-String -Path out/renderer/index.html -Pattern 'Content-Security-Policy' -AllMatches
Select-String -Path out/renderer/index.html -Pattern "unsafe-eval|unsafe-inline|connect-src[^;]*" -AllMatches
```
