import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

/**
 * Defence in depth for object-level authorization (SW1). A route or service checks that a row
 * belongs to the runner and then writes it; if that check were later removed or reordered, a write
 * by `id` alone would touch another runner's row. So the `where` of every Prisma write on a
 * user-owned model must itself name the owner: a `userId` (a column of the model, or a relation
 * filter such as `plan: { userId }` for a row owned through its parent).
 *
 * The test reads `prisma/schema.prisma` for the owned models and scans `server/` for
 * `update`, `updateMany`, `delete`, `deleteMany` and `upsert` calls on them. A write that is
 * keyed some other way needs an entry in `ALLOWED`, with its reason; a new unkeyed write fails.
 */

const ROOT = fileURLToPath(new URL('../../..', import.meta.url))

const WRITES = ['update', 'updateMany', 'delete', 'deleteMany', 'upsert'] as const

/** Models with no `userId` column that belong to a runner through a parent. */
const OWNED_THROUGH_PARENT = [
  'PlanWeek',
  'PlanSession',
  'PlanRevision',
  'ActivityStream',
  'ActivityTrack',
  'ActivityFile',
  'ActivityInsight',
]
/** Models that hold no runner's data: the user row itself (keyed by its own id) and shared caches. */
const NOT_OWNED = ['User', 'ForecastCache', 'ClimateCache']

/**
 * The justified exceptions: `file`, the Prisma delegate and the operation, how many such calls the
 * file may hold, and why their `where` needs no owner.
 */
export const ALLOWED: ReadonlyArray<{
  file: string
  model: string
  op: string
  count: number
  reason: string
}> = []

interface Write {
  model: string
  op: string
  where: string | null
}

/** The text from the opening bracket at `start` to its matching close, or null. */
function balanced(source: string, start: number): string | null {
  const pairs: Record<string, string> = { '(': ')', '{': '}', '[': ']' }
  const stack: string[] = []
  let quote: string | null = null
  for (let i = start; i < source.length; i += 1) {
    const ch = source[i]!
    if (quote !== null) {
      if (ch === '\\') i += 1
      else if (ch === quote) quote = null
      continue
    }
    if (ch === "'" || ch === '"' || ch === '`') quote = ch
    else if (pairs[ch] !== undefined) stack.push(pairs[ch])
    else if (ch === ')' || ch === '}' || ch === ']') {
      stack.pop()
      if (stack.length === 0) return source.slice(start, i + 1)
    }
  }
  return null
}

/** The value of the `where` property of an argument object, resolving a local name. */
function whereOf(source: string, args: string): string | null {
  const at = args.search(/\bwhere\b/)
  if (at === -1) return null
  const after = args.slice(at + 'where'.length)
  const inline = /^\s*:\s*(\{|\[)/.exec(after)
  if (inline) return balanced(after, after.indexOf(inline[1]!))
  const name = /^\s*(?::\s*([A-Za-z_$][\w$]*)|(?=[,}\s]))/.exec(after)
  const ident = name?.[1] ?? 'where'
  const declared = new RegExp(`\\b(?:const|let)\\s+${ident}\\b[^=]*=\\s*(\\{)`).exec(source)
  return declared ? balanced(source, declared.index + declared[0].length - 1) : null
}

export function writesIn(source: string, models: readonly string[]): Write[] {
  const delegates = new Map(models.map((m) => [m.charAt(0).toLowerCase() + m.slice(1), m]))
  const call = new RegExp(`\\.(${[...delegates.keys()].join('|')})\\.(${WRITES.join('|')})\\(`, 'g')
  const found: Write[] = []
  for (const match of source.matchAll(call)) {
    const open = match.index + match[0].length - 1
    const args = balanced(source, open)
    found.push({
      model: delegates.get(match[1]!)!,
      op: match[2]!,
      where: args === null ? null : whereOf(source, args),
    })
  }
  return found
}

/** A `where` names the owner when it holds a `userId` (also as `userId_date` and the like). */
export function isKeyed(where: string | null): boolean {
  return where !== null && /\buserId/.test(where)
}

function ownedModels(): string[] {
  const schema = readFileSync(join(ROOT, 'prisma/schema.prisma'), 'utf8')
  const owned: string[] = []
  const unaccounted: string[] = []
  for (const [, name, body] of schema.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)) {
    if (NOT_OWNED.includes(name!)) continue
    if (/^\s+userId\s/m.test(body!) || OWNED_THROUGH_PARENT.includes(name!)) owned.push(name!)
    else unaccounted.push(name!)
  }
  // A new model with no userId column must be placed in one of the two lists above.
  expect(unaccounted).toEqual([])
  return owned
}

function typescriptFiles(dir: string): string[] {
  return readdirSync(join(ROOT, dir), { recursive: true, encoding: 'utf8' })
    .filter((path) => path.endsWith('.ts'))
    .map((path) => `${dir}/${path}`)
}

describe('every write on a runner-owned model names the runner', () => {
  test('no write under server/ is keyed by id alone, except the listed ones', () => {
    const models = ownedModels()
    const files = typescriptFiles('server')
    expect(files.length).toBeGreaterThan(50)
    const unkeyed = new Map<string, number>()
    for (const file of files) {
      const source = readFileSync(join(ROOT, file), 'utf8')
      for (const write of writesIn(source, models)) {
        if (isKeyed(write.where)) continue
        const key = `${file} ${write.model}.${write.op}`
        unkeyed.set(key, (unkeyed.get(key) ?? 0) + 1)
      }
    }
    const allowed = new Map(ALLOWED.map((a) => [`${a.file} ${a.model}.${a.op}`, a.count]))
    expect(Object.fromEntries(unkeyed)).toEqual(Object.fromEntries(allowed))
    for (const entry of ALLOWED) expect(entry.reason.length).toBeGreaterThan(10)
  })

  test('finds the shapes of write and reads their where', () => {
    const models = ['Activity', 'PlanSession', 'Goal']
    const source = [
      'await prisma.activity.update({ where: { id }, data })',
      'await tx.activity.updateMany({ where: { id, userId }, data })',
      'await tx.planSession.update({ where: { id, plan: { userId } }, data })',
      'const where = { userId, id }',
      'await prisma.goal.deleteMany({ where })',
      'await prisma.goal.delete({ where: key })',
      'await prisma.activity.findMany({ where: { id } })',
    ].join('\n')
    const found = writesIn(source, models)
    expect(found.map((w) => [w.model, w.op, isKeyed(w.where)])).toEqual([
      ['Activity', 'update', false],
      ['Activity', 'updateMany', true],
      ['PlanSession', 'update', true],
      ['Goal', 'deleteMany', true],
      ['Goal', 'delete', false],
    ])
  })
})
