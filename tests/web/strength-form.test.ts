import { afterEach, describe, expect, test, vi } from 'vitest'
import { fromGrams, stepsFor, toGrams } from '../../shared/domain/weight.ts'
import { structuresFor } from '../../shared/engine/strength.ts'
import { P } from '../../shared/engine/params/index.ts'
import { STRENGTH_COUNT_MAX, STRENGTH_SETS_MAX } from '../../shared/limits.ts'
import {
  applyDraft,
  clearDraft,
  draftOf,
  readDraft,
  writeDraft,
} from '../../web/components/strength/strengthDraft.ts'
import {
  asSuggested,
  blocksOf,
  buildLogBody,
  canAddSet,
  commonRir,
  hasLast,
  inUnit,
  initialState,
  lastSetsOf,
  loadText,
  newLogId,
  parseCount,
  parseLoad,
  parseMinutes,
  queuedLogOf,
  rowLoadG,
  sameAsLast,
  snapshotOf,
  stateFromBody,
  stepRowCount,
  stepRowLoad,
  swapChoices,
  swappedLift,
  totalSets,
  withAddedSet,
  withAllRir,
  withLift,
  withUsualLoad,
  withoutSet,
  type Block,
  type SetRow,
} from '../../web/components/strength/strengthForm.ts'
import { STRENGTH_DRAFT_PREFIX } from '../../web/pwa/drafts.ts'
import type { OutboxEntry } from '../../web/pwa/outbox.ts'
import { have } from '../unit/engine/strength-fixtures.ts'
import {
  DAY,
  SESSION_ID,
  bodyweightWorkout,
  calf,
  lb,
  lighterDayWorkout,
  makeLog,
  makeWorkout,
  plank,
  rdl,
  set,
  snapLift,
  squat,
} from './strength-fixtures.ts'

