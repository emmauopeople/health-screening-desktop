# Password Credentials

HSD-010 adds a main-process-only local password credential primitive under
`src/main/security/password`. It is not an authentication service and does not
create users, write SQLite rows, expose IPC, or change renderer behavior.

## Exact Password Input

`parsePlaintextPassword()` accepts only JavaScript strings with 12 through 128
Unicode code points and no more than 512 UTF-8 bytes. It rejects null bytes,
C0/C1 controls, line separators, paragraph separators, and unpaired surrogate
code units.

The parser deliberately preserves exact input. It does not trim leading or
trailing spaces, collapse whitespace, lowercase, case-fold, or normalize
Unicode. Later UI may warn about accidental whitespace, but this cryptographic
foundation must compare the exact sequence supplied by the caller.

## Credential Format

The supported algorithm version is `scrypt-v1` with fixed parameters:

- salt length: 32 random bytes
- derived-key length: 64 bytes
- `N`: 32768
- `r`: 8
- `p`: 3
- `maxmem`: 67108864 bytes
- text encoding: UTF-8
- binary encoding: unpadded canonical base64url

`password_hash` is stored as:

```text
scrypt-v1$N=32768$r=8$p=3$dk=64$<86-character-base64url-derived-key>
```

`password_salt` is stored as:

```text
<43-character-base64url-salt>
```

Parsing is strict. Unsupported versions, changed parameters, reordered or
duplicate segments, padding, standard base64 characters, whitespace, trailing
data, and wrong decoded byte lengths are credential-format failures.

## Hashing And Verification

`createPasswordCredentialService().hash(password)` validates the plaintext,
requests a fresh 32-byte salt from Node `crypto.randomBytes`, derives a
64-byte key through asynchronous `crypto.scrypt`, and returns a frozen
credential object containing only `passwordHash` and `passwordSalt`.

`verify(password, credential)` validates the plaintext, strictly parses the
stored credential, derives a candidate key with the encoded `scrypt-v1`
parameters, and compares equal-length byte arrays with `timingSafeEqual`.
Wrong passwords return `false`; malformed credentials throw
`PasswordCredentialFormatError`.

`validateCredential(credential)` is the reviewed public security-layer
validation boundary for already-derived stored credentials. It accepts unknown
input, strictly validates the exact credential shape and canonical `scrypt-v1`
encoding, returns a new frozen `StoredPasswordCredential` containing only
canonical `passwordHash` and `passwordSalt` strings, and clears decoded salt and
derived-key buffers before returning or throwing. It does not accept plaintext,
derive keys, compare credentials, write repositories, or add persistence
responsibility.

Hashing and verification are asynchronous and must run outside HSD-008
synchronous transaction callbacks. Later first-run services must hash before
opening the write transaction, then re-check installation/user invariants inside
that transaction before inserting related rows atomically.

HSD-018 local login follows the same boundary for verification. It validates
the raw command with `parsePlaintextPassword()`, verifies the candidate password
through `PasswordCredentialService.verify()` before opening the transaction,
and never places scrypt work inside a transaction callback. The production
login service creates one private dummy credential during composition so
unknown usernames can perform dummy verification without returning or logging
that credential.

HSD-020 forced password change follows the same async credential boundary. It
verifies the current password before opening the transaction, verifies the new
password against the existing credential to reject reuse, and hashes the
replacement password before `DatabaseTransactionExecutor.run()`. After hashing,
it validates the replacement through `PasswordCredentialService.validateCredential()`
before exact credential comparison or replacement verification. Active locks skip
verification and hashing. Reused passwords are rejected before any replacement
hash is created.

## Internal Persistence Validation

HSD-011 adds an internal main-process helper,
`password-persistence-validation.ts`, for repository persistence only. It is not
exported from `src/main/security/index.ts` or `src/main/security/password`, and
application services must use the public security-layer validation boundary
instead.

The helper accepts unknown stored-credential input, uses the strict HSD-010
credential parser, returns a new frozen `StoredPasswordCredential` containing
only canonical `passwordHash` and `passwordSalt` strings, and clears decoded
salt and derived-key buffers before returning or throwing. It does not create
credentials, accept plaintext, derive keys, compare credentials, verify
passwords, log, or expose decoded buffers.

HSD-019 uses this helper for the local-user credential-state repository
mutation. That repository accepts only pre-derived stored credentials; password
hashing, password policy, forced password-change orchestration, and audited
credential rotation remain outside the repository boundary and are composed by
HSD-020.

## Error And Secret Safety

Password modules do not log. Controlled password errors have fixed codes and
messages:

- `PasswordValidationError`
- `PasswordCredentialFormatError`
- `PasswordHashingError`
- `PasswordVerificationError`

Errors omit stacks and causes and must not retain plaintext, salts, hashes,
derived keys, crypto options, raw provider errors, paths, SQL, or input
metadata. Mutable password, salt, and key buffers are zero-filled on a
best-effort basis after use. JavaScript string memory cannot be reliably
erased, so callers should also avoid retaining plaintext longer than needed.

Forced password-change services must minimize credential exposure in the same
way. Current and replacement plaintext passwords remain function-local and are
passed only to `PasswordCredentialService.verify()` or
`PasswordCredentialService.hash()`. Password-change results, audit metadata,
errors, logs, IPC contracts, and renderer-facing values must not include
plaintext, hashes, salts, derived keys, or credential-bearing authentication
projections.
