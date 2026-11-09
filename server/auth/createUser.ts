import { randomBytes } from 'node:crypto'
import { z } from 'zod'
import type { PrismaClient } from '../db.ts'
import { conflict, parse } from '../errors.ts'
import { isValidTimezone } from '../../shared/domain/timezone.ts'
import type { Units, WeightUnit } from '../../shared/types.ts'
import { hashPassword, passwordSchema } from './password.ts'

/** 18 random bytes read as base64url: 24 characters, 144 bits. */
const TEMPORARY_PASSWORD_BYTES = 18

const createUserSchema = z.strictObject({
  email: z.string().trim().toLowerCase().pipe(z.email('Enter a valid email address.')),
  displayName: z.string().trim().max(80).optional(),
  units: z.enum(['mi', 'km'], { error: "Use 'mi' or 'km' for the distance units." }).optional(),
  weightUnit: z.enum(['lb', 'kg'], { error: "Use 'kg' or 'lb' for the weight unit." }).optional(),
  timezone: z
    .string()
    .refine(isValidTimezone, 'Use an IANA time zone such as Europe/London.')
    .optional(),
})

export type CreateUserInput = z.input<typeof createUserSchema>

export interface CreatedUser {
  id: string
  email: string
  /** Shown once by the caller; only its hash is stored. */
  temporaryPassword: string
}

/** A long random password that satisfies `passwordSchema`. */
export function generateTemporaryPassword(): string {
  return randomBytes(TEMPORARY_PASSWORD_BYTES).toString('base64url')
}

/**
 * The units and weight unit an account starts with. Either given value decides the other (km goes
 * with kg, mi with lb) unless that one is given too; with neither, nothing is decided here and the
 * browser's locale picks on the first load.
 */
function startingUnits(
  units: Units | undefined,
  weightUnit: WeightUnit | undefined,
): { units: Units; weightUnit: WeightUnit } | null {
  if (units === undefined && weightUnit === undefined) return null
  return {
    units: units ?? (weightUnit === 'kg' ? 'km' : 'mi'),
    weightUnit: weightUnit ?? (units === 'km' ? 'kg' : 'lb'),
  }
}

/**
 * Creates an account with a generated temporary password and marks it so that the first sign-in
 * asks for a new one. Throws a validation `HttpError` for a bad email, unit or zone and a conflict
 * for an email that is taken. A unit or zone that is not given is left for the browser to set on
 * the first load (`unitsFromBrowser`, `zoneFromBrowser`).
 */
export async function createUser(
  prisma: PrismaClient,
  input: CreateUserInput,
): Promise<CreatedUser> {
  const body = parse(createUserSchema, input)
  const taken = await prisma.user.findUnique({ where: { email: body.email }, select: { id: true } })
  if (taken) throw conflict('An account with that email already exists.')

  const temporaryPassword = parse(passwordSchema, generateTemporaryPassword())
  const start = startingUnits(body.units, body.weightUnit)
  const user = await prisma.user.create({
    data: {
      email: body.email,
      passwordHash: await hashPassword(temporaryPassword),
      displayName: body.displayName || null,
      mustChangePassword: true,
      unitsFromBrowser: start === null,
      zoneFromBrowser: body.timezone === undefined,
      ...(start ?? {}),
      ...(body.timezone === undefined ? {} : { profile: { create: { timezone: body.timezone } } }),
    },
    select: { id: true, email: true },
  })
  return { id: user.id, email: user.email, temporaryPassword }
}
