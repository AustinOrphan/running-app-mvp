import { stat } from 'node:fs/promises'
import { isAbsolute, resolve } from 'node:path'
import { Router } from 'express'
import { z } from 'zod'
import type { Deps } from '../app.ts'
import { SecretError, hashToken, newToken } from '../crypto.ts'
import type { Integration } from '../db.ts'
import { conflict, notFound, parse, validationError } from '../errors.ts'
import { createLogger } from '../logger.ts'
import { signState, verifyState } from '../providers/oauthState.ts'
import { PROVIDERS, getProvider } from '../providers/registry.ts'
import { authorizeUrl, exchangeCode, type StravaConfig } from '../providers/strava.ts'
import { toIntegrationStatus } from '../serialize.ts'
import { scanFolderIntegration } from '../services/folder.ts'
import {
  SECRET_CHANGED,
  isSyncing,
  openIntegration,
  providerContext,
  sealSecret,
  syncProvider,
  trackBackground,
} from '../services/sync.ts'
import type { IntegrationStatus } from '../../shared/types.ts'

const syncBody = z
  .object({
    from: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a YYYY-MM-DD date.')
      .optional(),
  })
  .strict()

const folderBody = z.object({ path: z.string().trim().min(1, 'Enter the folder path.') }).strict()

function callbackPath(provider: string): string {
  return `/api/integrations/${provider}/callback`
}

function redirectWithError(message: string): string {
  return `/integrations?error=${encodeURIComponent(message)}`
}

