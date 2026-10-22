import { Router } from 'express'
import { z } from 'zod'
import type { Deps } from '../app.ts'
import { parse, validationError } from '../errors.ts'
import { loadProfile } from '../serialize.ts'
import type { AthleteProfile, ValidationIssue, Weekday } from '../../shared/types.ts'

const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const

function validTimezone(name: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: name })
    return true
  } catch {
    return false
  }
}

const nullableInt = (min: number, max: number) => z.number().int().min(min).max(max).nullable()
const nullableNumber = (min: number, max: number) => z.number().min(min).max(max).nullable()

const dayAvailability = z.strictObject({
  available: z.boolean(),
  maxMin: nullableInt(0, 600),
})

function buildSchema(now: Date) {
  const year = now.getFullYear()
  return z.strictObject({
    birthYear: nullableInt(1920, year - 10).optional(),
    sex: z.enum(['female', 'male', 'unspecified']).nullable().optional(),
    heightCm: nullableNumber(100, 230).optional(),
    weightKg: nullableNumber(30, 250).optional(),
    hrMax: nullableInt(120, 230).optional(),
    hrMaxSource: z.enum(['measured', 'estimated']).nullable().optional(),
    hrRest: nullableInt(25, 110).optional(),
    lthr: nullableInt(100, 220).optional(),
    thresholdPaceSecPerKm: nullableInt(150, 900).optional(),
    runningSinceYear: nullableInt(1950, year).optional(),
    injuries: z
      .array(
        z.strictObject({
          area: z.string().trim().min(1).max(80),
          side: z.enum(['left', 'right', 'both']).nullable(),
          year: z.number().int().min(1950).max(year),
          month: nullableInt(1, 12),
          kind: z.enum(['bone-stress', 'tendon', 'muscle', 'joint', 'other']),
          notes: z.string().trim().max(500).nullable(),
        }),
      )
      .max(50)
      .optional(),
    availability: z
      .strictObject(
        Object.fromEntries(WEEKDAYS.map((day) => [day, dayAvailability])) as Record<
          Weekday,
          typeof dayAvailability
        >,
      )
      .optional(),
    longRunDay: z.enum(WEEKDAYS).optional(),
    terrain: z
      .strictObject({
        trail: z.boolean(),
        hills: z.boolean(),
        treadmill: z.boolean(),
        track: z.boolean(),
      })
      .optional(),
    strengthPreference: z
      .union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)])
      .optional(),
    timezone: z
      .string()
      .refine(validTimezone, 'Use an IANA timezone such as Europe/London.')
      .optional(),
    homeLat: nullableNumber(-90, 90).optional(),
    homeLng: nullableNumber(-180, 180).optional(),
    useHomeWeather: z.boolean().optional(),
  })
}

/** The home location is stored at 0.01 degrees, about one kilometre. */
function round2(value: number | null): number | null {
  if (value === null) return null
  const rounded = Math.round(value * 100) / 100
  return rounded === 0 ? 0 : rounded
}

function crossChecks(profile: AthleteProfile): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  if (profile.hrMax !== null && profile.lthr !== null && profile.lthr >= profile.hrMax) {
    issues.push({ path: 'lthr', message: 'Threshold heart rate must be below the maximum.' })
  }
  if ((profile.homeLat === null) !== (profile.homeLng === null)) {
    issues.push({
      path: profile.homeLat === null ? 'homeLat' : 'homeLng',
      message: 'Give both home coordinates, or neither.',
    })
  }
  return issues
}

export function profileRouter(deps: Deps): Router {
  const { prisma } = deps
  const router = Router()

  router.get('/', async (req, res) => {
    res.json(await loadProfile(prisma, req.userId))
  })

  // Fields that are absent keep their saved value; a null clears a nullable one.
  router.put('/', async (req, res) => {
    const body = parse(buildSchema(new Date()), req.body)
    const merged: AthleteProfile = { ...(await loadProfile(prisma, req.userId)) }
    Object.assign(merged, body)
    merged.homeLat = round2(merged.homeLat)
    merged.homeLng = round2(merged.homeLng)
    if (merged.hrMax === null) merged.hrMaxSource = null

    const issues = crossChecks(merged)
    if (issues.length > 0) throw validationError('Some fields need attention.', issues)

    const data = {
      birthYear: merged.birthYear,
      sex: merged.sex,
      heightCm: merged.heightCm,
      weightKg: merged.weightKg,
      hrMax: merged.hrMax,
      hrMaxSource: merged.hrMaxSource,
      hrRest: merged.hrRest,
      lthr: merged.lthr,
      thresholdPaceSecPerKm: merged.thresholdPaceSecPerKm,
      runningSinceYear: merged.runningSinceYear,
      injuries: JSON.stringify(merged.injuries),
      availability: JSON.stringify(merged.availability),
      longRunDay: merged.longRunDay,
      terrain: JSON.stringify(merged.terrain),
      strengthPreference: merged.strengthPreference,
      timezone: merged.timezone,
      homeLat: merged.homeLat,
      homeLng: merged.homeLng,
      useHomeWeather: merged.useHomeWeather,
    }
    await prisma.athleteProfile.upsert({
      where: { userId: req.userId },
      create: { userId: req.userId, ...data },
      update: data,
    })
    res.json(await loadProfile(prisma, req.userId))
  })

  return router
}
