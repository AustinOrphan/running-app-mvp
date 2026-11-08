import { Readable, pipeline } from 'node:stream'
import { Router } from 'express'
import { z } from 'zod'
import type { Deps } from '../app.ts'
import { HttpError, parse } from '../errors.ts'
import { exportArchive } from '../services/exportArchive.ts'
import { todayIso } from '../../shared/dates.ts'

const noQuery = z.strictObject({})

/**
 * `GET /api/export`: one ZIP of everything the signed-in runner owns, streamed (see
 * `services/exportArchive.ts`). Mounted below `requireAuth`, so an anonymous request is a 401 before
 * anything is read. One export at a time per runner: a second request gets 429 until the first
 * ends, however it ends. The log gets the size and the duration, never a row.
 */
export function exportRouter(deps: Deps): Router {
  const { prisma } = deps
  const router = Router()
  // Per process, which is the whole app: one Node process owns the SQLite file.
  const running = new Set<string>()

  router.get('/', (req, res) => {
    parse(noQuery, req.query)
    const userId = req.userId
    if (running.has(userId)) {
      throw new HttpError(
        429,
        'conflict',
        'An export is already running. Wait for it to finish, then try again.',
        { code: 'export-running' },
      )
    }
    running.add(userId)
    const started = Date.now()
    let bytes = 0
    res.once('close', () => {
      running.delete(userId)
    })

    async function* counted(): AsyncGenerator<Buffer> {
      for await (const chunk of exportArchive(prisma, userId, new Date())) {
        bytes += chunk.length
        yield chunk
      }
    }

    res
      .status(200)
      .type('application/zip')
      .set('Content-Disposition', `attachment; filename="running-log-export-${todayIso()}.zip"`)
      .set('Cache-Control', 'no-store')
    // `pipeline` ends the response with the stream's error, so a broken export is a cut-off
    // download that no unzip tool accepts, never a short archive that looks whole.
    pipeline(Readable.from(counted()), res, (error) => {
      const ms = Date.now() - started
      if (error) req.log.error({ err: error, bytes, ms }, 'export stopped before the end')
      else req.log.info({ bytes, ms }, 'export finished')
    })
  })

  return router
}
