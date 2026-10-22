import bcrypt from 'bcryptjs'
import { z } from 'zod'
import type { PrismaClient } from '../db.ts'
import { parse } from '../errors.ts'

const BCRYPT_COST = 12
const MIN_CHARACTERS = 12
// bcrypt reads only the first 72 bytes, so a longer password would silently match a different one.
const MAX_BYTES = 72

/**
 * A cost-12 hash of a throwaway string. Login compares against it when the email is unknown, so
 * unknown emails cost the same as wrong passwords.
 */
export const DUMMY_PASSWORD_HASH = '$2b$12$y0tpY00X./ty6KaYIVYpwuMDt1mf6Dw1fzkExTvQoMhEvJDJ/B9oi'

/** Characters (code points) count toward the minimum; UTF-8 bytes count toward the maximum. */
export const passwordSchema = z
  .string()
  .refine((value) => [...value].length >= MIN_CHARACTERS, {
    message: `Use at least ${MIN_CHARACTERS} characters.`,
  })
  .refine((value) => Buffer.byteLength(value, 'utf8') <= MAX_BYTES, {
    message: `Use at most ${MAX_BYTES} bytes; shorten the password.`,
  })

export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_COST)
}

/**
 * False for a password over the byte limit even when its first 72 bytes match: bcrypt ignores the
 * rest, so the stored password plus any suffix would otherwise sign in. The compare still runs so
 * the response takes the same time.
 */
export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  const matches = await bcrypt.compare(plain, hash)
  return matches && Buffer.byteLength(plain, 'utf8') <= MAX_BYTES
}

/** Sets a new password for the account with this email. False when no such account exists. */
export async function setPasswordByEmail(
  prisma: PrismaClient,
  email: string,
  plain: string,
): Promise<boolean> {
  const password = parse(passwordSchema, plain)
  const user = await prisma.user.findUnique({
    where: { email: email.trim().toLowerCase() },
    select: { id: true },
  })
  if (!user) return false
  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: await hashPassword(password) },
  })
  return true
}
