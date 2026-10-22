import { Router } from 'express'
import type { Deps } from '../app.ts'
import { SecretError, hashToken, tokensEqual } from '../crypto.ts'
import { notFound, unauthorized } from '../errors.ts'
import { getProvider } from '../providers/registry.ts'
import { storeParsed, storeWellness } from '../services/activityStore.ts'
import { openIntegration, providerContext } from '../services/sync.ts'
import type { ImportReportRow } from '../../shared/types.ts'

const MAX_REPORT_ROWS = 100

/**
 * `POST /api/ingest/:provider`, authenticated by `Authorization: Bearer <push token>` instead of
 * the session cookie (phone automations send neither a cookie nor an Origin). Only the SHA-256 of
 * a token is stored, and it is compared in constant time.
 */
export function ingestRouter(deps: Deps): Router {
  const { prisma, config } = deps
  const router = Router()

  router.post('/:provider', async (req, res) => {
    const provider = String(req.params.provider)
    const registered = getProvider(provider)
    const push = registered.push
    if (!push) throw notFound()

    const header = req.get('authorization') ?? ''
    const token = /^Bearer\s+(\S+)\s*$/i.exec(header)?.[1]
    if (!token) throw unauthorized('Send the push token as a Bearer Authorization header.')
    const hash = hashToken(token)
    const candidates = await prisma.integration.findMany({
      where: { provider, ingestTokenHash: { not: null } },
    })
    const row = candidates.find(
      (candidate) =>
        candidate.ingestTokenHash !== null && tokensEqual(hash, candidate.ingestTokenHash),
    )
    if (!row) throw unauthorized('The push token is not valid.')

    // A push provider keeps no secret; a rotated session secret must not block it.
    let opened: ReturnType<typeof openIntegration> = { secret: {}, config: {} }
    try {
      opened = openIntegration(row, config.sessionSecret)
    } catch (error) {
      if (!(error instanceof SecretError)) throw error
    }
    const ctx = await providerContext(deps, row.userId, provider, opened)
    const payload = push.parsePush(req.body, ctx)
    const { activities, wellness, ignored = {} } = payload

    let accepted = 0
    let batchId: string | null = null
    const counts = { skippedDuplicate: 0, skippedInvalid: 0 }
    const report: ImportReportRow[] = []
    const failed: Array<{ providerKey: string; reason: string }> = []
    if (activities.length > 0) {
      const batch = await prisma.importBatch.create({
        data: {
          userId: row.userId,
          source: provider,
          fileName: null,
          rowCount: activities.length,
          accepted: 0,
          skippedDuplicate: 0,
          skippedInvalid: 0,
          errors: '[]',
        },
      })
      batchId = batch.id
      for (const parsed of activities) {
        try {
          const stored = await storeParsed(deps, row.userId, parsed, {
            source: provider,
            importBatchId: batchId,
            channel: 'push',
          })
          if (stored.outcome === 'duplicate') counts.skippedDuplicate += 1
          else accepted += 1
        } catch (error) {
          counts.skippedInvalid += 1
          const reason = error instanceof Error ? error.message : String(error)
          if (failed.length < MAX_REPORT_ROWS)
            failed.push({ providerKey: parsed.providerKey, reason })
          if (report.length < MAX_REPORT_ROWS) {
            report.push({ line: null, reason: `${parsed.providerKey}: ${reason}` })
          }
        }
      }
      await prisma.importBatch.update({
        where: { id: batchId },
        data: { accepted, ...counts, errors: JSON.stringify(report) },
      })
    }
    const wellnessRows = await storeWellness(deps, row.userId, wellness, provider)

    // A push where every activity failed to store is a failed sync, not a connected one.
    const allFailed = activities.length > 0 && counts.skippedInvalid === activities.length
    await prisma.integration.update({
      where: { id: row.id },
      data: allFailed
        ? {
            status: 'error',
            lastSyncAt: new Date(),
            lastSyncStatus: 'error',
            lastError: `Every pushed activity failed to store: ${failed[0]?.reason ?? 'unknown error'}`,
          }
        : {
            status: 'connected',
            lastSyncAt: new Date(),
            lastSyncStatus: 'ok',
            lastError: null,
          },
    })
    res.json({ activities: accepted, wellness: wellnessRows, ignored, failed })
  })

  return router
}
