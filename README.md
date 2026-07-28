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

## Verification

```powershell
pnpm typecheck
pnpm build
```

`pnpm typecheck` runs both the Node-side and web-side TypeScript checks. `pnpm build` runs typechecking and then builds the Electron main, preload, and renderer bundles.

## Architecture

See `docs/repository-structure.md` for the process boundaries and directory responsibilities.
