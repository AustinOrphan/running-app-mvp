import { describe, expect, test } from 'vitest'
import { describeUndoFinding } from '../../../shared/copy/revision.ts'
import { assertCleanCopy } from '../../../shared/copy/lint.ts'
import { P } from '../../../shared/engine/params/index.ts'
import type { AthleteState, PlanChange, WeeklyDecision } from '../../../shared/engine/types.ts'
import {
  SAFETY_RULES,
  activeSafetyRules,
  citedSafetyRules,
  revisionUndoReason,
  safetyRulesIn,
  undoEligibility,
  undoSafety,
  type UndoEligibilityInput,
  type UndoRowFact,
} from '../../../shared/engine/undoGuard.ts'
import type { PlanDiff, SessionDiffLine } from '../../../shared/types.ts'

// The undo policy of design 4.2 as pure functions: which rule ids a revision cites, which are
// active, and the reasons an undo is refused. The rows and the clock arrive as facts.

const DAY_MS = 86_400_000
const WINDOW = P.revision.undoWindowDays.value
const NOW = Date.UTC(2026, 9, 21, 12)

const fresh = {
  reason: 'weekly',
  hasPayload: true,
  undone: false,
  createdAtMs: NOW - DAY_MS,
  planActive: true,
}

const row = (over: Partial<UndoRowFact> = {}): UndoRowFact => ({
  kind: 'session',
  id: 's1',
  weekStart: '2026-10-26',
  title: 'Easy run',
  date: '2026-10-27',
  standing: 'as-left',
  ...over,
})

function input(over: Partial<UndoEligibilityInput> = {}): UndoEligibilityInput {
  return {
    revision: {
      ...fresh,
      disruptionId: null,
      createdWindow: false,
      cited: [],
    },
    nowMs: NOW,
    windowDays: WINDOW,
    rows: [row()],
    active: [],
    ...over,
  }
}

const change = (rules: string[]): PlanChange => ({
  weekStart: '2026-10-19',
  field: 'targetRunMin',
  from: 1,
  to: 2,
  rules,
})
const line = (rules: string[]): SessionDiffLine => ({
  change: 'changed',
  externalId: 'e1',
  sessionId: 's1',
  date: '2026-10-27',
  weekStart: '2026-10-26',
  before: null,
  after: null,
  fields: [],
  rules,
})
const diffOf = (sessions: SessionDiffLine[]): PlanDiff => ({
  v: 1,
  sessions,
  weeks: [],
  holds: [],
  totals: { added: 0, removed: 0, changed: 0, weeksChanged: 0, runMinBefore: 0, runMinAfter: 0 },
  empty: false,
})
const decision = (signalRules: string[][]): WeeklyDecision => ({
  decision: 'reduce',
  signals: signalRules.map((rules, i) => ({ code: `s${String(i)}`, detail: 'x', rules })),
  nextWeekTargetMin: 90,
})

describe('safetyRulesIn', () => {
  test('keeps n-1 to n-4 in order, however the id is spelled', () => {
    expect(safetyRulesIn(['n-3', 'N1', 'n4', ' n-2 '])).toEqual(['n-1', 'n-2', 'n-3', 'n-4'])
    expect([...SAFETY_RULES]).toEqual(['n-1', 'n-2', 'n-3', 'n-4'])
  })

  test('ignores every other rule, including the other n rules', () => {
    expect(safetyRulesIn(['n-5', 'n-6', 'n-10', 'n-0', 'J5', 'g-6', 'design-4.2', ''])).toEqual([])
  })

  test('lists a rule once', () => {
    expect(safetyRulesIn(['n-3', 'n-3', 'N3'])).toEqual(['n-3'])
  })
})

describe('citedSafetyRules', () => {
  test('reads the changes, the signals of the weekly decision and the sessions of the diff', () => {
    expect(
      citedSafetyRules({
        changes: [change(['g-2', 'n-1'])],
        decision: decision([['J5'], ['n-3', 'J5']]),
        diff: diffOf([line(['F1', 'n-4'])]),
      }),
    ).toEqual(['n-1', 'n-3', 'n-4'])
  })

  test('cites nothing when no list names a safety rule', () => {
    expect(
      citedSafetyRules({
        changes: [change(['g-2', 'g-6'])],
        decision: decision([['J5']]),
        diff: diffOf([line(['F1'])]),
      }),
    ).toEqual([])
    expect(citedSafetyRules({ changes: [], decision: null, diff: null })).toEqual([])
  })

  test('reads stored JSON that lacks a list without throwing', () => {
    const bare = { weekStart: '2026-10-19', field: 'x', from: 1, to: 2 } as unknown as PlanChange
    const noRules = { ...line([]), rules: undefined } as unknown as SessionDiffLine
    const noSignals = { decision: 'hold', nextWeekTargetMin: 1 } as unknown as WeeklyDecision
    expect(
      citedSafetyRules({ changes: [bare], decision: noSignals, diff: diffOf([noRules]) }),
    ).toEqual([])
  })
})

