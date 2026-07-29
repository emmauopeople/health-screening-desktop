import { createHash } from 'node:crypto'

export function canonicalizeMigrationSql(sql: string): string {
  return sql.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')
}

export function computeMigrationChecksum(sql: string): string {
  return createHash('sha256').update(canonicalizeMigrationSql(sql), 'utf8').digest('hex')
}

export function isSha256Checksum(value: string): boolean {
  return /^[a-f0-9]{64}$/.test(value)
}
