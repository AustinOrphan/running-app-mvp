import { Router, type Request } from 'express'
import { z } from 'zod'
import type { SessionUser, Units } from '../../shared/types.ts'
import type { Deps } from '../app.ts'
import { conflict, parse, unauthorized } from '../errors.ts'
import { requireAuth } from './middleware.ts'
import { DUMMY_PASSWORD_HASH, hashPassword, passwordSchema, verifyPassword } from './password.ts'
import { createLoginLimiter } from './rateLimit.ts'
import { clearSessionCookie, setSessionCookie, signSession } from './session.ts'

const email = z.string().trim().toLowerCase()

const setupSchema = z.object({
  email: email.pipe(z.email('Enter a valid email address.')),
  password: passwordSchema,
  displayName: z.string().trim().max(80).optional(),
})

const loginSchema = z.object({
  email: email.min(1),
  password: z.string().min(1).max(1024),
})

interface UserRow {
  id: string
  email: string
  displayName: string | null
  units: string
}

function toSessionUser(row: UserRow): SessionUser {
  return {
    id: row.id,
    email: row.email,
    displayName: row.displayName,
    units: row.units as Units,
  }
}

function isSecure(req: Request): boolean {
  return req.secure || req.get('x-forwarded-proto') === 'https'
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002'
}

/** Setup, login, logout and the current user. All are mounted before the auth gate. */
export function authRouter(deps: Deps): Router {
  const router = Router()
  const { prisma, config } = deps
  const loginLimiter = createLoginLimiter()

  router.get('/setup', async (_req, res) => {
    const users = await prisma.user.count()
    res.json({ needsSetup: users === 0 })
  })

  router.post('/setup', async (req, res) => {
    if ((await prisma.user.count()) > 0 && !config.allowRegistration) {
      throw conflict('Setup is closed because an account already exists.')
    }
    const body = parse(setupSchema, req.body)
    const taken = await prisma.user.findUnique({
      where: { email: body.email },
      select: { id: true },
    })
    if (taken) throw conflict('An account with that email already exists.')

    const passwordHash = await hashPassword(body.password)
    let user: UserRow
    try {
      user = await prisma.user.create({
        data: { email: body.email, passwordHash, displayName: body.displayName || null },
      })
    } catch (error) {
      if (isUniqueViolation(error)) throw conflict('An account with that email already exists.')
      throw error
    }
    setSessionCookie(res, signSession(user.id, config.sessionSecret), isSecure(req))
    res.status(201).json(toSessionUser(user))
  })

  router.post('/auth/login', loginLimiter, async (req, res) => {
    const body = parse(loginSchema, req.body)
    const user = await prisma.user.findUnique({ where: { email: body.email } })
    // Always one compare, so an unknown email takes as long as a wrong password.
    const matches = await verifyPassword(body.password, user?.passwordHash ?? DUMMY_PASSWORD_HASH)
    if (!user || !matches) throw unauthorized('Invalid email or password')
    setSessionCookie(res, signSession(user.id, config.sessionSecret), isSecure(req))
    res.json(toSessionUser(user))
  })

  router.post('/auth/logout', (_req, res) => {
    clearSessionCookie(res)
    res.status(204).end()
  })

  router.get('/auth/me', requireAuth(deps), async (req, res) => {
    const user = await prisma.user.findUnique({ where: { id: req.userId } })
    if (!user) throw unauthorized()
    res.json(toSessionUser(user))
  })

  return router
}
