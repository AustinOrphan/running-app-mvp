// The policy that decides whether a revision can be undone (phase 3a design 4.2, ADR 0007). Pure:
// no I/O and no clock. The server reads the rows and the clock and hands this module facts; this
// module answers with findings, which `shared/copy/revision.ts` turns into sentences.
//
// An undo is allowed while all of these hold:
//
//   1. the revision has a payload, is not undone and is not itself an undo;
//   2. its plan is still active;
//   3. it is younger than `P.revision.undoWindowDays`;
//   4. no session or week it created or changed has changed since (`edited-since`);
//   5. none of its sessions has been run or linked to an activity since (`session-run`);
//   6. no safety rule it cites (n-1 to n-4) is still active (`safety-rule`), because G6 makes the
//      more conservative rule win; a rest window the runner reported is the one exception, so a
//      runner can always withdraw their own statement;
//   7. the restored plan passes the quality checklist (`checklist`, run by the server on the
//      restored rows, never here).
//
// Checks 1 to 3 need the revision alone. Checks 4 to 6 are structural: they read the touched rows
// and the current input once, not the plan. Check 7 is the only one that builds a plan.
import type { PlanDiff, UndoReasonCode } from '../types.ts'
import { redsHold } from './macro.ts'
import type { AthleteState, PlanChange, ReadinessSnapshot, WeeklyDecision } from './types.ts'

const DAY_MS = 86_400_000

// ---------------------------------------------------------------------------------------------
// Safety rules (n-1 to n-4)
// ---------------------------------------------------------------------------------------------

/** The red-flag rules of `research/engine-rules.md` section (n) that hold a plan back: G6. */
export const SAFETY_RULES = ['n-1', 'n-2', 'n-3', 'n-4'] as const
export type SafetyRule = (typeof SAFETY_RULES)[number]

const SAFETY_ID = /^n-?([1-4])$/i

/** The safety rules among rule ids, spelled `n-1`, in order. Other ids (n-6, J5, g-6) are ignored. */
export function safetyRulesIn(ids: Iterable<string>): SafetyRule[] {
  const found = new Set<string>()
  for (const id of ids) {
    const match = typeof id === 'string' ? SAFETY_ID.exec(id.trim()) : null
    if (match) found.add(`n-${match[1]}`)
  }
  return SAFETY_RULES.filter((rule) => found.has(rule))
}

function rulesOf(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : []
}

/**
 * The safety rules a revision cites: on its week-level changes, on the signals of the weekly
 * decision it acted on and on the sessions of its diff. Stored JSON may be incomplete, so every
 * list is read defensively.
 */
export function citedSafetyRules(revision: {
  changes: readonly PlanChange[]
  decision: WeeklyDecision | null
  diff: PlanDiff | null
}): SafetyRule[] {
  const ids: string[] = []
  for (const change of revision.changes) ids.push(...rulesOf(change.rules))
  for (const signal of revision.decision?.signals ?? []) ids.push(...rulesOf(signal.rules))
  for (const line of revision.diff?.sessions ?? []) ids.push(...rulesOf(line.rules))
  return safetyRulesIn(ids)
}

/**
 * The safety rules that apply to the runner now: the red flags of today's readiness (focal bone
 * pain n-1, pain n-2, illness n-3) and the REDs hold (n-4, two or more signs on the latest
 * screening). The same predicates the engine holds a plan back with.
 */
export function activeSafetyRules(now: {
  readiness: Pick<ReadinessSnapshot, 'redFlags'>
  state: AthleteState
}): SafetyRule[] {
  const ids = now.readiness.redFlags.flatMap((flag) => flag.rules)
  if (redsHold(now.state)) ids.push('n-4')
  return safetyRulesIn(ids)
}

/**
 * The cited safety rules that are still active and so refuse the undo. A revision that created a
 * rest window the runner reported is never refused on safety grounds: the window was the runner's
 * own statement and withdrawing it is theirs to do.
 */
export function undoSafety(args: {
  cited: readonly SafetyRule[]
  active: readonly SafetyRule[]
  createdWindow: boolean
}): SafetyRule[] {
  if (args.createdWindow) return []
  return args.cited.filter((rule) => args.active.includes(rule))
}