describe('activeSafetyRules', () => {
  const state = (redsFlags: number) => ({ risk: { redsFlags } }) as AthleteState
  const flag = (rules: string[]) => ({ code: 'x', message: 'x', rules })

  test('reads the rules of the readiness red flags', () => {
    expect(
      activeSafetyRules({
        readiness: { redFlags: [flag(['n-3']), flag(['n-2', 'design-4.2'])] },
        state: state(0),
      }),
    ).toEqual(['n-2', 'n-3'])
  })

  test('adds n-4 at the REDs hold and not below it', () => {
    const below = P.j5.redsHoldFlags.value - 1
    expect(activeSafetyRules({ readiness: { redFlags: [] }, state: state(below) })).toEqual([])
    expect(
      activeSafetyRules({
        readiness: { redFlags: [] },
        state: state(P.j5.redsHoldFlags.value),
      }),
    ).toEqual(['n-4'])
  })

  test('ignores a suppression flag, which is n-6, not a safety rule here', () => {
    expect(
      activeSafetyRules({
        readiness: { redFlags: [flag(['J8', 'n-6'])] },
        state: state(0),
      }),
    ).toEqual([])
  })
})

describe('undoSafety', () => {
  test('refuses on the cited rules that are still active', () => {
    expect(
      undoSafety({ cited: ['n-1', 'n-3'], active: ['n-3', 'n-4'], createdWindow: false }),
    ).toEqual(['n-3'])
  })

  test('allows when none is active, or when nothing is cited', () => {
    expect(undoSafety({ cited: ['n-3'], active: ['n-1'], createdWindow: false })).toEqual([])
    expect(undoSafety({ cited: [], active: ['n-1', 'n-3'], createdWindow: false })).toEqual([])
  })

  test('never refuses the undo of a rest window the runner reported', () => {
    expect(undoSafety({ cited: ['n-3'], active: ['n-3'], createdWindow: true })).toEqual([])
  })
})

describe('revisionUndoReason', () => {
  const reasonOf = (over: Partial<typeof fresh>) =>
    revisionUndoReason({ ...fresh, ...over }, NOW, WINDOW)

  test('a young revision with a payload on an active plan has none', () => {
    expect(reasonOf({})).toBeNull()
  })

  test.each([
    ['an undone revision', { undone: true }, 'already-undone'],
    ['an undo', { reason: 'undo' }, 'is-undo'],
    ['a revision with no payload', { hasPayload: false }, 'not-undoable'],
    ['a revision of an archived plan', { planActive: false }, 'plan-archived'],
    ['a revision past the window', { createdAtMs: NOW - WINDOW * DAY_MS }, 'window-passed'],
  ])('%s', (_name, over, code) => {
    expect(reasonOf(over)).toBe(code)
  })

  test('the window is exact to the millisecond', () => {
    expect(reasonOf({ createdAtMs: NOW - WINDOW * DAY_MS + 1 })).toBeNull()
    expect(reasonOf({ createdAtMs: NOW - WINDOW * DAY_MS })).toBe('window-passed')
  })

  test('names the first that applies: undone, undo, payload, plan, window', () => {
    const all = {
      undone: true,
      reason: 'undo',
      hasPayload: false,
      planActive: false,
      createdAtMs: 0,
    }
    expect(reasonOf(all)).toBe('already-undone')
    expect(reasonOf({ ...all, undone: false })).toBe('is-undo')
    expect(reasonOf({ ...all, undone: false, reason: 'weekly' })).toBe('not-undoable')
    expect(reasonOf({ ...all, undone: false, reason: 'weekly', hasPayload: true })).toBe(
      'plan-archived',
    )
    expect(
      reasonOf({ ...all, undone: false, reason: 'weekly', hasPayload: true, planActive: true }),
    ).toBe('window-passed')
  })
})

