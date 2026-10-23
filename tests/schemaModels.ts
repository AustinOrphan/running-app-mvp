import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { PrismaClient } from '../server/db.ts'

/**
 * The models of `prisma/schema.prisma`, read from the schema text so test helpers follow the
 * schema without a hand-kept table list. Only what the helpers need is parsed: field names, field
 * types and the foreign keys of `@relation(fields: [...])`.
 */
export interface SchemaModel {
  name: string
  /** The Prisma client delegate name: `PlanWeek` is `planWeek`. */
  delegate: string
  /** Scalar and relation field names. */
  fields: string[]
  /** True when the model has a `userId` field, so its rows belong to one user. */
  hasUserId: boolean
  /** Other models this model holds a foreign key to (a required or optional relation). */
  parents: string[]
}

const SCHEMA_PATH = fileURLToPath(new URL('../prisma/schema.prisma', import.meta.url))

/**
 * Scans line by line: comments in this schema contain braces, so a block is the lines between
 * `model Name {` and a line that is only `}`.
 */
export function parseSchemaModels(source: string): SchemaModel[] {
  const models: SchemaModel[] = []
  let current: { name: string; fields: string[]; parents: Set<string> } | undefined
  for (const rawLine of source.split('\n')) {
    const line = rawLine.replace(/\/\/.*$/, '').trim()
    if (!current) {
      const start = /^model\s+(\w+)\s*\{$/.exec(line)
      if (start) current = { name: start[1] ?? '', fields: [], parents: new Set() }
      continue
    }
    if (line === '}') {
      models.push({
        name: current.name,
        delegate: current.name.charAt(0).toLowerCase() + current.name.slice(1),
        fields: current.fields,
        hasUserId: current.fields.includes('userId'),
        parents: [...current.parents],
      })
      current = undefined
      continue
    }
    const field = /^(\w+)\s+(\w+)/.exec(line)
    if (!field || line.startsWith('@@')) continue
    current.fields.push(field[1] ?? '')
    // A relation field that lists `fields:` is the side that holds the foreign key. A model that
    // refers to itself does not constrain the order of its own deletes.
    if (/@relation\([^)]*\bfields:\s*\[/.test(line) && field[2] !== current.name) {
      current.parents.add(field[2] ?? '')
    }
  }
  return models
}

export function schemaModels(): SchemaModel[] {
  return parseSchemaModels(readFileSync(SCHEMA_PATH, 'utf8'))
}

/**
 * The models `resetData` must clear: every model with a `userId` column except `User`. Models
 * without one (streams, files, plan weeks, sessions, revisions) are children of these and go with
 * them through `onDelete: Cascade`.
 */
export function userDataModels(models: readonly SchemaModel[]): SchemaModel[] {
  return models.filter((model) => model.hasUserId && model.name !== 'User')
}

/**
 * The shared caches: models with neither a `userId` column nor a foreign key, such as
 * `ForecastCache` and `ClimateCache`. They hold places and weather, not a user's rows, so deleting
 * a user never reaches them; `resetData` clears them so that one spec's forecast or race climate
 * cannot reach the next.
 */
export function sharedModels(models: readonly SchemaModel[]): SchemaModel[] {
  return models.filter(
    (model) => !model.hasUserId && model.parents.length === 0 && model.name !== 'User',
  )
}

/**
 * Foreign-key passes: a model is cleared only after every model that holds a foreign key to it,
 * so a restricting relation never blocks a delete. Pass 0 holds the models nothing else refers
 * to. Throws on a cycle between models.
 */
export function clearPasses(models: readonly SchemaModel[]): SchemaModel[][] {
  const level = new Map<string, number>()
  const visiting = new Set<string>()
  const byName = new Map(models.map((model) => [model.name, model]))
  function levelOf(name: string): number {
    const known = level.get(name)
    if (known !== undefined) return known
    if (visiting.has(name)) throw new Error(`Foreign-key cycle through ${name}.`)
    visiting.add(name)
    let result = 0
    for (const child of models) {
      if (child.parents.includes(name)) result = Math.max(result, levelOf(child.name) + 1)
    }
    visiting.delete(name)
    level.set(name, result)
    return result
  }
  const passes: SchemaModel[][] = []
  for (const name of byName.keys()) {
    const index = levelOf(name)
    ;(passes[index] ??= []).push(byName.get(name) as SchemaModel)
  }
  return passes.filter((pass) => pass.length > 0)
}

type Deletable = { deleteMany(): Promise<unknown> }

/**
 * Deletes every user's data and the shared caches, and keeps the `User` rows. The table list comes
 * from the schema, so a model added later is cleared without editing this function;
 * `tests/unit/server/resetData.test.ts` fails if one is skipped.
 */
export async function clearUserData(prisma: PrismaClient): Promise<void> {
  const delegates = prisma as unknown as Record<string, Deletable | undefined>
  const models = schemaModels()
  const passes = [...clearPasses(userDataModels(models)), sharedModels(models)]
  for (const pass of passes) {
    for (const model of pass) {
      const delegate = delegates[model.delegate]
      if (!delegate) throw new Error(`The Prisma client has no delegate ${model.delegate}.`)
      await delegate.deleteMany()
    }
  }
}
