import { Router } from 'express'
import { z } from 'zod'
import type { Deps } from '../app.ts'
import { notFound, parse } from '../errors.ts'
import { toWeightUnit } from '../serialize.ts'
import type { Units, UserSettings } from '../../shared/types.ts'

const updateSchema = z.strictObject({
  units: z.enum(['mi', 'km']).optional(),
  weightUnit: z.enum(['lb', 'kg']).optional(),
  displayName: z
    .string()
    .trim()
    .max(80)
    .transform((name) => (name === '' ? null : name))
    .nullable()
    .optional(),
})

export function settingsRouter(deps: Deps): Router {
  const { prisma } = deps
  const router = Router()

  function toSettings(user: {
    email: string
    displayName: string | null
    units: string
    weightUnit: string
  }) {
    const settings: UserSettings = {
      email: user.email,
      displayName: user.displayName,
      units: user.units as Units,
      weightUnit: toWeightUnit(user.weightUnit),
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
        ...(body.displayName === undefined ? {} : { displayName: body.displayName }),
      },
    })
    res.json(toSettings(user))
  })

  return router
}
