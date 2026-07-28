# Health Screening Offline Desktop

Offline-first Windows desktop application foundation for community health screening workflows.

HSD-001 contains only the engineering bootstrap. No clinical workflows, authentication, database, routing, synchronization, or business IPC operations are implemented.

## Prerequisites

- Node.js 22 or newer
- pnpm 11.17.0

If `pnpm` is not available directly, use Corepack:

```powershell
corepack pnpm --version
```

## Setup

```powershell
pnpm install
```

## Development

```powershell
pnpm dev
```

This launches the Electron development application with the React renderer.

## Quality Commands

```powershell
pnpm format
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm verify
pnpm build
```

- `pnpm format` writes Prettier formatting changes.
- `pnpm format:check` verifies formatting without changing files.
- `pnpm lint` runs ESLint with warnings treated as failures.
- `pnpm typecheck` runs both the Node-side and web-side TypeScript checks.
- `pnpm test` runs the Vitest unit test suite once and exits.
- `pnpm verify` runs format check, lint, typecheck, and tests.
- `pnpm build` runs typechecking and then builds the Electron main, preload, and renderer bundles.

Use `pnpm test:watch` for interactive Vitest watch mode during development.

## Architecture

See `docs/repository-structure.md` for the process boundaries and directory responsibilities.
See `docs/engineering-standards.md` for strict TypeScript settings, aliases, renderer import boundaries, formatting, linting, and test standards.