afterEach(() => {
  window.localStorage.clear()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

const row = (over: Partial<SetRow> = {}): SetRow => ({
  load: '110',
  count: '5',
  rir: null,
  ...over,
})
const block = (key: string): Block => {
  const found = blocksOf(makeWorkout(), 'lb').find((candidate) => candidate.key === key)
  expect(found, key).toBeDefined()
  return found as Block
}

describe('typed loads and counts', () => {
  test.each([
    ['', null],
    ['  ', null],
    ['0', null],
    ['0.0', null],
    ['115', lb(115)],
    ['47.5', toGrams(47.5, 'lb')],
    ['47,5', toGrams(47.5, 'lb')], // a decimal comma, as a phone keyboard may offer
    [' 52 ', lb(52)],
  ])('reads %j in pounds as %j grams', (text, grams) => {
    expect(parseLoad(text, 'lb')).toBe(grams)
  })

  test.each(['abc', '-5', '1e3', '12 lb', '.5', '5.', '1,0,0', '9999999'])(
    'refuses %j as a load',
    (text) => {
      expect(parseLoad(text, 'lb')).toBe('invalid')
    },
  )

  test('reads kilograms as grams', () => {
    expect(parseLoad('62.5', 'kg')).toBe(62500)
  })

  test('shows a load as the field holds it, on the display grid, and nothing for no load', () => {
    expect(loadText(lb(115), 'lb')).toBe('115')
    expect(loadText(52250, 'kg')).toBe('52.25')
    expect(loadText(null, 'lb')).toBe('')
  })

  test('reads the exact grams of a row while its text is still what they were made into', () => {
    // 20 kg shows as 44 lb, and is still the 20 000 g it was
    expect(rowLoadG(row({ load: '44', exactG: 20000 }), 'lb')).toBe(20000)
    // typed over, the text is what counts
    expect(rowLoadG(row({ load: '45', exactG: 20000 }), 'lb')).toBe(lb(45))
    expect(rowLoadG(row({ load: '', exactG: null }), 'lb')).toBeNull()
    expect(rowLoadG(row({ load: 'x', exactG: undefined }), 'lb')).toBe('invalid')
  })

  test('takes a count from one to the most the API stores, as a whole number', () => {
    expect(parseCount('1')).toBe(1)
    expect(parseCount(` ${String(STRENGTH_COUNT_MAX)} `)).toBe(STRENGTH_COUNT_MAX)
    for (const bad of ['', '0', '-1', '2.5', 'six', String(STRENGTH_COUNT_MAX + 1)]) {
      expect(parseCount(bad), bad).toBeNull()
    }
  })

  test('takes minutes from one to 300', () => {
    expect(parseMinutes('40')).toBe(40)
    expect(parseMinutes('300')).toBe(300)
    for (const bad of ['', '0', '301', '4.5', '40 min']) expect(parseMinutes(bad), bad).toBeNull()
  })
})

describe('what a press does to a set', () => {
  const bar = squat()
  const dumbbells = rdl()

  test('moves a barbell load by the jump, and a dumbbell load along the list', () => {
    expect(stepRowLoad(row({ exactG: lb(110) }), bar, 1, 'lb')).toMatchObject({
      load: '115',
      exactG: lb(115),
    })
    expect(stepRowLoad(row({ load: '40', exactG: lb(40) }), dumbbells, 1, 'lb').load).toBe('45')
    expect(stepRowLoad(row({ load: '40', exactG: lb(40) }), dumbbells, -1, 'lb').load).toBe('35')
  })

  test('returns the very row at an end, so the caller can tell nothing changed', () => {
    const bottom = row({ load: '45', exactG: lb(45) })
    expect(stepRowLoad(bottom, bar, -1, 'lb')).toBe(bottom)
    const top = row({ load: '60', exactG: lb(60) })
    expect(stepRowLoad(top, dumbbells, 1, 'lb')).toBe(top)
    const typed = row({ load: 'abc' })
    expect(stepRowLoad(typed, bar, 1, 'lb')).toBe(typed)
  })

  test('steps in kilograms on the rungs the equipment makes', () => {
    const kilos = squat({
      loadG: 50000,
      steps: stepsFor(have('barbell'), 'barbell', 'kg'),
    })
    const up = stepRowLoad(row({ load: '50', exactG: 50000 }), kilos, 1, 'kg')
    expect(Number(up.load)).toBeGreaterThan(50)
    expect(up.exactG).toBeGreaterThan(50000)
  })

  test('starts a movement that takes an added load only if any at the lightest, and steps back to none', () => {
    const added = rdl({ loadG: null, change: 'start' })
    const none = row({ load: '', exactG: null })
    const first = stepRowLoad(none, added, 1, 'lb')
    expect(first.exactG).toBe(lb(10))
    expect(stepRowLoad(first, added, -1, 'lb')).toMatchObject({ load: '', exactG: null })
    // a loaded lift stops at the lightest instead
    const lightest = row({ load: '10', exactG: lb(10) })
    expect(stepRowLoad(lightest, dumbbells, -1, 'lb')).toBe(lightest)
    // and a lift with no steps has nothing to step
    expect(stepRowLoad(none, calf(), 1, 'lb')).toBe(none)
  })

  test('moves a count by the step of its measure, never below one nor past the largest', () => {
    expect(stepRowCount(row({ count: '5' }), 'reps', 1).count).toBe('6')
    expect(stepRowCount(row({ count: '30' }), 'seconds', 1).count).toBe('35')
    expect(stepRowCount(row({ count: '30' }), 'seconds', -1).count).toBe('25')
    expect(stepRowCount(row({ count: '40' }), 'contacts', 1).count).toBe('50')
    const one = row({ count: '1' })
    expect(stepRowCount(one, 'reps', -1)).toBe(one)
    expect(stepRowCount(row({ count: '3' }), 'seconds', -1).count).toBe('1')
    const top = row({ count: String(STRENGTH_COUNT_MAX) })
    expect(stepRowCount(top, 'reps', 1)).toBe(top)
    // an empty field starts from nothing on a raise and has nothing to lower
    expect(stepRowCount(row({ count: '' }), 'reps', 1).count).toBe('1')
    const empty = row({ count: '' })
    expect(stepRowCount(empty, 'reps', -1)).toBe(empty)
  })
})

describe('the quiet buttons and the reps-left scale', () => {
  test('opens as the workout suggests, with no reps left and the planned minutes', () => {
    const state = initialState(makeWorkout(), 'lb')
    expect(state.minutes).toBe('40')
    expect(state.blocks.map((b) => [b.key, b.kind, b.rows.length])).toEqual([
      ['back-squat', 'lift', 4],
      ['dumbbell-rdl', 'lift', 3],
      ['standing-calf-raise', 'lift', 3],
      ['pogo-hop', 'plyo', 1],
      ['side-plank', 'trunk', 2],
    ])
    expect(state.blocks.flatMap((b) => b.rows.map((r) => r.rir))).toEqual(Array(13).fill(null))
    expect(state.blocks[3]?.rows[0]).toMatchObject({ load: '', count: '40' })
  })

  test('"As suggested" resets to the suggested sets, with the lowest reps left of the range', () => {
    const changed = blocksOf(makeWorkout(), 'lb').map((b) =>
      b.key === 'back-squat' ? withAddedSet(withoutSet(b, 0), 'lb') : b,
    )
    const suggested = asSuggested(changed, 'lb')
    expect(suggested.map((b) => b.rows.length)).toEqual([4, 3, 3, 1, 2])
    expect(suggested[0]?.rows.map((r) => r.rir)).toEqual([1, 1, 1, 1])
    expect(suggested[1]?.rows.map((r) => r.rir)).toEqual([2, 2, 2])
    expect(suggested[4]?.rows.map((r) => r.rir)).toEqual([null, null])
  })

  test('the reps-left value is shared only when every set holds it', () => {
    expect(commonRir([])).toBeNull()
    expect(commonRir([row({ rir: 2 }), row({ rir: 2 })])).toBe(2)
    expect(commonRir([row({ rir: 2 }), row({ rir: 3 })])).toBeNull()
    expect(commonRir([row({ rir: null }), row({ rir: null })])).toBeNull()
    const all = withAllRir(block('back-squat'), 3)
    expect(all.rows.map((r) => r.rir)).toEqual([3, 3, 3, 3])
    expect(withAllRir(all, null).rows.map((r) => r.rir)).toEqual([null, null, null, null])
  })

  test('adds a set as a copy of the last without its reps left, and removes one by place', () => {
    const base = withAllRir(block('back-squat'), 2)
    const added = withAddedSet(base, 'lb')
    expect(added.rows).toHaveLength(5)
    expect(added.rows[4]).toEqual({ ...base.rows[3], rir: null })
    expect(withoutSet(added, 0).rows).toHaveLength(4)
    const empty = { ...base, rows: [] }
    expect(withAddedSet(empty, 'lb').rows).toEqual([
      { load: '110', exactG: lb(110), count: '5', rir: null },
    ])
  })

  test('holds at most the sets of one log', () => {
    const big = {
      ...block('back-squat'),
      rows: Array.from({ length: STRENGTH_SETS_MAX }, () => row()),
    }
    expect(totalSets([big])).toBe(STRENGTH_SETS_MAX)
    expect(canAddSet([big])).toBe(false)
    expect(canAddSet([{ ...big, rows: big.rows.slice(1) }])).toBe(true)
  })

  test('"Use the usual load" sets the load the rules would have asked for in every set', () => {
    const lighter = blocksOf(lighterDayWorkout(), 'lb')[0] as Block
    expect(lighter.rows.map((r) => r.load)).toEqual(['100', '100', '100'])
    const usual = withUsualLoad(lighter, 'lb')
    expect(usual.rows.map((r) => [r.load, r.exactG])).toEqual([
      ['110', lb(110)],
      ['110', lb(110)],
      ['110', lb(110)],
    ])
    const normal = block('back-squat')
    expect(withUsualLoad(normal, 'lb')).toBe(normal)
  })
})

describe('the last sets of a lift', () => {
  const logs = [
    makeLog('newer', '2026-03-12', [
      set('back-squat', 1, 105, 5),
      set('back-squat', 0, 105, 6),
      set('dumbbell-rdl', 2, 35, 6),
    ]),
    makeLog('older', '2026-03-05', [
      set('back-squat', 0, 100, 5),
      set('standing-calf-raise', 1, null, 12),
    ]),
  ]

  test('are those of the newest log that has the lift, in the order they were done', () => {
    const last = lastSetsOf(logs)
    expect(last('back-squat', 'barbell').map((s) => [s.loadG, s.count])).toEqual([
      [lb(105), 6],
      [lb(105), 5],
    ])
    expect(last('standing-calf-raise', null)).toHaveLength(1)
    expect(last('leg-press', 'leg-press')).toEqual([])
  })

  test('are copied with no reps left, as the exact grams, and only onto a lift that was logged', () => {
    const last = lastSetsOf(logs)
    const copied = sameAsLast(blocksOf(makeWorkout(), 'lb'), last, 'lb')
    expect(copied[0]?.rows).toEqual([
      { load: '105', exactG: lb(105), count: '6', rir: null },
      { load: '105', exactG: lb(105), count: '5', rir: null },
    ])
    expect(copied[2]?.rows.map((r) => r.load)).toEqual(['']) // the calf raise has no load
    // a lift never logged, the jump dose and a trunk movement that was not logged are as they were
    expect(copied[3]?.rows).toEqual(blocksOf(makeWorkout(), 'lb')[3]?.rows)
    expect(copied[4]?.rows).toEqual(blocksOf(makeWorkout(), 'lb')[4]?.rows)
  })

  test('are copied onto one lift only when it is named', () => {
    const last = lastSetsOf(logs)
    const copied = sameAsLast(blocksOf(makeWorkout(), 'lb'), last, 'lb', 'dumbbell-rdl')
    expect(copied[0]?.rows).toHaveLength(4)
    expect(copied[1]?.rows).toHaveLength(1)
  })

  test('are not offered for the jump dose', () => {
    const last = lastSetsOf([makeLog('x', DAY, [set('pogo-hop', 0, null, 40)])])
    expect(hasLast(block('pogo-hop'), last)).toBe(false)
    expect(hasLast(block('back-squat'), lastSetsOf(logs))).toBe(true)
  })
})

describe('a swap', () => {
  const equipment = have('barbell', 'dumbbells', 'bands', 'step')
  // week 6 of a heavy block: the first session of an exercise is the ramp-in structure all the same
  const workout = makeWorkout()
  const first = structuresFor('heavy', 'other', 6).first

  test('lists the original first, then the feasible substitutes, without the exercise shown', () => {
    const start = block('back-squat')
    expect(swapChoices(start, equipment, true)).toEqual([
      'goblet-squat',
      'tempo-squat',
      'split-squat',
      'step-up',
      'single-leg-box-squat',
    ])
    const swapped = withLift(
      start,
      swappedLift(workout, 'goblet-squat', equipment, 'lb') as never,
      'lb',
    )
    expect(swapChoices(swapped, equipment, true)).toEqual([
      'back-squat',
      'tempo-squat',
      'split-squat',
      'step-up',
      'single-leg-box-squat',
    ])
  })

  test('starts a dumbbell lift as the first session of an exercise, at the lightest dumbbell', () => {
    const lift = swappedLift(workout, 'goblet-squat', equipment, 'lb')
    // not the sets, counts and effort of the heavy squat it replaces: the ramp-in structure
    expect(first.loaded.sets).not.toBe(squat().sets)
    expect(lift).toMatchObject({
      exerciseId: 'goblet-squat',
      slot: 'knee',
      implement: 'dumbbells',
      sets: first.loaded.sets,
      range: first.loaded.range,
      rir: first.loaded.rir,
      loadG: lb(10),
      change: 'start',
      usualLoadG: null,
      // the sheet read no session for it
      evidence: { latest: null, judged: null, estimateG: null },
    })
    expect(lift?.targets).toEqual(Array(first.loaded.sets).fill(first.loaded.range.min))
    expect(lift?.rir?.min).toBe(P.f7.easyRir.value)
    expect(lift?.steps).toEqual(stepsFor(equipment, 'dumbbells', 'lb'))
    expect(lift?.basis).toEqual({
      rule: 'F8',
      facts: [{ template: 'strength.sheet.swap-start', slots: { exercise: 'Goblet squat' } }],
    })
  })

  test('is the same first session in every template of the week', () => {
    for (const template of ['ramp-in', 'heavy', 'lighter-week', 'maintenance', 'taper'] as const) {
      const lift = swappedLift(
        { template, block: { week: 6, of: 12, rampInWeeks: 3 } },
        'goblet-squat',
        equipment,
        'lb',
      )
      expect([template, lift?.sets, lift?.range, lift?.rir]).toEqual([
        template,
        first.loaded.sets,
        first.loaded.range,
        first.loaded.rir,
      ])
    }
  })

  test('takes the bodyweight range for a movement with no load, and none for one that takes an added load if any', () => {
    const tempo = swappedLift(workout, 'tempo-squat', equipment, 'lb')
    expect(tempo).toMatchObject({
      implement: null,
      steps: null,
      loadG: null,
      sets: first.unloaded.sets,
      range: { min: P.f7.bodyweightReps.value[0], max: P.f7.bodyweightReps.value[1] },
    })
    expect(tempo?.basis.facts[0]?.template).toBe('strength.sheet.swap-start-unloaded')
    const box = swappedLift(workout, 'single-leg-box-squat', equipment, 'lb')
    expect(box?.loadG).toBeNull()
    expect(box?.steps).not.toBeNull()
    expect(box?.range).toEqual(first.unloaded.range)
    expect(box?.basis.facts[0]?.template).toBe('strength.sheet.swap-start-unloaded')
  })

  test('is null for an exercise the equipment cannot make, and for the barbell in a ramp-in or a return week', () => {
    expect(swappedLift(workout, 'leg-press', equipment, 'lb')).toBeNull()
    const ramp = { template: 'ramp-in' as const, block: { week: 1, of: 12, rampInWeeks: 3 } }
    expect(swappedLift(ramp, 'back-squat', have('barbell'), 'lb')).toBeNull()
    expect(swappedLift(workout, 'back-squat', have('barbell'), 'lb')?.implement).toBe('barbell')
    expect(swappedLift(workout, 'nothing' as never, equipment, 'lb')).toBeNull()
  })

  test('puts the lift in the block and fills its sets from it, with no reps left', () => {
    const lift = swappedLift(workout, 'goblet-squat', equipment, 'lb')
    const start = block('back-squat')
    const swapped = withLift(start, lift as never, 'lb')
    expect(swapped.shown).toBe(lift)
    expect(swapped.original).toBe(start.original)
    expect(swapped.rows.map((r) => [r.load, r.count, r.rir])).toEqual(
      Array.from({ length: first.loaded.sets }, () => ['10', String(first.loaded.range.min), null]),
    )
  })
})

describe('the log the sheet sends', () => {
  const input = (state = initialState(makeWorkout(), 'lb')) => ({
    workout: makeWorkout(),
    date: DAY,
    sessionId: SESSION_ID,
    activityId: null,
    state,
    unit: 'lb' as const,
  })

  test('holds every set in the order of the sheet, with the suggested loads as the very grams', () => {
    const built = buildLogBody(input())
    expect(built.ok).toBe(true)
    if (!built.ok) return
    expect(built.body.sets).toHaveLength(13)
    expect(built.body.sets[0]).toEqual({
      exerciseId: 'back-squat',
      loadG: lb(110),
      count: 5,
      rir: null,
    })
    expect(
      built.body.sets.map((s) => s.exerciseId).filter((id, i, all) => all.indexOf(id) === i),
    ).toEqual(['back-squat', 'dumbbell-rdl', 'standing-calf-raise', 'pogo-hop', 'side-plank'])
    expect(built.body).toMatchObject({ date: DAY, sessionId: SESSION_ID, durationMin: 40 })
    expect(built.body).not.toHaveProperty('activityId')
  })

  test('leaves out what is empty and carries the activity it attaches to', () => {
    const state = { ...initialState(makeWorkout(), 'lb'), notes: '  ', effort: 6, pain: 0 }
    const built = buildLogBody({ ...input(state), sessionId: null, activityId: 'imp-1' })
    expect(built.ok && built.body).toMatchObject({ activityId: 'imp-1', rpe: 6, pain: 0 })
    expect(built.ok && 'sessionId' in built.body).toBe(false)
    expect(built.ok && 'notes' in built.body).toBe(false)
  })

  test('names the fields it cannot read, the minutes it cannot take and an empty sheet', () => {
    const state = initialState(makeWorkout(), 'lb')
    const bad = {
      ...state,
      minutes: '0',
      blocks: state.blocks.map((b, i) =>
        i === 0 ? { ...b, rows: [row({ load: 'x' }), row({ count: '' })] } : b,
      ),
    }
    const built = buildLogBody(input(bad))
    expect(built.ok).toBe(false)
    if (built.ok) return
    expect(built.issues).toEqual({
      sets: [
        { key: 'back-squat', row: 0, field: 'load' },
        { key: 'back-squat', row: 1, field: 'count' },
      ],
      minutes: true,
      empty: false,
    })
    const empty = buildLogBody(
      input({ ...state, blocks: state.blocks.map((b) => ({ ...b, rows: [] })) }),
    )
    expect(!empty.ok && empty.issues.empty).toBe(true)
  })

  test('snapshots the lifts as shown with the load the rules asked for, jumps left out', () => {
    const workout = makeWorkout()
    const snapshot = snapshotOf(workout, blocksOf(workout, 'lb'))
    expect(snapshot).toMatchObject({
      template: 'heavy',
      variant: 'A',
      week: 6,
      mode: 'normal',
    })
    expect(snapshot.lifts.map((l) => l.exerciseId)).toEqual([
      'back-squat',
      'dumbbell-rdl',
      'standing-calf-raise',
      'side-plank',
    ])
    expect(JSON.parse(JSON.stringify(snapshot))).toEqual(snapshot)
    const outside = makeWorkout({ block: null, trunk: [plank()] })
    expect(snapshotOf(outside, blocksOf(outside, 'lb')).week).toBeNull()
  })

  test('snapshots a lighter day with the usual load as the base and the mode of the day', () => {
    const workout = lighterDayWorkout()
    const snapshot = snapshotOf(workout, blocksOf(workout, 'lb'))
    expect(snapshot.mode).toBe('lighter-day')
    expect(snapshot.lifts[0]).toMatchObject({ baseLoadG: lb(110), shownLoadG: lb(100) })
    expect(snapshot.lifts[1]).toMatchObject({ baseLoadG: lb(40), shownLoadG: lb(40) })
  })
})

describe('the id of a log', () => {
  const route = /^[\w-]{8,64}$/

  test('is a UUID where the browser has one', () => {
    vi.stubGlobal('crypto', { randomUUID: () => 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee' })
    expect(newLogId()).toBe('aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee')
  })

  test('is built from random bytes in a page that is not a secure context, and fits the outbox route', () => {
    vi.stubGlobal('crypto', {
      getRandomValues: (bytes: Uint8Array) => {
        bytes.forEach((_, i) => {
          bytes[i] = (i * 37 + 11) % 256
        })
        return bytes
      },
    })
    const id = newLogId()
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(id).toMatch(route)
    expect(newLogId()).toBe(id)
  })
})

describe('the draft', () => {
  const context = { sessionId: SESSION_ID, date: DAY, activityId: null }
  const LOG = '3f2b7c1e-8d4a-4f6b-9a31-5c0e2d7b6a10'

  test('puts back the sets, the swap and the footer over the workout it opened as', () => {
    const fresh = initialState(makeWorkout(), 'lb')
    const goblet = swappedLift(makeWorkout(), 'goblet-squat', have('dumbbells'), 'lb')
    expect(goblet).not.toBeNull()
    const entered = {
      ...fresh,
      minutes: '50',
      effort: 7,
      pain: 2,
      notes: 'Tight calf.',
      blocks: fresh.blocks.map((b) =>
        b.key === 'back-squat'
          ? {
              ...withLift(b, goblet as never, 'lb'),
              rows: [row({ load: '12', count: '8', rir: 3 })],
            }
          : b,
      ),
    }
    writeDraft(draftOf(LOG, context, entered, 1000, 'lb'))
    const draft = readDraft(context)
    expect(draft).not.toBeNull()
    const restored = applyDraft(fresh, draft as never, 'lb')
    expect(restored.minutes).toBe('50')
    expect([restored.effort, restored.pain, restored.notes]).toEqual([7, 2, 'Tight calf.'])
    expect(restored.blocks[0]?.shown).toEqual(goblet)
    expect(restored.blocks[0]?.original).toBe(fresh.blocks[0]?.original)
    expect(restored.blocks[0]?.rows).toEqual([{ load: '12', count: '8', rir: 3 }])
    // the blocks the draft held no change for keep their suggestion
    expect(restored.blocks[1]).toEqual(fresh.blocks[1])
  })

  test('drops a block the workout no longer has, and keeps one it never reached', () => {
    const fresh = initialState(makeWorkout({ lifts: [squat()], plyo: null, trunk: [] }), 'lb')
    const entered = initialState(makeWorkout(), 'lb')
    const draft = draftOf(LOG, context, entered, 1, 'lb')
    const restored = applyDraft(fresh, draft, 'lb')
    expect(restored.blocks.map((b) => b.key)).toEqual(['back-squat'])
    const reverse = applyDraft(entered, draftOf(LOG, context, fresh, 1, 'lb'), 'lb')
    expect(reverse.blocks.map((b) => b.key)).toEqual(entered.blocks.map((b) => b.key))
  })

  test('is found by the session, the day and the activity it is for, the newest first', () => {
    const state = initialState(makeWorkout(), 'lb')
    const A = '0a1b2c3d-1111-4222-8333-444455556666'
    const B = '0a1b2c3d-2222-4222-8333-444455556666'
    writeDraft(draftOf(A, context, { ...state, minutes: '35' }, 10, 'lb'))
    writeDraft(draftOf(B, context, { ...state, minutes: '50' }, 20, 'lb'))
    writeDraft(
      draftOf(
        '0a1b2c3d-3333-4222-8333-444455556666',
        { ...context, date: '2026-03-17' },
        state,
        30,
        'lb',
      ),
    )
    expect(readDraft(context)?.logId).toBe(B)
    expect(readDraft({ ...context, sessionId: 'other' })).toBeNull()
    expect(readDraft({ ...context, activityId: 'a-1' })).toBeNull()
    clearDraft(B)
    expect(readDraft(context)?.logId).toBe(A)
  })

  test('ignores a key whose id does not match its content, and anything that is not a draft', () => {
    const state = initialState(makeWorkout(), 'lb')
    const stored = JSON.stringify(draftOf(LOG, context, state, 1, 'lb'))
    window.localStorage.setItem(`${STRENGTH_DRAFT_PREFIX}another-key-0000`, stored)
    window.localStorage.setItem(`${STRENGTH_DRAFT_PREFIX}junk-0000-0000`, '[1,2')
    window.localStorage.setItem(`${STRENGTH_DRAFT_PREFIX}null-0000-0000`, 'null')
    window.localStorage.setItem(
      `${STRENGTH_DRAFT_PREFIX}${LOG}`,
      stored.replace('"minutes":"40"', '"minutes":40'),
    )
    expect(readDraft(context)).toBeNull()
  })

  test('refuses a draft whose swapped lift or sets are not the shape the sheet reads', () => {
    const state = initialState(makeWorkout(), 'lb')
    const draft = draftOf(LOG, context, state, 1, 'lb')
    const bad = (over: unknown) => {
      window.localStorage.setItem(
        `${STRENGTH_DRAFT_PREFIX}${LOG}`,
        JSON.stringify({ ...draft, ...(over as object) }),
      )
      return readDraft(context)
    }
    expect(bad({})).not.toBeNull()
    expect(bad({ effort: 11 })).toBeNull()
    expect(bad({ weightUnit: 'stone' })).toBeNull()
    expect(bad({ weightUnit: undefined })).toBeNull()
    expect(
      bad({
        blocks: [{ key: 'back-squat', swapped: null, rows: [{ load: 1, count: '5', rir: null }] }],
      }),
    ).toBeNull()
    expect(
      bad({
        blocks: [{ key: 'back-squat', swapped: null, rows: [{ load: '1', count: '5', rir: 9 }] }],
      }),
    ).toBeNull()
    expect(
      bad({ blocks: [{ key: 'back-squat', swapped: { exerciseId: 'back-squat' }, rows: [] }] }),
    ).toBeNull()
    expect(bad({ blocks: 'none' })).toBeNull()
  })

  test('survives blocked storage: nothing is read or kept, and nothing throws', () => {
    const blocked = () => {
      throw new DOMException('Blocked.', 'SecurityError')
    }
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(blocked)
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(blocked)
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(blocked)
    vi.spyOn(Storage.prototype, 'key').mockImplementation(blocked)
    const state = initialState(makeWorkout(), 'lb')
    expect(() => {
      writeDraft(draftOf(LOG, context, state, 1, 'lb'))
    }).not.toThrow()
    expect(() => {
      clearDraft(LOG)
    }).not.toThrow()
    expect(readDraft(context)).toBeNull()
  })
})

describe('the last sets of a lift in another implement (design 6.5)', () => {
  const kettle = makeLog(
    'kettle',
    '2026-03-12',
    [set('goblet-squat', 0, 35, 8)],
    [snapLift('goblet-squat', 'kettlebells', 35)],
  )
  const dumbbell = makeLog(
    'dumbbell',
    '2026-03-05',
    [set('goblet-squat', 0, 25, 8)],
    [snapLift('goblet-squat', 'dumbbells', 25)],
  )
  const unmarked = makeLog('unmarked', '2026-02-26', [set('goblet-squat', 0, 20, 10)])
  const equipment = have('dumbbells', 'kettlebells')

  test('are those of the newest session in the implement the lift is shown with', () => {
    const last = lastSetsOf([kettle, dumbbell])
    expect(last('goblet-squat', 'kettlebells')[0]?.loadG).toBe(lb(35))
    expect(last('goblet-squat', 'dumbbells')[0]?.loadG).toBe(lb(25))
    expect(last('goblet-squat', 'barbell')).toEqual([])
    expect(last('goblet-squat', null)).toEqual([])
  })

  test('count a log with no snapshot of the lift for any implement, as the engine does', () => {
    const last = lastSetsOf([kettle, unmarked])
    expect(last('goblet-squat', 'dumbbells')[0]?.loadG).toBe(lb(20))
    expect(last('goblet-squat', 'kettlebells')[0]?.loadG).toBe(lb(35))
  })

  test('are not copied into a lift shown with another implement, and the button is off for it', () => {
    const goblet = withLift(
      block('back-squat'),
      swappedLift(makeWorkout(), 'goblet-squat', have('dumbbells'), 'lb') as never,
      'lb',
    )
    expect(goblet.shown.implement).toBe('dumbbells')
    const last = lastSetsOf([kettle])
    expect(hasLast(goblet, last)).toBe(false)
    const blocks = [goblet]
    expect(sameAsLast(blocks, last, 'lb')[0]).toBe(goblet)
    // with a dumbbell session behind the kettlebell one, that is the one that is copied
    const both = sameAsLast(blocks, lastSetsOf([kettle, dumbbell]), 'lb')
    expect(both[0]?.rows.map((r) => r.load)).toEqual(['25'])
    expect(equipment.length).toBe(2)
  })

  test('are copied with their counts and no load into a lift that has no load field', () => {
    const floor = [
      makeLog('floor', '2026-03-12', [
        set('standing-calf-raise', 0, 80, 12),
        set('standing-calf-raise', 1, 80, 10),
      ]),
    ]
    const copied = sameAsLast(blocksOf(bodyweightWorkout(), 'lb'), lastSetsOf(floor), 'lb')
    const calfBlock = copied.find((b) => b.key === 'standing-calf-raise')
    expect(calfBlock?.rows).toEqual([
      { load: '', exactG: null, count: '12', rir: null },
      { load: '', exactG: null, count: '10', rir: null },
    ])
    // a lift with a load field (a calf machine) keeps the load it was logged with
    const machine = makeWorkout({
      lifts: [
        calf({
          implement: 'calf-machine',
          steps: { minG: lb(10), stepG: lb(10), maxG: lb(200) },
          loadG: lb(70),
        }),
      ],
      plyo: null,
      trunk: [],
    })
    const kept = sameAsLast(blocksOf(machine, 'lb'), lastSetsOf(floor), 'lb')
    expect(kept[0]?.rows.map((r) => r.load)).toEqual(['80', '80'])
  })

  test('a session on a calf machine is not a session on the floor', () => {
    const machine = makeLog(
      'machine',
      '2026-03-12',
      [set('standing-calf-raise', 0, 80, 12)],
      [snapLift('standing-calf-raise', 'calf-machine', 80)],
    )
    const [, , floorCalf] = blocksOf(bodyweightWorkout(), 'lb')
    expect(floorCalf?.shown.implement).toBeNull()
    expect(hasLast(floorCalf as Block, lastSetsOf([machine]))).toBe(false)
    const withMachine = { ...(floorCalf as Block) }
    withMachine.shown = { ...withMachine.shown, implement: 'calf-machine' }
    expect(hasLast(withMachine, lastSetsOf([machine]))).toBe(true)
  })
})

describe('a draft kept in one unit and put back in another', () => {
  const context = { sessionId: SESSION_ID, date: DAY, activityId: null }
  const LOG = '3f2b7c1e-8d4a-4f6b-9a31-5c0e2d7b6a10'

  test('puts back the same grams in the unit now chosen, for a load from the rules and for a typed one', () => {
    const typedGrams = toGrams(135, 'lb')
    const entered = initialState(makeWorkout(), 'lb')
    const withLoads = {
      ...entered,
      blocks: entered.blocks.map((b) =>
        b.key === 'back-squat'
          ? {
              ...b,
              rows: [
                row({ load: '110', exactG: lb(110) }),
                row({ load: '135' }),
                row({ load: 'heavy' }),
              ],
            }
          : b,
      ),
    }
    writeDraft(draftOf(LOG, context, withLoads, 1, 'lb'))
    const draft = readDraft(context)
    expect(draft?.weightUnit).toBe('lb')
    const restored = applyDraft(initialState(makeWorkout(), 'kg'), draft as never, 'kg')
    const rows = restored.blocks[0]?.rows ?? []
    expect(rows[0]?.load).toBe(String(fromGrams(lb(110), 'kg')))
    expect(rows.map((r) => rowLoadG(r, 'kg')).slice(0, 2)).toEqual([lb(110), typedGrams])
    expect(rows[1]?.load).toBe(String(fromGrams(typedGrams, 'kg')))
    // text that was not a number stays as it was typed
    expect(rows[2]?.load).toBe('heavy')
    // and the same unit leaves the rows as they were
    const same = applyDraft(initialState(makeWorkout(), 'lb'), draft as never, 'lb')
    expect(same.blocks[0]?.rows[1]).toEqual({ load: '135', count: '5', rir: null })
  })

  test('inUnit changes the text and keeps the grams, in either direction', () => {
    const lbRow = row({ load: '110', exactG: lb(110) })
    const kg = inUnit(lbRow, 'lb', 'kg')
    expect(rowLoadG(kg, 'kg')).toBe(lb(110))
    expect(rowLoadG(inUnit(kg, 'kg', 'lb'), 'lb')).toBe(lb(110))
    expect(inUnit(lbRow, 'lb', 'lb')).toBe(lbRow)
    const none = row({ load: '', exactG: null })
    expect(inUnit(none, 'lb', 'kg')).toMatchObject({ load: '', exactG: null })
  })
})

describe('a save that is still in the outbox', () => {
  const ID = '3f2b7c1e-8d4a-4f6b-9a31-5c0e2d7b6a10'
  const entry = (
    logId: string,
    body: Record<string, unknown>,
    seq = 1,
    url = `/api/strength/logs/${logId}`,
  ): OutboxEntry => ({ url, body, queuedAt: 1, seq, version: 1 })
  const input = (state = initialState(makeWorkout(), 'lb')) => ({
    workout: makeWorkout(),
    date: DAY,
    sessionId: SESSION_ID,
    activityId: null,
    state,
    unit: 'lb' as const,
  })
  const bodyOf = (state = initialState(makeWorkout(), 'lb')) => {
    const built = buildLogBody(input(state))
    expect(built.ok).toBe(true)
    return (built.ok ? built.body : null) as never as Record<string, unknown>
  }
  const match = { sessionId: SESSION_ID, date: DAY, activityId: null }

  test('is found by the session, the day and the activity, under the id it was queued with', () => {
    const body = bodyOf()
    expect(queuedLogOf([entry(ID, body)], match)?.logId).toBe(ID)
    expect(queuedLogOf([entry(ID, body)], { ...match, date: '2026-03-17' })).toBeNull()
    expect(queuedLogOf([entry(ID, body)], { ...match, sessionId: 'other' })).toBeNull()
    expect(queuedLogOf([entry(ID, body)], { ...match, activityId: 'a-1' })).toBeNull()
    expect(queuedLogOf([entry(ID, body)], { ...match, sessionId: null })).toBeNull()
  })

  test('matches a log that stands for no session, and an attach to an activity, by what the body holds', () => {
    const { sessionId: _link, ...unlinked } = bodyOf()
    expect(queuedLogOf([entry(ID, unlinked)], { ...match, sessionId: null })?.logId).toBe(ID)
    const attached = { ...unlinked, activityId: 'imp-1' }
    expect(
      queuedLogOf([entry(ID, attached)], { sessionId: null, date: DAY, activityId: 'imp-1' })
        ?.logId,
    ).toBe(ID)
  })

  test('ignores another kind of entry and a body that is not a log, and takes the newest of two', () => {
    const body = bodyOf()
    const other = '0a1b2c3d-1111-4222-8333-444455556666'
    expect(queuedLogOf([entry('abcdefgh', body, 1, '/api/fuel/logs/abcdefgh')], match)).toBeNull()
    expect(queuedLogOf([entry(ID, { ...body, sets: 'none' })], match)).toBeNull()
    expect(queuedLogOf([entry(ID, { ...body, prescribed: undefined })], match)).toBeNull()
    expect(queuedLogOf([entry(ID, body, 1), entry(other, body, 2)], match)?.logId).toBe(other)
    expect(queuedLogOf([entry(other, body, 5), entry(ID, body, 2)], match)?.logId).toBe(other)
  })

  test('puts back the sets, the minutes and the footer of the body over the sheet the workout opens as', () => {
    const fresh = initialState(makeWorkout(), 'lb')
    const entered = {
      ...fresh,
      minutes: '55',
      effort: 7,
      pain: 2,
      notes: 'Left knee felt tight.',
      blocks: fresh.blocks.map((b) =>
        b.key === 'back-squat'
          ? { ...b, rows: [row({ load: '115', exactG: lb(115), count: '6', rir: 2 })] }
          : b.key === 'dumbbell-rdl'
            ? { ...b, rows: [] }
            : b,
      ),
    }
    const body = bodyOf(entered) as never
    const restored = stateFromBody(fresh, body, 'lb')
    expect(restored.minutes).toBe('55')
    expect([restored.effort, restored.pain, restored.notes]).toEqual([
      7,
      2,
      'Left knee felt tight.',
    ])
    expect(restored.blocks[0]?.rows).toEqual([{ load: '115', exactG: lb(115), count: '6', rir: 2 }])
    // a lift with no sets in the body had them taken out
    expect(restored.blocks[1]?.rows).toEqual([])
    // and the sheet sends what it sent
    expect(bodyOf(restored)).toEqual(bodyOf(entered))
  })

  test('rebuilds a swapped lift from the snapshot, with its loads in view, and sends the same sets again', () => {
    const fresh = initialState(makeWorkout(), 'lb')
    const goblet = swappedLift(makeWorkout(), 'goblet-squat', have('dumbbells'), 'lb')
    const swapped = {
      ...fresh,
      blocks: fresh.blocks.map((b) =>
        b.key === 'back-squat' ? withLift(b, goblet as never, 'lb') : b,
      ),
    }
    const body = bodyOf(swapped)
    const restored = stateFromBody(fresh, body as never, 'lb')
    const shown = restored.blocks[0]?.shown
    expect(shown).toMatchObject({
      exerciseId: 'goblet-squat',
      slot: 'knee',
      implement: 'dumbbells',
      loadG: lb(10),
      sets: goblet?.sets,
      change: 'start',
    })
    // the bar's steps are not the dumbbells': none until the saved equipment is read
    expect(shown?.steps).toBeNull()
    expect(restored.blocks[0]?.original).toBe(fresh.blocks[0]?.original)
    expect(bodyOf(restored)).toEqual(body)
  })
})
