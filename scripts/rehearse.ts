import { existsSync } from 'node:fs'
import type { AddressInfo } from 'node:net'
import { parseArgs } from 'node:util'
import { createApp } from '../server/app.ts'
import { SESSION_COOKIE, signSession } from '../server/auth/session.ts'
import { loadConfig, loadEnvFileIfPresent } from '../server/config.ts'
import { createPrisma, initSqlite } from '../server/db.ts'
import { DEFAULT_DATABASE_URL, loadDatabaseUrl, sqliteFilePath } from '../server/dbPath.ts'
import type { Output } from './backup.ts'
import { isMainModule } from './isMain.ts'

const HELP = `Usage: npm run rehearse [-- --yes-live]

Restore drill: proves that a restored copy of the database gives a working app for every account.
Point DATABASE_URL at the restored copy (and keep the SESSION_SECRET of the server that made it),
then run this. It opens the copy in this process, with no scheduler and no outside request, signs
in as each account with a session cookie signed here (no password is needed), and asks for the
reads of each main page with GET only.

It prints one line per request: the account's number (1, 2, 3, in order of creation), the route,
the HTTP status and the time in ms. It never prints a response body, an email, a name or an id.
The exit status is 1 when any request answers 500 or above, or 401 after the signed cookie.

It refuses to run against the default database (${DEFAULT_DATABASE_URL}) unless --yes-live is given:
the drill is for a scratch copy.
`

/** The reads of the main pages, each asked once per account. */
export const REHEARSAL_ROUTES = [
  '/api/today',
  '/api/plan',
  '/api/race/plan',
  '/api/trends',
  '/api/activities',
  '/api/profile',
  '/api/settings',
  '/api/plan-inputs',
  '/api/brief',
] as const

/** The deep health probe: no cookie, so it is not tied to an account. */
const HEALTH_ROUTE = '/api/health/deep'

const processOutput: Output = {
  stdout: (text) => void process.stdout.write(text),
  stderr: (text) => void process.stderr.write(text),
}

/** Test hooks: a `fetch` to send the requests through (the default is the global one). */
export interface RehearseDeps {
  fetch?: typeof fetch
}

/**
 * Runs `npm run rehearse` with the given arguments and environment; returns the exit status. Only
 * the account number, the route, the status and the time reach `io`.
 */
export async function rehearseCommand(
  argv: readonly string[],
  env: NodeJS.ProcessEnv,
  io: Output = processOutput,
  deps: RehearseDeps = {},
): Promise<number> {
  let values
  try {
    ;({ values } = parseArgs({
      args: [...argv],
      options: { help: { type: 'boolean', short: 'h' }, 'yes-live': { type: 'boolean' } },
      allowPositionals: false,
    }))
  } catch (error) {
    io.stderr(`${error instanceof Error ? error.message : String(error)}\n\n${HELP}`)
    return 1
  }
  if (values.help) {
    io.stdout(HELP)
    return 0
  }

  const databaseUrl = loadDatabaseUrl(env)
  const databaseFile = sqliteFilePath(databaseUrl)
  if (!values['yes-live'] && databaseFile === sqliteFilePath(DEFAULT_DATABASE_URL)) {
    io.stderr(
      `DATABASE_URL names the default database (${DEFAULT_DATABASE_URL}). Run the drill against a ` +
        `restored copy; --yes-live overrides this.\n`,
    )
    return 1
  }
  if (!existsSync(databaseFile)) {
    io.stderr(`There is no database file at ${databaseFile}; restore a copy there first.\n`)
    return 1
  }

  // The server's own configuration, so the cookie is signed with the secret the server verifies
  // with. The log is silent so that nothing but the lines below reaches the output.
  const config = { ...loadConfig({ ...env, DATABASE_URL: databaseUrl }), logLevel: 'silent' }
  const prisma = createPrisma(config.databaseUrl)
  await initSqlite(prisma)
  // No request leaves the machine: a stale forecast would otherwise start a refresh.
  const noOutside: typeof fetch = () => Promise.reject(new Error('rehearse sends nothing out'))
  const server = createApp({ prisma, config, fetch: noOutside }).listen(0, '127.0.0.1')
  await new Promise<void>((resolve) => server.once('listening', () => resolve()))
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  const send = deps.fetch ?? fetch

  let failed = 0
  let total = 0
  async function ask(label: string, route: string, cookie?: string): Promise<Response | null> {
    const started = performance.now()
    total += 1
    let response: Response | null = null
    try {
      response = await send(`${base}${route}`, {
        method: 'GET',
        ...(cookie === undefined ? {} : { headers: { Cookie: cookie } }),
      })
    } catch {
      // The reason is not printed: only the fact that the request failed.
    }
    const ms = Math.round(performance.now() - started)
    const status = response?.status ?? 0
    const bad = response === null || status >= 500 || status === 401
    io.stdout(`${label}\t${route}\t${response === null ? 'error' : status}\t${ms} ms\n`)
    if (bad) failed += 1
    return response
  }

  try {
    const users = await prisma.user.findMany({
      select: { id: true, sessionVersion: true },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    })
    let index = 0
    for (const user of users) {
      index += 1
      const cookie = `${SESSION_COOKIE}=${signSession(user.id, config.sessionSecret, user.sessionVersion)}`
      for (const route of REHEARSAL_ROUTES) {
        const response = await ask(String(index), route, cookie)
        await response?.arrayBuffer().catch(() => undefined)
      }
    }
    // A scratch copy has no fresh backup beside it, so 503 is expected there; what counts is
    // that the database answers (read from the body, never printed).
    const health = await ask('-', HEALTH_ROUTE)
    if (health !== null && health.status === 503) {
      const body = (await health.json().catch(() => null)) as { database?: unknown } | null
      // `ask` counted the 503 as a failure; a reachable database takes it back.
      if (body?.database === 'ok') failed -= 1
    }
    io.stdout(`${users.length} account(s), ${total} request(s), ${failed} failed.\n`)
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
    await prisma.$disconnect()
  }
  return failed > 0 ? 1 : 0
}

if (isMainModule(import.meta.url)) {
  try {
    loadEnvFileIfPresent()
    process.exitCode = await rehearseCommand(process.argv.slice(2), process.env)
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}
