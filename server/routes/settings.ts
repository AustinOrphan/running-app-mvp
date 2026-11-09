import { Router } from 'express'
import { z } from 'zod'
import type { Deps } from '../app.ts'
import { notFound, parse } from '../errors.ts'
import { isValidTimezone } from '../../shared/domain/timezone.ts'
import { toWeightUnit } from '../serialize.ts'
import type { Units, UserSettings } from '../../shared/types.ts'

const updateSchema = z.strictObject({
  units: z.enum(['mi', 'km']).optional(),
  weightUnit: z.enum(['lb', 'kg']).optional(),
  showBodyWeight: z.boolean().optional(),
  hideMapEnds: z.boolean().optional(),
  displayName: z
    .string()
    .trim()
    .max(80)
    .transform((name) => (name === '' ? null : name))
    .nullable()
    .optional(),
})

/** What the browser knows about its runner: the units its locale implies and its time zone. */
const browserDefaultsSchema = z.strictObject({
  units: z.enum(['mi', 'km']),
  weightUnit: z.enum(['lb', 'kg']),
  timezone: z.string().refine(isValidTimezone, 'Use an IANA timezone such as Europe/London.'),
})

export function settingsRouter(deps: Deps): Router {
  const { prisma } = deps
  const router = Router()

  function toSettings(user: {
    email: string
    displayName: string | null
    units: string
    weightUnit: string
    showBodyWeight: boolean
    hideMapEnds: boolean
  }) {
    const settings: UserSettings = {
      email: user.email,
      displayName: user.displayName,
      units: user.units as Units,
      weightUnit: toWeightUnit(user.weightUnit),
      showBodyWeight: user.showBodyWeight,
      hideMapEnds: user.hideMapEnds,
    }
    return settings
  }

  router.get('/', async (req, res) => {
    const user = await prisma.user.findUnique({ where: { id: req.userId } })
    if (!user) throw notFound()
    res.json(toSettings(user))
  })

  router.put('/', async (req, res) => {
    const body = parse(updateSchema, req.body)
    const exists = await prisma.user.findUnique({ where: { id: req.userId } })
    if (!exists) throw notFound()
    const user = await prisma.user.update({
      where: { id: req.userId },
      data: {
        ...(body.units === undefined ? {} : { units: body.units }),
        ...(body.weightUnit === undefined ? {} : { weightUnit: body.weightUnit }),
        // Units the runner wrote are theirs: the browser's locale no longer replaces them.
        ...(body.units === undefined && body.weightUnit === undefined
          ? {}
          : { unitsFromBrowser: false }),
        ...(body.showBodyWeight === undefined ? {} : { showBodyWeight: body.showBodyWeight }),
        ...(body.hideMapEnds === undefined ? {} : { hideMapEnds: body.hideMapEnds }),
        ...(body.displayName === undefined ? {} : { displayName: body.displayName }),
      },
    })
    res.json(toSettings(user))
  })

  // The first load of an account that create-user made without units or a zone. Each value is taken
  // once, only while its flag is set, and the flag is cleared at once, so a later change in Settings
  // or on the Profile page is never overwritten. The zone is saved only while the profile still
  // reads the UTC default.
  router.post('/browser-defaults', async (req, res) => {
    const body = parse(browserDefaultsSchema, req.body)
    const user = await prisma.user.findUnique({ where: { id: req.userId } })
    if (!user) throw notFound()
    if (user.zoneFromBrowser) {
      const profile = await prisma.athleteProfile.findUnique({
        where: { userId: user.id },
        select: { timezone: true },
      })
      if (profile === null || profile.timezone === 'UTC') {
        await prisma.athleteProfile.upsert({
          where: { userId: user.id },
          create: { userId: user.id, timezone: body.timezone },
          update: { timezone: body.timezone },
        })
      }
    }
    const saved = await prisma.user.update({
      where: { id: user.id },
      data: {
        ...(user.unitsFromBrowser ? { units: body.units, weightUnit: body.weightUnit } : {}),
        unitsFromBrowser: false,
        zoneFromBrowser: false,
      },
    })
    res.json(toSettings(saved))
  })

  return router
}
