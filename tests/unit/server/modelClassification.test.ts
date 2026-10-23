import { describe, expect, test } from 'vitest'
import { NON_STATE_MODELS, STATE_MODELS } from '../../../server/dataVersion.ts'
import { parseSchemaModels, schemaModels } from '../../schemaModels.ts'

/** One line per problem, each naming the model, so a failing run says what to classify. */
function classificationProblems(
  schema: readonly string[],
  state: readonly string[],
  nonState: readonly string[],
): string[] {
  const problems: string[] = []
  const classified = new Set([...state, ...nonState])
  for (const name of schema) {
    if (!classified.has(name)) {
      problems.push(
        `${name} is in prisma/schema.prisma but in neither STATE_MODELS nor NON_STATE_MODELS`,
      )
    }
  }
  for (const name of new Set(state)) {
    if (nonState.includes(name)) {
      problems.push(`${name} is listed in both STATE_MODELS and NON_STATE_MODELS`)
    }
  }
  for (const name of classified) {
    if (!schema.includes(name)) {
      problems.push(`${name} is classified but is not a model in prisma/schema.prisma`)
    }
  }
  for (const list of [state, nonState]) {
    const seen = new Set<string>()
    for (const name of list) {
      if (seen.has(name)) problems.push(`${name} is listed twice in one classification list`)
      seen.add(name)
    }
  }
  return problems
}

describe('model classification (ADR 0009)', () => {
  test('every model in prisma/schema.prisma is in exactly one of STATE_MODELS and NON_STATE_MODELS', () => {
    const names = schemaModels().map((model) => model.name)
    expect(names.length).toBeGreaterThan(10)
    expect(classificationProblems(names, STATE_MODELS, NON_STATE_MODELS)).toEqual([])
  })

  test('names an unclassified model', () => {
    expect(classificationProblems(['A', 'B', 'C'], ['A'], ['B'])).toEqual([
      'C is in prisma/schema.prisma but in neither STATE_MODELS nor NON_STATE_MODELS',
    ])
  })

  test('names a doubly classified model', () => {
    expect(classificationProblems(['A', 'B'], ['A', 'B'], ['B'])).toEqual([
      'B is listed in both STATE_MODELS and NON_STATE_MODELS',
    ])
  })

  test('names a classified model that the schema no longer has, and a repeated entry', () => {
    expect(classificationProblems(['A'], ['A', 'Gone'], ['A'])).toContain(
      'Gone is classified but is not a model in prisma/schema.prisma',
    )
    expect(classificationProblems(['A'], ['A', 'A'], [])).toEqual([
      'A is listed twice in one classification list',
    ])
  })

  test('the schema parser reads models whose comments contain braces', () => {
    const models = parseSchemaModels(
      [
        'datasource db {',
        '  provider = "sqlite"',
        '}',
        'model Alpha {',
        '  id String @id',
        '  note String? // JSON text: { a, b } shape',
        '  @@index([id])',
        '}',
        'model Beta {',
        '  id String @id',
        '  userId String',
        '  alpha Alpha @relation(fields: [id], references: [id])',
        '}',
      ].join('\n'),
    )
    expect(models.map((model) => model.name)).toEqual(['Alpha', 'Beta'])
    expect(models[0]?.fields).toEqual(['id', 'note'])
    expect(models[1]).toMatchObject({ hasUserId: true, parents: ['Alpha'], delegate: 'beta' })
  })

  test('keeps what the snapshot reads as state and what is written on a read as non-state', () => {
    // Spec 4.3: a snapshot reads these; a write must invalidate it.
    for (const name of [
      'Activity',
      'WellnessDay',
      'AthleteProfile',
      'Goal',
      'Plan',
      'PlanSession',
    ]) {
      expect(STATE_MODELS).toContain(name)
    }
    // Written by a sync, an import or a read path: a state mark would invalidate the cache that
    // the same request just filled.
    for (const name of ['Integration', 'ImportBatch', 'ImportedFile', 'PredictionLog']) {
      expect(NON_STATE_MODELS).toContain(name)
    }
  })
})
