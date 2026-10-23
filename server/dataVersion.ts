import { randomBytes } from 'node:crypto'
import type { PrismaClient } from './db.ts'

/**
 * The in-memory data version of one Prisma client (ADR 0009, spec 4.3).
 *
 * `n` counts writes to a state model made through the client; `dataVersionKey` adds
 * `PRAGMA data_version` for writes made by another connection or process. A cached value that
 * depends on state is valid for one key. Nothing outside this module can raise the counter: the
 * query extension below does it after every write to a state model, so a caller cannot forget.
 */

/**
 * Models whose rows the athlete snapshot, a memoised value or a published deliverable reads. A
 * write to one invalidates every cached value. Each Prisma model is in exactly one of these two
 * lists; `tests/unit/server/modelClassification.test.ts` fails on a model in neither or both.
 */
export const STATE_MODELS = [
  'User',
  'Activity',
  'WellnessDay',
  'AthleteProfile',
  'WeeklyReview',
  'Screening',
  'Goal',
  'Plan',
  'PlanWeek',
  'PlanSession',
  'PlanRevision',
  'RaceResult',
  // The fuel ladder is replayed from the logs under the settings (ADR 0011) and its target reaches
  // the watch line and Today, so a write to any of the three must drop a memo (design 10.3).
  'FuelProduct',
  'FuelLog',
  'FuelSettings',
  // The snapshot's prediction reads the race climate, so a refresh must drop a memoised prediction.
  'ClimateCache',
] as const

/**
 * Models that nothing cached reads, or that are written on a read path or by a background job.
 * A derived table written on a read (a lazy brief, a prediction log) must be here: marked as
 * state, each lazy write would invalidate the cache it had just filled. The publisher's own tables
 * (`DeliveryChannel`, `WristPublication`) are here too: a run that raised the version would trigger
 * the next run.
 */
export const NON_STATE_MODELS = [
  'ActivityStream',
  'ActivityFile',
  'ImportBatch',
  'ImportedFile',
  'Integration',
  'PredictionLog',
  'SyncRun',
  'DeliveryChannel',
  'WristPublication',
  // Written on a read path (a stale or empty forecast is refreshed there) and read by no snapshot
  // or memo; a deliverable that depends on it composes `forecastStamp` into its change key.
  'ForecastCache',
  // What stood out on a run. Derived from state, written on a read path (the first read of a run
  // computes it) and by the pipeline after a store, and read by no snapshot, memo or deliverable:
  // Explain reads it straight from the table. As state, each lazy write would drop the snapshot it
  // was computed from. `server/services/insight.ts` is its only writer.
  'ActivityInsight',
] as const

const STATE_SET: ReadonlySet<string> = new Set(STATE_MODELS)

/** The counter, the open-transaction count and the listeners of one client. */
interface ClientState {
  boot: string
  n: number
  openTx: number
  listeners: Set<(n: number) => void>
}

const states = new WeakMap<object, ClientState>()

function stateOf(prisma: PrismaClient): ClientState {
  const state = states.get(prisma)
  if (!state) throw new Error('Not a client from createPrisma, so it has no data version.')
  return state
}

/** Raises the counter and tells the listeners. Private on purpose: callers never bump. */
function bump(state: ClientState): void {
  state.n++
  for (const listener of [...state.listeners]) {
    try {
      listener(state.n)
    } catch {
      // A listener only drops a cache. Its failure must not turn a finished write into an error.
    }
  }
}

/** create, createMany, createManyAndReturn, update, updateMany, upsert, delete, deleteMany, ... */
function isWriteOperation(operation: string): boolean {
  return /^(create|update|upsert|delete)/.test(operation)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** A plain object literal: not a Date, a Buffer, a Decimal or an array. */
function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value) || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value) as unknown
  return prototype === Object.prototype || prototype === null
}

/** Keys that only a relation write carries. A scalar's `{ set }` or `{ increment }` is not one. */
const RELATION_WRITE_KEYS = [
  'create',
  'createMany',
  'connectOrCreate',
  'connect',
  'disconnect',
  'update',
  'updateMany',
  'upsert',
  'delete',
  'deleteMany',
] as const

function isRelationWrite(value: unknown): boolean {
  if (!isPlainRecord(value)) return false
  // `set: [...]` replaces a to-many relation; a scalar `set` is not an array.
  return RELATION_WRITE_KEYS.some((key) => key in value) || Array.isArray(value.set)
}

