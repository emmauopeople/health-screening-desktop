# IPC Foundation

HSD-005 establishes the first renderer-to-main IPC boundary. It is a security
foundation only: no patient workflows, persistence, authentication, sync,
settings, files, shell integration, or clinical operations are exposed.

## Channel Catalog

The shared channel catalog is defined in `src/shared/ipc/channels.ts`.

| Operation         | Channel                           | Request                  | Success data                                                                                             |
| ----------------- | --------------------------------- | ------------------------ | -------------------------------------------------------------------------------------------------------- |
| `app.getInfo()`   | `health-screening:app:get-info`   | `{}` strict empty object | `{ applicationName, applicationVersion, platform, architecture, packaged }`                              |
| `app.getHealth()` | `health-screening:app:get-health` | `{}` strict empty object | `{ status: 'ready', ipc: 'available', database: 'not-configured', clinicalFeatures: 'not-implemented' }` |

Only these two channels exist for HSD-005. The renderer never receives a channel
string argument, a generic invoke method, or any dynamic dispatch surface.

## Result Envelope

Every IPC operation resolves to a discriminated result:

```ts
type IpcResult<T> =
  { ok: true; data: T } | { ok: false; error: { code: IpcErrorCode; message: string } }
```

Safe error codes:

| Code                | Meaning                                                          |
| ------------------- | ---------------------------------------------------------------- |
| `VALIDATION_FAILED` | A request or trusted response did not match the schema.          |
| `IPC_FORBIDDEN`     | The sender frame or origin is not trusted.                       |
| `IPC_UNAVAILABLE`   | The preload transport failed or returned an unreadable envelope. |
| `INTERNAL_ERROR`    | The trusted process could not complete the request.              |

Renderer-visible messages are stable and safe. They must not contain stack
traces, filesystem paths, hostnames, usernames, payloads, command-line values,
environment variables, or raw Electron errors.

## Schema Authority

Zod schemas in `src/shared/ipc` are the runtime authority for requests,
responses, and envelopes. TypeScript types are inferred from those schemas.
Do not manually duplicate contract shapes elsewhere.

All HSD-005 request schemas are strict empty objects. All HSD-005 response data
is structured-clone-safe plain data containing strings and booleans only.

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

`registerApplicationIpcHandlers` removes the application-owned HSD-005 handlers,
registers exactly the two supported channels, and returns a disposer. The
disposer removes only those two namespaced handlers and leaves unrelated
channels untouched. Re-registration must not accumulate duplicate handlers.

Handlers are registered after `app.whenReady()` and HSD-004 session security
configuration, before the renderer is loaded.

## Preload Bridge

`window.healthScreening` exposes one fixed nested object:

```ts
window.healthScreening.app.getInfo()
window.healthScreening.app.getHealth()
```

Each method calls `ipcRenderer.invoke` with one compile-time channel constant
and `{}`. The preload validates the returned envelope before passing it to the
renderer. Invoke rejection or malformed responses map to `IPC_UNAVAILABLE`.

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