describe('undoEligibility', () => {
  test('allows an undo with nothing against it', () => {
    expect(undoEligibility(input())).toEqual([])
  })

  test('a revision refused for its own state reads no row: that reason alone', () => {
    const rows = [row({ standing: 'edited' }), row({ id: 's2', standing: 'run' })]
    const findings = undoEligibility(
      input({
        rows,
        revision: { ...input().revision, undone: true, cited: ['n-3'] },
        active: ['n-3'],
      }),
    )
    expect(findings).toEqual([{ code: 'already-undone' }])
  })

  test('names every row edited since, with its words, and the week it belongs to', () => {
    const findings = undoEligibility(
      input({
        rows: [
          row({ standing: 'edited' }),
          row({
            id: 'w1',
            kind: 'week',
            weekStart: '2026-11-02',
            title: null,
            date: null,
            standing: 'edited',
          }),
          row({ id: 's3' }),
        ],
      }),
    )
    expect(findings).toEqual([
      {
        code: 'edited-since',
        sessionId: 's1',
        weekStart: '2026-10-26',
        title: 'Easy run',
        date: '2026-10-27',
      },
      { code: 'edited-since', weekStart: '2026-11-02' },
    ])
  })

  test('a row whose week is unknown (it is gone) is still named by its id', () => {
    const findings = undoEligibility(
      input({ rows: [row({ standing: 'edited', weekStart: null, title: null, date: null })] }),
    )
    expect(findings).toEqual([{ code: 'edited-since', sessionId: 's1' }])
  })

  test('a linked run is its own reason, never an edit', () => {
    const findings = undoEligibility(input({ rows: [row({ standing: 'run' })] }))
    expect(findings.map((f) => f.code)).toEqual(['session-run'])
    expect(findings[0]).toMatchObject({ sessionId: 's1', title: 'Easy run', date: '2026-10-27' })
  })

  test('lists the reasons in the order of the policy: edits, runs, safety', () => {
    const findings = undoEligibility(
      input({
        rows: [row({ id: 'a', standing: 'run' }), row({ id: 'b', standing: 'edited' })],
        revision: { ...input().revision, cited: ['n-3'] },
        active: ['n-3'],
      }),
    )
    expect(findings.map((f) => f.code)).toEqual(['edited-since', 'session-run', 'safety-rule'])
    expect(findings[2]).toMatchObject({ rules: ['n-3'] })
  })

  test('refuses on an active cited safety rule, with the window it came from', () => {
    const findings = undoEligibility(
      input({
        revision: { ...input().revision, cited: ['n-1', 'n-3'], disruptionId: 'w1' },
        active: ['n-3'],
      }),
    )
    expect(findings).toEqual([{ code: 'safety-rule', rules: ['n-3'], disruptionId: 'w1' }])
  })

  test('allows an active safety rule when the revision created the runner’s rest window', () => {
    expect(
      undoEligibility(
        input({
          revision: {
            ...input().revision,
            cited: ['n-3'],
            createdWindow: true,
            disruptionId: 'w1',
          },
          active: ['n-3'],
        }),
      ),
    ).toEqual([])
  })

  test('a cited rule that is no longer active does not refuse', () => {
    expect(
      undoEligibility(
        input({ revision: { ...input().revision, cited: ['n-3'] }, active: ['n-1'] }),
      ),
    ).toEqual([])
  })

  test('a revision whose rows all lie in the past has nothing to restore', () => {
    expect(undoEligibility(input({ rows: [] }))).toEqual([{ code: 'not-undoable' }])
  })

  test('every finding reads as a clean sentence', () => {
    const findings = undoEligibility(
      input({
        rows: [
          row({ standing: 'edited' }),
          row({
            id: 'w1',
            kind: 'week',
            weekStart: '2026-11-02',
            title: null,
            date: null,
            standing: 'edited',
          }),
          row({ id: 's2', standing: 'run' }),
        ],
        revision: { ...input().revision, cited: ['n-1', 'n-2', 'n-3', 'n-4'] },
        active: ['n-1', 'n-2', 'n-3', 'n-4'],
      }),
    )
    expect(findings.map((f) => f.code)).toEqual([
      'edited-since',
      'edited-since',
      'session-run',
      'safety-rule',
    ])
    for (const finding of findings) {
      const reason = describeUndoFinding(finding, WINDOW)
      expect(reason.message.length).toBeGreaterThan(0)
      assertCleanCopy(reason.message, finding.code)
    }
    expect(describeUndoFinding(findings[3]!, WINDOW).message).toBe(
      'This update followed a safety rule that still applies (bone pain, pain, illness and energy availability), so it stays.',
    )
  })
})
