import { Router } from 'express'
import { z } from 'zod'
import type { Deps } from '../app.ts'
import { parse } from '../errors.ts'
import { confirmPlanNotice, loadPlanNotice } from '../services/planNotice.ts'

const confirmBody = z.strictObject({
  version: z.number().int().min(1),
  ageConfirmed: z.boolean().optional(),
})

/** GET and PUT /api/plan-notice: the health notice before a first plan (FS1). */
export function planNoticeRouter(deps: Deps): Router {
  const { prisma } = deps
  const router = Router()

  router.get('/', async (req, res) => {
    res.json(await loadPlanNotice(prisma, req.userId, req.runnerDay.today))
  })

  router.put('/', async (req, res) => {
    const body = parse(confirmBody, req.body)
    res.json(
      await confirmPlanNotice(
        prisma,
        req.userId,
        { version: body.version, ageConfirmed: body.ageConfirmed === true },
        new Date(),
        req.runnerDay.today,
      ),
    )
  })

  return router
}
