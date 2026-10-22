// Stub from the data-foundation scaffold; Task D6 implements it.

/** An HMAC-signed `state` carrying the user id and a nonce; valid for 10 minutes. */
export function signState(userId: string, secret: string, now: Date): string {
  void userId
  void secret
  void now
  throw new Error('not implemented')
}

/** The user id inside a valid, unexpired `state`; null otherwise. */
export function verifyState(state: string, secret: string, now: Date): string | null {
  void state
  void secret
  void now
  throw new Error('not implemented')
}
