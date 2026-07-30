# IPC Foundation

HSD-005 establishes the first renderer-to-main IPC boundary. HSD-015 adds the
trusted first-run setup IPC boundary. These are security foundations only: no
patient workflows, authentication, sync, settings, files, shell integration, or
clinical operations are exposed.

## Channel Catalog

The shared channel catalog is defined in `src/shared/ipc/channels.ts`.

| Operation                      | Channel                                 | Request                  | Success data                                                                                                     |
| ------------------------------ | --------------------------------------- | ------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| `app.getInfo()`                | `health-screening:app:get-info`         | `{}` strict empty object | `{ applicationName, applicationVersion, platform, architecture, packaged }`                                      |
| `app.getHealth()`              | `health-screening:app:get-health`       | `{}` strict empty object | `{ status: 'ready', ipc: 'available', database: 'ready' or 'unavailable', clinicalFeatures: 'not-implemented' }` |
| `firstRun.getState()`          | `health-screening:first-run:get-state`  | `{}` strict empty object | Minimized first-run state                                                                                        |
| `firstRun.initialize(command)` | `health-screening:first-run:initialize` | Strict first-run command | Minimized initialized state                                                                                      |

The renderer never receives a channel string argument, a generic invoke method,
or any dynamic dispatch surface.

## Result Envelope

Every IPC operation resolves to a discriminated result:

```ts
type AppGetInfoResult = z.infer<typeof appGetInfoResultSchema>
```

Safe error codes:

| Code                | Meaning                                                          |
| ------------------- | ---------------------------------------------------------------- |
| `VALIDATION_FAILED` | The renderer supplied an invalid request.                        |
| `IPC_FORBIDDEN`     | The sender frame or origin is not trusted.                       |
| `IPC_UNAVAILABLE`   | The preload transport failed or returned an unreadable envelope. |
| `INTERNAL_ERROR`    | Execution failed or trusted output did not match its schema.     |

Renderer-visible messages are stable and safe. They must not contain stack
traces, filesystem paths, hostnames, usernames, payloads, command-line values,
environment variables, or raw Electron errors.

## Schema Authority

Zod schemas in `src/shared/ipc` are the runtime authority for requests,
responses, and envelopes. TypeScript types are inferred from those schemas.
Do not manually duplicate contract shapes elsewhere.

All app request schemas and the first-run state request schema are strict empty
objects. First-run initialization uses one strict shared command schema. All IPC
response data is structured-clone-safe plain data.

## Sender Validation

Main-process handlers validate the sender before parsing requests or executing
operations:

1. Reject when `event.senderFrame` is null.
2. Reject when `event.senderFrame` is not `event.sender.mainFrame`.
3. Reject when the sender frame URL is not allowed by the same HSD-003
   `NavigationPolicy` used by the main window.
4. Reject malformed sender URLs without throwing details to the renderer.

Development accepts only the configured loopback renderer origin. Production
accepts only the packaged renderer document, with same-document hash navigation.

## Handler Lifecycle

`registerApplicationIpcHandlers` removes the application-owned handlers,
registers exactly the supported namespaced channels, and returns a disposer.
The disposer removes only those namespaced handlers and leaves unrelated
channels untouched. Re-registration must not accumulate duplicate handlers.

Handlers are registered after `app.whenReady()` and HSD-004 session security
configuration, before the renderer is loaded.

## Preload Bridge

`window.healthScreening` exposes one fixed nested object:

```ts
window.healthScreening.app.getInfo()
window.healthScreening.app.getHealth()
window.healthScreening.firstRun.getState()
window.healthScreening.firstRun.initialize(command)
```

Each method calls `ipcRenderer.invoke` with one compile-time channel constant.
The preload validates first-run initialization input before invoking main and
validates returned envelopes before passing them to the renderer. Invoke
rejection or malformed responses map to `IPC_UNAVAILABLE`.

The bridge must not expose `ipcRenderer`, `contextBridge`, `invoke`, `send`,
`sendSync`, `on`, `once`, `off`, `postMessage`, Electron events, Node globals,
filesystem APIs, `process`, `Buffer`, `require`, `Session`, or `WebContents`.

## Future Operation Process

Adding a future IPC operation requires:

1. Threat review for the capability and payload.
2. One namespaced channel constant.
3. Strict request, response, and result schemas with inferred types.
4. Sender validation through the shared navigation policy.
5. A main-process handler with safe error mapping.
6. One explicit preload wrapper method; no generic dispatch.
7. Documentation updates and deterministic unit tests.
8. Role/authorization review when authentication exists.

## PHI And Logging

Do not log IPC payloads. Operational logs may include channel name, safe error
code, and exception type only. Renderer-visible errors must remain safe and
stable. No PHI, filesystem path, hostname, username, device identifier, database
path, environment value, stack trace, or raw exception message may cross the IPC
boundary.
