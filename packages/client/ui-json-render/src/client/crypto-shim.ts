/**
 * Browser stand-in for Node's `crypto` module. `uuid` resolves its Node build
 * inside this client bundle and only needs these two functions.
 */

const webcrypto = globalThis.crypto

/** RFC 4122 UUID from the browser Web Crypto API. */
export function randomUUID(): string {
  return webcrypto.randomUUID()
}

/** Fill a view with browser random bytes. `uuid` uses this for its pool. */
export function randomFillSync(buffer: Uint8Array): Uint8Array {
  const bytes = new Uint8Array(buffer.byteLength)
  webcrypto.getRandomValues(bytes)
  buffer.set(bytes)
  return buffer
}

export default { randomFillSync, randomUUID }