function inputHasRelationWrite(input: unknown): boolean {
  const rows: unknown[] = Array.isArray(input) ? input : [input]
  return rows.some((row) => isRecord(row) && Object.values(row).some(isRelationWrite))
}

/**
 * True when the arguments of a write also write through a relation. The query extension only
 * sees the top-level model, so `importBatch.create({ data: { activities: { create } } })` writes
 * Activity rows that no hook is told about. Without the relation's target at run time, any
 * relation write counts: an unneeded bump costs a rebuild, a missed one costs a wrong answer.
 */
function hasRelationWrite(args: unknown): boolean {
  if (!isRecord(args)) return false
  return [args.data, args.create, args.update].some(inputHasRelationWrite)
}

type TransactionFn = (arg: unknown, options?: unknown) => Promise<unknown>

/**
 * Wraps a freshly created client so that every write to a state model raises its data version.
 * Only `createPrisma` calls this.
 *
 * - The query extension raises the counter after each write to a state model, and after a write
 *   to any model that also writes a relation, also when the write throws.
 * - `$transaction` keeps an open-transaction count and raises the counter once more when the
 *   transaction ends, on commit or rollback. A cache builder that sees `openTransactions > 0`, or
 *   a counter that moved during its build, must not store what it built: the root client shares
 *   its connection with an open transaction and reads the transaction's uncommitted rows.
 */
export function withDataVersion(base: PrismaClient): PrismaClient {
  const state: ClientState = {
    boot: randomBytes(4).toString('hex'),
    n: 0,
    openTx: 0,
    listeners: new Set(),
  }

  const extended = base.$extends({
    name: 'data-version',
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          const writes =
            isWriteOperation(operation) && (STATE_SET.has(model) || hasRelationWrite(args))
          if (!writes) return query(args)
          try {
            return await query(args)
          } finally {
            bump(state)
          }
        },
      },
    },
  })

  // `never` selects the first overload; both forms (an array of queries, an interactive callback)
  // reach the real implementation unchanged, with their options.
  const runTransaction: TransactionFn = (arg, options) =>
    extended.$transaction(arg as never, options as never)

  const transaction: TransactionFn = async (arg, options) => {
    state.openTx++
    try {
      return await runTransaction(arg, options)
    } finally {
      state.openTx--
      bump(state)
    }
  }

  const client = new Proxy(extended, {
    get(target, property) {
      if (property === '$transaction') return transaction
      const value: unknown = Reflect.get(target, property)
      // Methods such as `$disconnect` and `$queryRawUnsafe` run against the extended client.
      return typeof value === 'function'
        ? (...args: unknown[]) => Reflect.apply(value, target, args) as unknown
        : value
    },
  })
  states.set(client, state)

  // The one cast: a Proxy over an extended client is typed as the plain client so that `Deps`,
  // every `Pick<PrismaClient, ...>` and the transaction callback types compile unchanged. The
  // proxy only adds the counter; every delegate and method it hands out is the client's own.
  return client as unknown as PrismaClient
}

export interface DataVersionKey {
  /** Writes to state models made through this client since it was created. */
  n: number
  /** `PRAGMA data_version`: changes when another connection or process writes the file. */
  external: number
  /** `<boot>.<n>.<external>`, the part of a cache key that tracks the data. */
  key: string
}

/** The pragma is a `BigInt` through the better-sqlite3 adapter; JSON and arithmetic want a number. */
function toNumber(value: unknown): number {
  if (typeof value === 'bigint' || typeof value === 'number') return Number(value)
  // A stuck 0 would hide writes by other processes, so an unreadable pragma is an error.
  throw new Error('PRAGMA data_version returned no number.')
}

export async function dataVersionKey(prisma: PrismaClient): Promise<DataVersionKey> {
  const state = stateOf(prisma)
  const rows = await prisma.$queryRawUnsafe<{ data_version: unknown }[]>('PRAGMA data_version')
  const external = toNumber(rows[0]?.data_version)
  const n = state.n
  return { n, external, key: `${state.boot}.${n}.${external}` }
}

/** Calls `listener(n)` after each in-process bump. Returns the function that stops it. */
export function onDataVersionChange(
  prisma: PrismaClient,
  listener: (n: number) => void,
): () => void {
  const { listeners } = stateOf(prisma)
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** How many `$transaction` calls are in flight on this client. */
export function openTransactions(prisma: PrismaClient): number {
  return stateOf(prisma).openTx
}
