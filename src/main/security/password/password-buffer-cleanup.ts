export function zeroBytesBestEffort(bytes: Uint8Array | undefined): void {
  if (bytes === undefined) {
    return
  }

  try {
    Uint8Array.prototype.fill.call(bytes, 0)
  } catch {
    // Best-effort cleanup must never replace the operation result or controlled error.
  }
}

export function zeroByteBuffersBestEffort(bytes: readonly Uint8Array[]): void {
  for (const buffer of bytes) {
    zeroBytesBestEffort(buffer)
  }
}
