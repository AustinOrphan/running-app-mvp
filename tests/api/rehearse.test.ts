import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { REHEARSAL_ROUTES, rehearseCommand } from '../../scripts/rehearse.ts'
import { DEFAULT_DATABASE_URL } from '../../server/dbPath.ts'
import { todayIso } from '../../shared/dates.ts'
import { client, createTestCtx, expectNoRefusedFetches, seedUser, type TestCtx } from './helpers.ts'

/**
 * `npm run rehearse` is the restore drill's check: each account's page reads, printed as account
 * number, route, status and time only. The seeded accounts carry names and notes that must never
 * reach the output.
 */

const SECRET = 'rehearse-secret-0123456789abcdef-0123456789'
const NOTE = 'Zebra-note-4417 along the canal'
const PEOPLE = [
  { email: 'ada.lovelace.4417@example.com', displayName: 'Ada Lovelace Zork' },
  { email: 'grace.hopper.4417@example.com', displayName: 'Grace Hopper Quux' },
]

let ctx: TestCtx
let env: NodeJS.ProcessEnv
const ids: string[] = []

beforeEach(async () => {
  ctx = await createTestCtx({ sessionSecret: SECRET })
  env = { DATABASE_URL: ctx.config.databaseUrl, SESSION_SECRET: SECRET }
  ids.length = 0
  for (const person of PEOPLE) {
    const user = await seedUser(ctx, { email: person.email })
    await ctx.prisma.user.update({
      where: { id: user.id },
      data: { displayName: person.displayName },
    })
    ids.push(user.id)
    const created = await client(ctx, user).post('/api/activities').send({
      date: todayIso(),
      type: 'run',
      durationSec: 1800,
      distanceM: 5000,
      notes: NOTE,
    })
    expect(created.status).toBe(201)
  }
})

afterEach(async () => {
  expectNoRefusedFetches(ctx)
  await ctx.close()
})

interface Seen {
  method: string
  path: string
  body: string
}

/** A `fetch` that records each request's method and path, and the body it got back. */
function recording(seen: Seen[], override?: (path: string) => Response | undefined): typeof fetch {
  return async (input, init) => {
    const url = new URL(
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
    )
    const replaced = override?.(url.pathname)
    if (replaced) {
      seen.push({ method: init?.method ?? 'GET', path: url.pathname, body: '' })
      return replaced
    }
    const response = await fetch(input, init)
    seen.push({
      method: init?.method ?? 'GET',
      path: url.pathname,
      body: await response.clone().text(),
    })
    return response
  }
}

async function run(
  argv: string[],
  environment: NodeJS.ProcessEnv,
  deps: Parameters<typeof rehearseCommand>[3] = {},
) {
  let out = ''
  let err = ''
  const status = await rehearseCommand(
    argv,
    environment,
    { stdout: (text) => (out += text), stderr: (text) => (err += text) },
    deps,
  )
  return { status, out, err }
}

describe('npm run rehearse', () => {
  test('prints only the account number, route, status and time, never data', async () => {
    const seen: Seen[] = []
    const { status, out, err } = await run([], env, { fetch: recording(seen) })

    expect(status, out + err).toBe(0)
    // The reads did carry the seeded data, so its absence from the output is not by accident.
    const bodies = seen.map((entry) => entry.body).join('\n')
    expect(bodies).toContain(NOTE)
    expect(bodies).toContain(PEOPLE[0]?.email)

    const lines = out.trimEnd().split('\n')
    const summary = lines.pop()
    expect(summary).toBe(`2 account(s), ${2 * REHEARSAL_ROUTES.length + 1} request(s), 0 failed.`)
    for (const line of lines) {
      expect(line).toMatch(/^(1|2|-)\t\/api\/[a-z/-]+(\/deep)?\t\d{3}\t\d+ ms$/)
    }
    const accounts = new Set(lines.map((line) => line.split('\t')[0]))
    expect(accounts).toEqual(new Set(['1', '2', '-']))

    const everything = out + err
    for (const secret of [
      ...PEOPLE.flatMap((person) => [
        person.email,
        person.displayName,
        person.displayName.split(' ')[0],
      ]),
      NOTE,
      'Zebra',
      'example.com',
      ...ids,
      SECRET,
    ]) {
      expect(everything).not.toContain(secret)
    }
  })

  test('every request is a GET, and the accounts are signed in by the minted cookie', async () => {
    const seen: Seen[] = []
    const { out } = await run([], env, { fetch: recording(seen) })
    expect(seen.length).toBeGreaterThan(0)
    expect(new Set(seen.map((entry) => entry.method))).toEqual(new Set(['GET']))
    expect(out).not.toMatch(/\t401\t/)
    expect(seen.map((entry) => entry.path)).toEqual(
      expect.arrayContaining([...REHEARSAL_ROUTES, '/api/health/deep']),
    )
  })

  test('exits 1 when a route answers 500 or above, and still prints no body', async () => {
    const seen: Seen[] = []
    const failing = recording(seen, (path) =>
      path === '/api/trends' ? new Response(NOTE, { status: 500 }) : undefined,
    )
    const { status, out } = await run([], env, { fetch: failing })
    expect(status).toBe(1)
    expect(out).toMatch(/^1\t\/api\/trends\t500\t/m)
    expect(out).toContain('2 failed.')
    expect(out).not.toContain(NOTE)
  })

  test('exits 1 on a 401 after the minted cookie', async () => {
    const seen: Seen[] = []
    const failing = recording(seen, (path) =>
      path === '/api/today' ? new Response('{}', { status: 401 }) : undefined,
    )
    const { status, out } = await run([], env, { fetch: failing })
    expect(status).toBe(1)
    expect(out).toMatch(/^2\t\/api\/today\t401\t/m)
  })

  test('refuses the default database path without --yes-live', async () => {
    const { status, out, err } = await run([], {
      SESSION_SECRET: SECRET,
      DATABASE_URL: DEFAULT_DATABASE_URL,
    })
    expect(status).toBe(1)
    expect(out).toBe('')
    expect(err).toContain('--yes-live')
  })

  test('refuses when DATABASE_URL is unset (the default path)', async () => {
    const { status, err } = await run([], { SESSION_SECRET: SECRET })
    expect(status).toBe(1)
    expect(err).toContain('--yes-live')
  })

  test('refuses a database file that is not there', async () => {
    const { status, err } = await run([], {
      ...env,
      DATABASE_URL: `file:${ctx.config.databaseUrl.replace(/^file:/, '')}.missing`,
    })
    expect(status).toBe(1)
    expect(err).toContain('no database file')
  })
})
