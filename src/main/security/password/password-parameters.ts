export const scryptV1PasswordParameters = Object.freeze({
  algorithm: 'scrypt-v1',
  saltBytes: 32,
  derivedKeyBytes: 64,
  N: 32768,
  r: 8,
  p: 3,
  maxmem: 67108864,
  textEncoding: 'utf-8',
  binaryEncoding: 'base64url'
} as const)

export const passwordHashAlgorithm = scryptV1PasswordParameters.algorithm
export const passwordHashPrefix = `${passwordHashAlgorithm}$N=${scryptV1PasswordParameters.N}$r=${scryptV1PasswordParameters.r}$p=${scryptV1PasswordParameters.p}$dk=${scryptV1PasswordParameters.derivedKeyBytes}$`
export const passwordSaltCharacterLength = 43
export const passwordDerivedKeyCharacterLength = 86
