import { createHash } from 'node:crypto'
import { resolve } from 'node:path'

/** The SQLite file of the e2e server; the config hands it to the server and the specs reset it. */
export const E2E_DATABASE_URL = `file:${process.cwd()}/data/e2e.db`

const E2E_PORT_BASE = 3101
const E2E_PORT_SPAN = 400

/**
 * The e2e server port for a checkout: 3101 plus a stable hash of its absolute path, so checkouts
 * that run `npm run test:e2e` at the same time (git worktrees) bind different ports. Two paths can
 * still collide (400 slots); the config then fails on the bind error instead of testing the wrong
 * server.
 */
export function e2ePortFor(checkoutPath: string): number {
  const digest = createHash('sha256').update(resolve(checkoutPath)).digest()
  return E2E_PORT_BASE + (digest.readUInt32BE(0) % E2E_PORT_SPAN)
}

/** The port of this checkout's e2e server; the config, `baseURL` and the server's `PORT` read it. */
export const E2E_PORT = e2ePortFor(process.cwd())
