import { Readable, pipeline } from 'node:stream'
import { Router } from 'express'
import { z } from 'zod'
import type { Deps } from '../app.ts'
import { hashToken, newToken } from '../crypto.ts'
import { HttpError, parse } from '../errors.ts'
import { exportArchive, exportEntryCount } from '../services/exportArchive.ts'
import { MAX_ZIP_ENTRIES } from '../services/zipWriter.ts'
import { todayIso } from '../../shared/dates.ts'

const getQuery = z.strictObject({ token: z.string().min(1).max(100).optional() })

/** How long a download token lives. */
export const EXPORT_TOKEN_TTL_MS = 60_000

function alreadyRunning(): HttpError {
  return new HttpError(
    429,
    'conflict',
    'An export is already running. Wait for it to finish, then try again.',
    { code: 'export-running' },
  )
}

/**
 * The full-data export, in two steps so the browser's download manager can stream the archive to
 * disk instead of the page holding it in memory, and so that no page can start an export on its
 * own (a plain GET carries the session cookie from any site):
 *
 * - `POST /api/export/token` (same-origin guard, signed in) checks that no export of the runner is
 *   running and answers a single-use token bound to the runner, valid for a minute.
 * - `GET /api/export?token=...` consumes the token and streams the ZIP (see
 *   `services/exportArchive.ts`). Without a valid token it answers 403 and does no work. `HEAD`
 *   does no work either.
 *
 * Both sit below `requireAuth`. One export at a time per runner: a second gets 429 until the first
 * ends, however it ends. Tokens are held in memory as SHA-256 hashes, dropped when they expire,
 * and never logged (the access log redacts the query). The log gets the size and the duration of
 * an export, never a row.
 */
export function exportRouter(deps: Deps): Router {
  const { prisma } = deps
  const router = Router()
  // Per process, which is the whole app: one Node process owns the SQLite file.
  const running = new Set<string>()
  const tokens = new Map<string, { userId: string; expires: number }>()

  function dropExpired(now: number): void {
    for (const [hash, held] of tokens) if (held.expires <= now) tokens.delete(hash)
  }

  /** Refuses, before any byte is sent, an account that a ZIP without ZIP64 cannot hold. */
  async function assertFits(userId: string): Promise<void> {
    const entries = await exportEntryCount(prisma, userId)
    if (entries > MAX_ZIP_ENTRIES) {
      throw new HttpError(
        413,
        'validation',
        `This account has ${String(entries)} files to export; one archive holds at most ${String(MAX_ZIP_ENTRIES)}.`,
        { code: 'export-too-many-files' },
      )
    }
  }

  router.post('/token', async (req, res) => {
    parse(z.strictObject({}), req.query)
    if (running.has(req.userId)) throw alreadyRunning()
    await assertFits(req.userId)
    const now = Date.now()
    dropExpired(now)
    const token = newToken()
    tokens.set(hashToken(token), { userId: req.userId, expires: now + EXPORT_TOKEN_TTL_MS })
    res.set('Cache-Control', 'no-store').json({ token, expiresInSec: EXPORT_TOKEN_TTL_MS / 1000 })
  })

  // Registered before `get`, which Express would otherwise also run for HEAD.
  router.head('/', (_req, res) => {
    res.status(405).set('Allow', 'GET').end()
  })

  router.get('/', async (req, res) => {
    const { token } = parse(getQuery, req.query)
    const userId = req.userId
    const now = Date.now()
    dropExpired(now)
    const hash = token === undefined ? undefined : hashToken(token)
    const held = hash === undefined ? undefined : tokens.get(hash)
    // Consumed on first use, whether or not the rest of the request goes on.
    if (hash !== undefined) tokens.delete(hash)
    if (held === undefined || held.userId !== userId || held.expires <= now) {
      throw new HttpError(403, 'unauthorized', 'Start the download from Settings.')
    }
    if (running.has(userId)) throw alreadyRunning()
    // Refused before a byte is sent: a ZIP without ZIP64 holds 65,535 entries at most.
    await assertFits(userId)
    if (running.has(userId)) throw alreadyRunning()
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