export function integrationsRouter(deps: Deps): Router {
  const { prisma, config } = deps
  const router = Router()
  const logger = createLogger(config)

  /**
   * A pull row whose secret no longer decrypts (SESSION_SECRET changed) needs a reconnect. Push
   * and folder rows hold no secret and keep working, so a key change leaves them alone.
   */
  async function checked(row: Integration): Promise<Integration> {
    if (row.status === 'needs_auth') return row
    if (!(Object.hasOwn(PROVIDERS, row.provider) && PROVIDERS[row.provider]?.pull)) return row
    try {
      openIntegration(row, config.sessionSecret)
      return row
    } catch (error) {
      if (!(error instanceof SecretError)) throw error
      return prisma.integration.update({
        where: { id: row.id },
        data: { status: 'needs_auth', lastSyncStatus: 'error', lastError: SECRET_CHANGED },
      })
    }
  }

  async function statusOf(userId: string, provider: string): Promise<IntegrationStatus> {
    const info = getProvider(provider).info
    const row = await prisma.integration.findUnique({
      where: { userId_provider: { userId, provider } },
    })
    return toIntegrationStatus(row ? await checked(row) : null, info)
  }

  function redirectUri(
    req: { protocol: string; get(name: string): string | undefined },
    provider: string,
    row: Record<string, unknown>,
  ): string {
    const base =
      typeof row.publicBaseUrl === 'string' && row.publicBaseUrl !== ''
        ? row.publicBaseUrl.replace(/\/+$/, '')
        : `${req.protocol}://${req.get('host') ?? 'localhost'}`
    return `${base}${callbackPath(provider)}`
  }

  router.get('/', async (req, res) => {
    const rows = await prisma.integration.findMany({ where: { userId: req.userId } })
    const byProvider = new Map<string, Integration>()
    for (const row of rows) byProvider.set(row.provider, await checked(row))
    res.json(
      Object.values(PROVIDERS).map(({ info }) =>
        toIntegrationStatus(byProvider.get(info.key) ?? null, info),
      ),
    )
  })

  router.put('/:provider', async (req, res) => {
    const provider = String(req.params.provider)
    const registered = getProvider(provider)
    const userId = req.userId
    const existing = await prisma.integration.findUnique({
      where: { userId_provider: { userId, provider } },
    })

    let connected: { config: Record<string, unknown>; secret: Record<string, unknown> }
    if (provider === 'folder') {
      const { path } = parse(folderBody, req.body)
      if (!isAbsolute(path)) throw validationError('Enter an absolute folder path.')
      const folder = resolve(path)
      const info = await stat(folder).catch(() => null)
      if (!info) throw validationError('That folder does not exist on the server.')
      if (!info.isDirectory()) throw validationError('That path is not a folder.')
      connected = { config: { path: folder }, secret: {} }
    } else if (registered.pull) {
      let current: ReturnType<typeof openIntegration> = { secret: {}, config: {} }
      if (existing) {
        try {
          current = openIntegration(existing, config.sessionSecret)
        } catch (error) {
          if (!(error instanceof SecretError)) throw error
        }
      }
      const ctx = await providerContext(deps, userId, provider, current)
      const result = await registered.pull.connect(req.body, ctx)
      const resultConfig = result.config as Record<string, unknown>
      if (resultConfig.mfaRequired === true) {
        // A second step is pending in memory; nothing is stored until the code is accepted.
        res.json({ ...(await statusOf(userId, provider)), ...resultConfig })
        return
      }
      connected = { config: resultConfig, secret: result.secret as Record<string, unknown> }
    } else {
      throw validationError(`${registered.info.label} connects with a push token, not a form.`)
    }

    // Strava stays unauthorised until the OAuth callback brings the tokens.
    const status = provider === 'strava' ? 'needs_auth' : 'connected'
    const data = {
      status,
      secret: sealSecret(connected.secret, config.sessionSecret),
      config: JSON.stringify(connected.config),
      lastError: null,
      pausedUntil: null,
    }
    await prisma.integration.upsert({
      where: { userId_provider: { userId, provider } },
      create: { userId, provider, ...data },
      update: data,
    })

    const result: IntegrationStatus & { authorizeUrl?: string } = await statusOf(userId, provider)
    if (provider === 'strava') {
      result.authorizeUrl = authorizeUrl(
        connected.config as unknown as StravaConfig,
        redirectUri(req, provider, connected.config),
        signState(userId, config.sessionSecret, new Date()),
      )
    }
    res.json(result)
  })

  router.get('/:provider/callback', async (req, res) => {
    const provider = String(req.params.provider)
    getProvider(provider)
    if (provider !== 'strava') throw notFound()
    const query = req.query as Record<string, unknown>
    if (typeof query.error === 'string') {
      res.redirect(
        302,
        redirectWithError(`Strava did not authorise the connection (${query.error}).`),
      )
      return
    }
    const code = typeof query.code === 'string' ? query.code : ''
    const state = typeof query.state === 'string' ? query.state : ''
    if (code === '' || verifyState(state, config.sessionSecret, new Date()) !== req.userId) {
      res.redirect(302, redirectWithError('The Strava connection expired. Start it again.'))
      return
    }
    try {
      const row = await prisma.integration.findUnique({
        where: { userId_provider: { userId: req.userId, provider } },
      })
      if (!row) {
        res.redirect(302, redirectWithError('Enter the Strava client id and secret first.'))
        return
      }
      const opened = openIntegration(row, config.sessionSecret)
      const ctx = await providerContext(deps, req.userId, provider, opened)
      const secret = await exchangeCode(code, redirectUri(req, provider, opened.config), ctx)
      await prisma.integration.update({
        where: { id: row.id },
        data: {
          secret: sealSecret(secret, config.sessionSecret),
          status: 'connected',
          lastError: null,
          pausedUntil: null,
        },
      })
      res.redirect(302, `/integrations?connected=${provider}`)
    } catch (error) {
      logger.warn({ err: error, provider }, 'oauth callback failed')
      const text =
        error instanceof SecretError
          ? SECRET_CHANGED
          : error instanceof Error
            ? error.message
            : 'Unknown error'
      res.redirect(302, redirectWithError(text))
    }
  })

  router.post('/:provider/sync', async (req, res) => {
    const provider = String(req.params.provider)
    const registered = getProvider(provider)
    const userId = req.userId
    const body = parse(syncBody, req.body ?? {})
    const row = await prisma.integration.findUnique({
      where: { userId_provider: { userId, provider } },
    })
    if (!row) throw conflict(`Connect ${registered.info.label} first.`)
    if (row.status === 'needs_auth') throw conflict(`Reconnect ${registered.info.label} first.`)
    if (provider === 'folder') {
      trackBackground(scanFolderIntegration(deps, userId), (error) =>
        logger.warn({ err: error, provider }, 'folder scan failed'),
      )
    } else if (registered.pull) {
      if (row.pausedUntil && row.pausedUntil.getTime() > Date.now()) {
        throw conflict(
          `${registered.info.label} is paused until ${row.pausedUntil.toISOString()} after a rate limit.`,
        )
      }
      if (!isSyncing(userId, provider)) {
        trackBackground(
          syncProvider(deps, userId, provider, body.from ? { from: body.from } : {}),
          (error) => logger.warn({ err: error, provider }, 'sync failed'),
        )
      }
    } else {
      throw validationError(`${registered.info.label} does not sync by itself.`)
    }
    res.status(202).json(await statusOf(userId, provider))
  })

  router.post('/:provider/push-token', async (req, res) => {
    const provider = String(req.params.provider)
    const registered = getProvider(provider)
    if (!registered.push) {
      throw validationError(`${registered.info.label} does not accept pushed data.`)
    }
    const token = newToken()
    const ingestTokenHash = hashToken(token)
    await prisma.integration.upsert({
      where: { userId_provider: { userId: req.userId, provider } },
      create: {
        userId: req.userId,
        provider,
        status: 'connected',
        secret: sealSecret({}, config.sessionSecret),
        config: '{}',
        ingestTokenHash,
      },
      update: { ingestTokenHash },
    })
    res.json({ token })
  })

  router.delete('/:provider', async (req, res) => {
    const provider = String(req.params.provider)
    getProvider(provider)
    await prisma.integration.deleteMany({ where: { userId: req.userId, provider } })
    res.status(204).end()
  })

  return router
}