// ---------------------------------------------------------------------------------------------
// Eligibility
// ---------------------------------------------------------------------------------------------

/** One refusal: a reason code, the row or rules it names, and the row's own words for a message. */
export interface UndoFinding {
  code: UndoReasonCode
  sessionId?: string
  weekStart?: string
  disruptionId?: string
  rules?: string[]
  /** The title and date of the session named, for the sentence. */
  title?: string
  date?: string
  /** For `checklist`: the ids of the checklist items the restored plan does not pass. */
  items?: string[]
}

/** What checks 1 to 3 read: the revision itself. */
export interface UndoRevisionFacts {
  reason: string
  hasPayload: boolean
  undone: boolean
  createdAtMs: number
  planActive: boolean
}

/** The checks that need the revision alone, in order; null when none refuses. */
export type RevisionUndoReason = Extract<
  UndoReasonCode,
  'already-undone' | 'is-undo' | 'not-undoable' | 'plan-archived' | 'window-passed'
>

export function revisionUndoReason(
  revision: UndoRevisionFacts,
  nowMs: number,
  windowDays: number,
): RevisionUndoReason | null {
  if (revision.undone) return 'already-undone'
  if (revision.reason === 'undo') return 'is-undo'
  if (!revision.hasPayload) return 'not-undoable'
  if (!revision.planActive) return 'plan-archived'
  if (nowMs - revision.createdAtMs >= windowDays * DAY_MS) return 'window-passed'
  return null
}

/**
 * How a row the undo would restore stands against the revision that wrote it. `run` is checked
 * before the content, because linking a run changes the session's status as well as its link and
 * must read as a run, never as an edit.
 */
export type UndoStanding = 'as-left' | 'edited' | 'run'

/** A session or week the revision created, changed or deleted, dated today or later. */
export interface UndoRowFact {
  kind: 'session' | 'week'
  /** The row's id. */
  id: string
  /** The week's Monday; null for a week row that no longer exists, whose Monday is unknown. */
  weekStart: string | null
  title: string | null
  date: string | null
  standing: UndoStanding
}

export interface UndoEligibilityInput {
  revision: UndoRevisionFacts & {
    disruptionId: string | null
    /** The revision created a rest window the runner reported. */
    createdWindow: boolean
    cited: readonly SafetyRule[]
  }
  nowMs: number
  windowDays: number
  /** The touched rows an undo would restore: those dated today or later (see the server). */
  rows: readonly UndoRowFact[]
  /** The safety rules that apply now. */
  active: readonly SafetyRule[]
}

/**
 * Every structural reason an undo is refused, in the order of the policy: the revision's own
 * reason alone when there is one, otherwise the rows edited since, the runs linked since and the
 * safety rules still active. Empty when the undo is allowed as far as checks 1 to 6 can tell. A
 * revision whose rows all lie in the past has nothing to restore.
 */
export function undoEligibility(input: UndoEligibilityInput): UndoFinding[] {
  const own = revisionUndoReason(input.revision, input.nowMs, input.windowDays)
  if (own !== null) return [{ code: own }]
  if (input.rows.length === 0) return [{ code: 'not-undoable' }]

  const named = (row: UndoRowFact): Omit<UndoFinding, 'code' | 'rules' | 'disruptionId'> => ({
    ...(row.kind === 'session' ? { sessionId: row.id } : {}),
    ...(row.weekStart === null ? {} : { weekStart: row.weekStart }),
    ...(row.title === null ? {} : { title: row.title }),
    ...(row.date === null ? {} : { date: row.date }),
  })
  const findings: UndoFinding[] = []
  for (const row of input.rows) {
    if (row.standing === 'edited') findings.push({ code: 'edited-since', ...named(row) })
  }
  for (const row of input.rows) {
    if (row.standing === 'run') findings.push({ code: 'session-run', ...named(row) })
  }
  const blocking = undoSafety({
    cited: input.revision.cited,
    active: input.active,
    createdWindow: input.revision.createdWindow,
  })
  if (blocking.length > 0) {
    findings.push({
      code: 'safety-rule',
      rules: blocking,
      ...(input.revision.disruptionId === null
        ? {}
        : { disruptionId: input.revision.disruptionId }),
    })
  }
  return findings
}
