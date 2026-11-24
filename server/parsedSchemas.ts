import { z } from 'zod'
import { isIsoDate } from '../shared/dates.ts'
import { MAX_DISTANCE_M, MAX_DURATION_SEC, MAX_ELEVATION_GAIN_M } from '../shared/limits.ts'

/**
 * The range checks on a parsed activity and a parsed wellness day. The browser-parsed import
 * (`POST /api/imports/parsed`) parses its body with them, and a push provider (the Apple Health
 * push) runs each value it maps through the same schemas, so no second set of bounds exists.
 */

/** Samples one parsed activity may carry. */
const MAX_SAMPLES = 100_000

const nullableNumber = (min: number, max: number) => z.number().min(min).max(max).nullable()
const nullableInt = (min: number, max: number) => z.number().int().min(min).max(max).nullable()
const sampleArray = z.array(z.number()).max(MAX_SAMPLES)

const lapSchema = z.strictObject({
  startSec: z.number().min(0).max(MAX_DURATION_SEC),
  durationSec: z.number().min(0).max(MAX_DURATION_SEC),
  distanceM: nullableNumber(0, MAX_DISTANCE_M),
  avgHr: nullableNumber(0, 300),
  maxHr: nullableNumber(0, 300),
  avgCadence: nullableNumber(0, 400),
})

const samplesSchema = z
  .strictObject({
    t: sampleArray,
    d: sampleArray.nullable(),
    hr: sampleArray.nullable(),
    alt: sampleArray.nullable(),
    cad: sampleArray.nullable(),
    pwr: sampleArray.nullable(),
  })
  .superRefine((samples, ctx) => {
    for (const key of ['d', 'hr', 'alt', 'cad', 'pwr'] as const) {
      const series = samples[key]
      if (series !== null && series.length !== samples.t.length) {
        ctx.addIssue({
          code: 'custom',
          path: [key],
          message: `${key} must have the same length as t (${samples.t.length}).`,
        })
      }
    }
  })

export const parsedActivitySchema = z.strictObject({
  providerKey: z.string().min(1).max(200),
  startUtc: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/, 'Use an ISO 8601 instant ending in Z.')
    .refine((text) => !Number.isNaN(Date.parse(text)), 'Use a real instant.'),
  utcOffsetMin: nullableInt(-1080, 1140),
  type: z.enum(['run', 'race', 'strength', 'cross']),
  subtype: z.string().min(1).max(40).nullable(),
  elapsedSec: z.number().min(1).max(MAX_DURATION_SEC),
  movingSec: nullableNumber(0, MAX_DURATION_SEC),
  distanceM: nullableNumber(0, MAX_DISTANCE_M),
  elevationGainM: nullableNumber(0, MAX_ELEVATION_GAIN_M),
  elevationLossM: nullableNumber(0, MAX_ELEVATION_GAIN_M),
  avgHr: nullableNumber(0, 300),
  maxHr: nullableNumber(0, 300),
  avgCadence: nullableNumber(0, 400),
  avgPowerW: nullableNumber(0, 3000),
  deviceName: z.string().max(200).nullable(),
  startLat: nullableNumber(-90, 90),
  startLng: nullableNumber(-180, 180),
  samples: samplesSchema,
  laps: z.array(lapSchema).max(1000),
})

export const wellnessInputSchema = z.strictObject({
  date: z.string().refine(isIsoDate, 'Use a real date written YYYY-MM-DD.'),
  restingHr: nullableNumber(25, 110),
  hrvRmssd: nullableNumber(0, 500),
  hrvSdnn: nullableNumber(0, 500),
  sleepSec: nullableNumber(0, 86_400),
  // Absent from a client that predates the column: no time in bed.
  inBedSec: nullableNumber(0, 86_400).default(null),
  sleepScore: nullableNumber(0, 100),
  weightKg: nullableNumber(30, 250),
  vo2max: nullableNumber(10, 100),
})
