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
