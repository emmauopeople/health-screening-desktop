import {
  randomBytes,
  scrypt,
  timingSafeEqual as nodeTimingSafeEqual,
  type ScryptOptions
} from 'node:crypto'

import type { PasswordCryptoProvider, ScryptV1PasswordParameters } from './password-types'

export function createNodePasswordCryptoProvider(): PasswordCryptoProvider {
  return Object.freeze({
    randomBytes(length: number): Promise<Uint8Array> {
      return new Promise((resolve, reject) => {
        randomBytes(length, (error, bytes) => {
          if (error !== null) {
            reject(error)
            return
          }

          resolve(bytes)
        })
      })
    },

    scrypt(
      password: Uint8Array,
      salt: Uint8Array,
      keyLength: number,
      parameters: ScryptV1PasswordParameters
    ): Promise<Uint8Array> {
      const options: ScryptOptions = {
        N: parameters.N,
        r: parameters.r,
        p: parameters.p,
        maxmem: parameters.maxmem
      }

      return new Promise((resolve, reject) => {
        scrypt(password, salt, keyLength, options, (error, derivedKey) => {
          if (error !== null) {
            reject(error)
            return
          }

          resolve(derivedKey)
        })
      })
    },

    timingSafeEqual(left: Uint8Array, right: Uint8Array): boolean {
      return nodeTimingSafeEqual(left, right)
    }
  })
}
