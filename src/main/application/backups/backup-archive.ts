import { createCipheriv, createDecipheriv, createHash, randomBytes, scrypt } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { appendFile, open, stat } from 'node:fs/promises'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { z } from 'zod'
import { backupMetadataSchema, type BackupMetadata } from '@shared/ipc/backup-contracts'

const magic = Buffer.from('CHSBKP01')
const headerSize = 36
const tagSize = 16
const maximumManifestSize = 8192
export const maximumBackupBytes = 2 * 1024 * 1024 * 1024
const manifestSchema = z
  .object({
    metadata: backupMetadataSchema,
    databaseSha256: z.string().regex(/^[a-f0-9]{64}$/u)
  })
  .strict()
export class InvalidBackupError extends Error {}
export class UnsupportedBackupError extends Error {}

async function deriveKey(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, 32, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (error, key) => {
      if (error) reject(error)
      else resolve(key)
    })
  })
}
export async function hashDatabase(path: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}
export async function encryptBackup(
  databasePath: string,
  archivePath: string,
  password: string,
  metadata: BackupMetadata
): Promise<void> {
  if ((await stat(databasePath)).size > maximumBackupBytes - maximumManifestSize - 64)
    throw new InvalidBackupError()
  const manifest = Buffer.from(
    JSON.stringify({ metadata, databaseSha256: await hashDatabase(databasePath) })
  )
  if (manifest.length > maximumManifestSize) throw new InvalidBackupError()
  const length = Buffer.alloc(4)
  length.writeUInt32BE(manifest.length)
  const salt = randomBytes(16)
  const iv = randomBytes(12)
  const header = Buffer.concat([magic, salt, iv])
  const key = await deriveKey(password, salt)
  try {
    const cipher = createCipheriv('aes-256-gcm', key, iv)
    cipher.setAAD(header)
    const output = await open(archivePath, 'wx', 0o600)
    try {
      await output.writeFile(header)
    } finally {
      await output.close()
    }
    const plaintext = Readable.from(
      (async function* () {
        yield length
        yield manifest
        yield* createReadStream(databasePath)
      })()
    )
    await pipeline(plaintext, cipher, createWriteStream(archivePath, { flags: 'a' }))
    await appendFile(archivePath, cipher.getAuthTag())
  } finally {
    key.fill(0)
  }
}

/** Only authenticated plaintext is parsed or opened as SQLite. Paths belong to a private workspace. */
export async function decryptBackup(
  archivePath: string,
  payloadPath: string,
  databasePath: string,
  password: string
): Promise<BackupMetadata> {
  const source = await open(archivePath, 'r')
  try {
    const info = await source.stat()
    if (!info.isFile() || info.size < headerSize + tagSize + 4 || info.size > maximumBackupBytes)
      throw new InvalidBackupError()
    const header = Buffer.alloc(headerSize)
    await source.read(header, 0, headerSize, 0)
    if (!header.subarray(0, 8).equals(magic)) throw new InvalidBackupError()
    const tag = Buffer.alloc(tagSize)
    await source.read(tag, 0, tagSize, info.size - tagSize)
    const key = await deriveKey(password, header.subarray(8, 24))
    try {
      const decipher = createDecipheriv('aes-256-gcm', key, header.subarray(24))
      decipher.setAAD(header)
      decipher.setAuthTag(tag)
      await pipeline(
        source.createReadStream({
          start: headerSize,
          end: info.size - tagSize - 1,
          autoClose: false
        }),
        decipher,
        createWriteStream(payloadPath, { flags: 'wx', mode: 0o600 })
      )
    } catch {
      throw new InvalidBackupError()
    } finally {
      key.fill(0)
    }
  } finally {
    await source.close()
  }
  const payload = await open(payloadPath, 'r')
  let metadata: BackupMetadata
  let expectedHash: string
  let offset: number
  try {
    const prefix = Buffer.alloc(4)
    if ((await payload.read(prefix, 0, 4, 0)).bytesRead !== 4) throw new InvalidBackupError()
    const size = prefix.readUInt32BE()
    if (size === 0 || size > maximumManifestSize) throw new InvalidBackupError()
    const bytes = Buffer.alloc(size)
    if ((await payload.read(bytes, 0, size, 4)).bytesRead !== size) throw new InvalidBackupError()
    const manifest = manifestSchema.parse(JSON.parse(bytes.toString('utf8')))
    metadata = manifest.metadata
    expectedHash = manifest.databaseSha256
    offset = 4 + size
  } finally {
    await payload.close()
  }
  await pipeline(
    createReadStream(payloadPath, { start: offset }),
    createWriteStream(databasePath, { flags: 'wx', mode: 0o600 })
  )
  if ((await hashDatabase(databasePath)) !== expectedHash) throw new InvalidBackupError()
  return metadata
}
