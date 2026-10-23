import {
  createCipheriv,
  createDecipheriv,
  createHash,
  hkdfSync,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto'

const SALT = 'rl-integrations-v1'
const VERSION = 'v1'
const IV_BYTES = 12
const TAG_BYTES = 16

/** Thrown when a stored secret cannot be decrypted, for example after SESSION_SECRET changed. */
export class SecretError extends Error {
  constructor(message = 'The stored secret could not be decrypted.') {
    super(message)
    this.name = 'SecretError'
  }
}

function deriveKey(sessionSecret: string): Buffer {
  return Buffer.from(hkdfSync('sha256', sessionSecret, SALT, 'aes-256-gcm', 32))
}

/** AES-256-GCM; the result is `v1.<iv>.<tag>.<ciphertext>`, each part base64url. */
export function encryptSecret(plain: string, sessionSecret: string): string {
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv('aes-256-gcm', deriveKey(sessionSecret), iv)
  const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return [
    VERSION,
    iv.toString('base64url'),
    tag.toString('base64url'),
    ciphertext.toString('base64url'),
  ].join('.')
}

/** Throws `SecretError` for a malformed blob, a tampered tag or a different session secret. */
export function decryptSecret(blob: string, sessionSecret: string): string {
  const parts = blob.split('.')
  if (parts.length !== 4 || parts[0] !== VERSION) throw new SecretError()
  try {
    const iv = Buffer.from(parts[1] ?? '', 'base64url')
    const tag = Buffer.from(parts[2] ?? '', 'base64url')
    const ciphertext = Buffer.from(parts[3] ?? '', 'base64url')
    if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) throw new SecretError()
    const decipher = createDecipheriv('aes-256-gcm', deriveKey(sessionSecret), iv)
    decipher.setAuthTag(tag)
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
  } catch {
    throw new SecretError()
  }
}

/** SHA-256 of a push token, hex. Only this hash is stored. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

/**
 * The short tag of a user in what the app writes to the outside (`rl-<tag>-<externalId>`, design
 * 4.1): the first 6 hex characters of the SHA-256 of the user id, so that two installs writing to
 * one account or one calendar cannot overwrite each other. It names nobody and is not a secret.
 */
export function userTagOf(userId: string): string {
  return createHash('sha256').update(userId).digest('hex').slice(0, 6)
}

/** 32 random bytes, base64url. */
export function newToken(): string {
  return randomBytes(32).toString('base64url')
}

/** Constant-time comparison; strings of different length are unequal. */
export function tokensEqual(a: string, b: string): boolean {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  return left.length === right.length && timingSafeEqual(left, right)
}
