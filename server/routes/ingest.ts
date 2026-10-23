import express, { Router, type RequestHandler, type Response } from 'express'
import type { Deps } from '../app.ts'
import { SecretError, hashToken, tokensEqual } from '../crypto.ts'
import type { Integration } from '../db.ts'
import { HttpError, notFound, unauthorized } from '../errors.ts'
import { getProvider } from '../providers/registry.ts'
import { storeParsed, storeWellness } from '../services/activityStore.ts'
import { openIntegration, providerContext } from '../services/sync.ts'
import { MAX_FAILURES_STORED, recordSyncRun, syncMessage } from '../services/syncLog.ts'
import type { ImportReportRow } from '../../shared/types.ts'

const MAX_REPORT_ROWS = 100

/** A pushed workout export may carry up to 16 MB of JSON; the parser starts after the token check. */
const INGEST_BODY_LIMIT = '16mb'

/** The key under which the token check hands the integration it matched to the handler. */
const PUSH_INTEGRATION = 'pushIntegration'

/** The integration that the token check matched; the handler runs only after that check. */
function matchedIntegration(res: Response): Integration {
  return res.locals[PUSH_INTEGRATION] as Integration
}

/**
 * `POST /api/ingest/:provider`, authenticated by `Authorization: Bearer <push token>` instead of
 * the session cookie (phone automations send neither a cookie nor an Origin). Only the SHA-256 of
 * a token is stored, and it is compared in constant time. The token is verified before a byte of
 * the body is read: the 16 MB JSON parser is a step of this route, after the check (phase 3a design
 * 4.8), so an unknown token costs one lookup, not a buffered upload.
 */
export function ingestRouter(deps: Deps): Router {
  const { prisma, config } = deps
  const router = Router()

  const verifyToken: RequestHandler = async (req, res, next) => {
    const provider = String(req.params.provider)
    if (!getProvider(provider).push) throw notFound()

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
    res.locals[PUSH_INTEGRATION] = row
    next()
  }

  router.post(
    '/:provider',
    verifyToken,
    express.json({ limit: INGEST_BODY_LIMIT }),
    async (req, res) => {
      const provider = String(req.params.provider)
      const push = getProvider(provider).push
      if (!push) throw notFound()
      const row = matchedIntegration(res)

      // A push provider keeps no secret; a rotated session secret must not block it.
      let opened: ReturnType<typeof openIntegration> = { secret: {}, config: {} }
      try {
        opened = openIntegration(row, config.sessionSecret)
      } catch (error) {
        if (!(error instanceof SecretError)) throw error
      }
      const ctx = await providerContext(deps, row.userId, provider, opened)
      const startedAt = new Date()

      let accepted = 0
      let batchId: string | null = null
      let wellnessRows = 0
      let ignored: Record<string, number> = {}
      /** Set when every pushed activity failed to store; the run and the integration say so. */
      let allFailedMessage: string | null = null
      const counts = { skippedDuplicate: 0, skippedInvalid: 0 }
      const report: ImportReportRow[] = []
      const failed: Array<{ providerKey: string; reason: string }> = []
      try {
        const payload = push.parsePush(req.body, ctx)
        const { activities, wellness } = payload
        ignored = payload.ignored ?? {}
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
        wellnessRows = await storeWellness(deps, row.userId, wellness, provider)

        // A push where every activity failed to store is a failed sync, not a connected one.
        if (activities.length > 0 && counts.skippedInvalid === activities.length) {
          allFailedMessage = syncMessage('sync.msg.push-none-stored', {
            reason: failed[0]?.reason ?? 'unknown error',
          })
        }
        await prisma.integration.update({
          where: { id: row.id },
          data:
            allFailedMessage !== null
              ? {
                  status: 'error',
                  lastSyncAt: new Date(),
                  lastSyncStatus: 'error',
                  lastError: allFailedMessage,
                }
              : {
                  status: 'connected',
                  lastSyncAt: new Date(),
                  lastSyncStatus: 'ok',
                  lastError: null,
                },
        })
      } catch (error) {
        await recordSyncRun(deps, {
          userId: row.userId,
          provider,
          channel: 'push',
          trigger: 'push',
          startedAt,
          status: 'error',
          // A body the provider cannot read is the sender's to fix; the stored text says so in the
          // app's words, not the validator's.
          message:
            error instanceof HttpError && error.code === 'validation'
              ? syncMessage('sync.msg.push-unreadable', {})
              : error,
        })
        throw error
      }

      await recordSyncRun(deps, {
        userId: row.userId,
        provider,
        channel: 'push',
        trigger: 'push',
        startedAt,
        status: allFailedMessage !== null ? 'error' : counts.skippedInvalid > 0 ? 'partial' : 'ok',
        accepted,
        duplicate: counts.skippedDuplicate,
        failed: counts.skippedInvalid,
        wellnessStatus: wellnessRows > 0 ? 'read' : 'none',
        wellnessDays: wellnessRows > 0 ? wellnessRows : null,
        message: allFailedMessage,
        failures: failed
          .slice(0, MAX_FAILURES_STORED)
          .map((item) => ({ ref: item.providerKey, reason: item.reason })),
        importBatchId: batchId,
      })
      res.json({ activities: accepted, wellness: wellnessRows, ignored, failed })
    },
  )

  return router
}
