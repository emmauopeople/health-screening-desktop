# ADR-010: Local Password Credentials

## Status

Accepted for HSD-010.

## Context

The desktop application needs a local password credential primitive for later
first-run administration and authentication services. HSD-010 does not create
users, write credentials, expose IPC, implement login, or add session behavior.

Credential derivation must be asynchronous because HSD-008 SQLite transactions
are synchronous by design. Later services must derive credentials before opening
their caller-owned write transaction, then re-check workflow invariants inside
that transaction before persisting any user or installation data.

## Decision

Use built-in Node.js `crypto.scrypt` for password derivation, with
`randomBytes` for salts and `timingSafeEqual` for verification. This keeps the
Windows-first Electron build free of new native dependencies while using a
reviewed memory-hard password KDF exposed by the runtime.

The only supported credential version is `scrypt-v1`:

- salt length: 32 random bytes
- derived-key length: 64 bytes
- `N`: 32768
- `r`: 8
- `p`: 3
- `maxmem`: 67108864 bytes
- text encoding: UTF-8
- binary encoding: unpadded canonical base64url

`password_hash` stores:

```text
scrypt-v1$N=32768$r=8$p=3$dk=64$<86-character-base64url-derived-key>
```

`password_salt` stores:

```text
<43-character-base64url-salt>
```

The password parser preserves exact input. It does not trim, lowercase,
case-fold, normalize Unicode, collapse whitespace, or enforce arbitrary
composition rules. It only checks reviewed length and unsafe-control-character
rules.

## Deferred Decisions

Argon2 is deferred because it would add a new dependency and likely another
native packaging surface. Bcrypt is deferred because the selected scrypt
parameters provide a memory-hard primitive through Node without an added module.

Peppering, Electron `safeStorage`, field-level encryption, hardware-backed key
storage, and credential rotation are deferred to later reviewed tasks. They must
not be silently introduced in this foundation layer.

## Consequences

Password hashing and verification return promises and must not run inside
`DatabaseTransactionExecutor.run()`. HSD-008 must continue rejecting
Promise-returning transaction callbacks.

Malformed or unsupported stored credentials fail closed with
`PasswordCredentialFormatError`, not a wrong-password result. Crypto-provider
failures are mapped to controlled hashing or verification errors without raw
messages, stacks, causes, plaintext, salts, hashes, or key material.

Mutable password bytes, salt bytes, and derived-key bytes are zero-filled on a
best-effort basis after each operation. JavaScript strings cannot be reliably
erased, so this layer minimizes string lifetime and never stores plaintext in
module state, logs, returned objects, or errors.

Design references:

- OWASP Password Storage Cheat Sheet
- Node.js `crypto` documentation for `scrypt`, `randomBytes`, and
  `timingSafeEqual`
