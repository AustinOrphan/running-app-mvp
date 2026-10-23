import { Router } from 'express'
import type { Deps } from '../app.ts'
import { weeklyUpdateStatus } from '../jobs/scheduler.ts'
import { latestJobRuns } from '../services/syncLog.ts'
import type { JobsView } from '../../shared/types.ts'

/**
 * `GET /api/jobs`: the latest run of each scheduled job and whether this week's automatic plan
 * update has run (spec 4.7). Today's health note reads both.
 */
export function jobsRouter(deps: Deps): Router {
  const { prisma } = deps
  const router = Router()

  router.get('/', async (req, res) => {
    const view: JobsView = {
      jobs: await latestJobRuns(prisma, req.userId),
      weeklyUpdate: await weeklyUpdateStatus(prisma, req.userId, new Date()),
    }
    res.json(view)
  })

  return router
}
