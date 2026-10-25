import { describe, expect, it } from 'vitest'
import {
  diffPlans,
  type DiffSessionRow,
  type DiffWeekRow,
  type PlanWrites,
} from '../../../shared/engine/diff.ts'

const STEPS = JSON.stringify([{ kind: 'steady', reps: 1, durationSec: 2400, distanceM: null }])
const TARGET = JSON.stringify({ zone: 'z1', rpe: [2, 3], hr: null, paceSecPerKm: null })

function session(over: Partial<DiffSessionRow> = {}): DiffSessionRow {
  return {
    id: 's1',
    externalId: 'e1',
    weekStart: '2026-10-19',
    date: '2026-10-20',
    kind: 'easy',
    title: 'Easy run',
    durationMin: 40,
    distanceM: 6000,
    gainM: null,
    structure: STEPS,
    target: TARGET,
    status: 'planned',
    rules: JSON.stringify(['f-1']),
    ...over,
  }
}

function week(over: Partial<DiffWeekRow> = {}): DiffWeekRow {
  return { weekStart: '2026-10-19', targetRunMin: 200, flags: '[]', ...over }
}

const NONE: PlanWrites = {
  sessions: { created: [], deleted: [], updated: [] },
  weeks: { created: [], deleted: [], updated: [] },
}

describe('diffPlans', () => {
  it('is empty when nothing was written', () => {
    expect(diffPlans(NONE)).toEqual({
      v: 1,
      sessions: [],
      weeks: [],
      holds: [],
      totals: {
        added: 0,
        removed: 0,
        changed: 0,
        weeksChanged: 0,
        runMinBefore: 0,
        runMinAfter: 0,
      },
      empty: true,
    })
  })

  it('makes one line for every row written, and the totals count them', () => {
    const diff = diffPlans({
      sessions: {
        created: [session({ id: 's2', externalId: 'e2', date: '2026-10-22' })],
        deleted: [session({ id: 's3', externalId: 'e3', date: '2026-10-24', kind: 'long' })],
        updated: [
          { before: session(), after: session({ durationMin: 35, distanceM: 5200 }) },
          {
            before: session({ id: 's4', externalId: 'e4', date: '2026-10-21' }),
            after: session({ id: 's4', externalId: 'e4', date: '2026-10-21', title: 'Easy' }),
          },
        ],
      },
      weeks: NONE.weeks,
    })
    expect(diff.sessions.map((l) => [l.change, l.externalId])).toEqual([
      ['changed', 'e1'],
      ['changed', 'e4'],
      ['added', 'e2'],
      ['removed', 'e3'],
    ])
    expect(diff.totals).toMatchObject({ added: 1, removed: 1, changed: 2, weeksChanged: 0 })
    expect(diff.empty).toBe(false)
  })

  it('describes an added session by its row id and brief, and a removed one by the brief it had', () => {
    const diff = diffPlans({
      sessions: {
        created: [
          session({ id: 's2', externalId: 'e2', title: 'Hills', kind: 'hills', gainM: 120 }),
        ],
        deleted: [session({ id: 's3', externalId: 'e3', rules: JSON.stringify(['n-1', 'F1']) })],
        updated: [],
      },
      weeks: NONE.weeks,
    })
    const added = diff.sessions.find((l) => l.change === 'added')!
    expect(added).toEqual({
      change: 'added',
      externalId: 'e2',
      sessionId: 's2',
      date: '2026-10-20',
      weekStart: '2026-10-19',
      before: null,
      after: {
        date: '2026-10-20',
        kind: 'hills',
        title: 'Hills',
        durationMin: 40,
        distanceM: 6000,
        gainM: 120,
      },
      fields: [],
      rules: ['f-1'],
    })
    const removed = diff.sessions.find((l) => l.change === 'removed')!
    expect(removed).toMatchObject({ sessionId: 's3', after: null, rules: ['n-1', 'F1'] })
    expect(removed.before).toMatchObject({ kind: 'easy', title: 'Easy run' })
  })

  it('keeps a previewed session without an id', () => {
    const diff = diffPlans({
      sessions: {
        created: [session({ id: null, externalId: '' })],
        deleted: [],
        updated: [],
      },
      weeks: NONE.weeks,
    })
    expect(diff.sessions[0]).toMatchObject({ change: 'added', sessionId: null, externalId: '' })
  })

  it('names the fields that changed, one by one', () => {
    const fieldsOf = (after: Partial<DiffSessionRow>) =>
      diffPlans({
        sessions: {
          created: [],
          deleted: [],
          updated: [{ before: session(), after: session(after) }],
        },
        weeks: NONE.weeks,
      }).sessions[0]!.fields
    expect(fieldsOf({ date: '2026-10-21' })).toEqual(['date'])
    expect(fieldsOf({ kind: 'recovery' })).toEqual(['kind'])
    expect(fieldsOf({ durationMin: 41 })).toEqual(['durationMin'])
    expect(fieldsOf({ distanceM: null })).toEqual(['distanceM'])
    expect(fieldsOf({ gainM: 50 })).toEqual(['gainM'])
    expect(fieldsOf({ structure: '[]' })).toEqual(['structure'])
    // The targets are part of what the runner is asked to do inside the session.
    expect(fieldsOf({ target: JSON.stringify({ zone: 'z2' }) })).toEqual(['structure'])
    expect(fieldsOf({ status: 'skipped' })).toEqual(['status'])
    expect(fieldsOf({ date: '2026-10-22', status: 'moved', durationMin: 30 })).toEqual([
      'date',
      'durationMin',
      'status',
    ])
  })

  it('keeps a written row that changed in no listed field, with no fields', () => {
    const diff = diffPlans({
      sessions: {
        created: [],
        deleted: [],
        updated: [{ before: session(), after: session({ title: 'Easy run, steadier' }) }],
      },
      weeks: NONE.weeks,
    })
    expect(diff.sessions).toHaveLength(1)
    expect(diff.sessions[0]).toMatchObject({ change: 'changed', fields: [] })
    expect(diff.totals.changed).toBe(1)
  })

  it('reads the rules of the session as it is after the change', () => {
    const diff = diffPlans({
      sessions: {
        created: [],
        deleted: [],
        updated: [
          {
            before: session({ rules: JSON.stringify(['f-1']) }),
            after: session({ durationMin: 30, rules: JSON.stringify(['f-1', 'g-1']) }),
          },
        ],
      },
      weeks: NONE.weeks,
    })
    expect(diff.sessions[0]!.rules).toEqual(['f-1', 'g-1'])
  })

  it('reads damaged rules as none', () => {
    const diff = diffPlans({
      sessions: {
        created: [session({ rules: '{nope' })],
        deleted: [session({ rules: '5' })],
        updated: [],
      },
      weeks: NONE.weeks,
    })
    expect(diff.sessions.map((l) => l.rules)).toEqual([[], []])
  })

  it('lines up the weeks: created, deleted and updated, with their flags and minutes', () => {
    const diff = diffPlans({
      sessions: NONE.sessions,
      weeks: {
        created: [week({ weekStart: '2026-11-02', targetRunMin: 180, flags: '["taper"]' })],
        deleted: [week({ weekStart: '2026-11-09', targetRunMin: 90 })],
        updated: [
          {
            before: week({ targetRunMin: 200, flags: '["recovery","strength"]' }),
            after: week({ targetRunMin: 160, flags: '["strength","heat-acclimation"]' }),
          },
        ],
      },
    })
    expect(diff.weeks).toEqual([
      {
        weekStart: '2026-10-19',
        runMinBefore: 200,
        runMinAfter: 160,
        flagsAdded: ['heat-acclimation'],
        flagsRemoved: ['recovery'],
      },
      {
        weekStart: '2026-11-02',
        runMinBefore: 0,
        runMinAfter: 180,
        flagsAdded: ['taper'],
        flagsRemoved: [],
      },
      {
        weekStart: '2026-11-09',
        runMinBefore: 90,
        runMinAfter: 0,
        flagsAdded: [],
        flagsRemoved: [],
      },
    ])
    expect(diff.totals).toMatchObject({
      weeksChanged: 3,
      runMinBefore: 290,
      runMinAfter: 340,
    })
    expect(diff.empty).toBe(false)
  })

  it('a written week with no visible change is still a line, so the totals equal the rows written', () => {
    const diff = diffPlans({
      sessions: NONE.sessions,
      weeks: {
        created: [],
        deleted: [],
        updated: [{ before: week(), after: week({ flags: '[]' }) }],
      },
    })
    expect(diff.weeks).toHaveLength(1)
    expect(diff.totals.weeksChanged).toBe(1)
  })

  it('carries rest windows through, and a window alone makes the diff non-empty', () => {
    const holds = [{ from: '2026-10-21', to: '2026-10-25', label: 'Time off', disruptionId: 'd1' }]
    const diff = diffPlans({ ...NONE, holds })
    expect(diff.holds).toEqual(holds)
    expect(diff.empty).toBe(false)
    expect(diff.totals.added + diff.totals.removed + diff.totals.changed).toBe(0)
  })

  it('does not depend on the order the write produced its rows in', () => {
    const a = session({ id: 'a', externalId: 'ea', date: '2026-10-20' })
    const b = session({ id: 'b', externalId: 'eb', date: '2026-10-22', kind: 'long' })
    const c = session({ id: 'c', externalId: 'ec', date: '2026-10-22', kind: 'easy' })
    const writes = (created: DiffSessionRow[], weeks: DiffWeekRow[]): PlanWrites => ({
      sessions: { created, deleted: [], updated: [] },
      weeks: { created: weeks, deleted: [], updated: [] },
    })
    const w1 = week({ weekStart: '2026-10-19' })
    const w2 = week({ weekStart: '2026-10-26' })
    expect(diffPlans(writes([a, b, c], [w1, w2]))).toEqual(diffPlans(writes([c, b, a], [w2, w1])))
  })

  it('serialises an empty diff with the mark the revision list filters on, and only then', () => {
    expect(JSON.stringify(diffPlans(NONE))).toContain('"empty":true')
    const diff = diffPlans({
      sessions: {
        created: [session({ title: 'Easy "empty":true run' })],
        deleted: [],
        updated: [],
      },
      weeks: NONE.weeks,
    })
    expect(JSON.stringify(diff)).not.toContain('"empty":true')
  })

  it('names the raised week targets by week, outside the totals and without making the diff non-empty', () => {
    const later = {
      weekStart: '2026-11-02',
      outcome: 'kept',
      askedMin: 230,
      keptMin: 230,
      engineMin: 209,
      limit: 'ceiling',
      ramp: 0.3,
    } as const
    const earlier = {
      weekStart: '2026-10-26',
      outcome: 'clipped',
      askedMin: 400,
      keptMin: 247,
      engineMin: 209,
      limit: 'ceiling',
      ramp: 0.3,
    } as const
    const diff = diffPlans({ ...NONE, targets: [later, earlier] })
    expect(diff.targets).toEqual([earlier, later])
    expect(diff.empty).toBe(true)
    expect(diff.totals.weeksChanged).toBe(0)
    // a diff that met none carries no key at all, so it reads as it did before
    expect('targets' in diffPlans(NONE)).toBe(false)
    expect('targets' in diffPlans({ ...NONE, targets: [] })).toBe(false)
  })

  it('does not change what it is given', () => {
    const writes: PlanWrites = {
      sessions: {
        created: [session({ id: 's2', externalId: 'e2' })],
        deleted: [],
        updated: [{ before: session(), after: session({ durationMin: 20 }) }],
      },
      weeks: { created: [week()], deleted: [], updated: [] },
    }
    const copy = structuredClone(writes)
    diffPlans(writes)
    expect(writes).toEqual(copy)
  })
})
