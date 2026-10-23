// The owner's edits of one session as one guarded action (phase 3a design 9.4, 9.5): move, swap,
// swap-kind, shorten, skip and restore. `adjustCheck` decides an edit from plain data and writes
// nothing: it names the guards it finds (each with a code, a fixed message that cites its rule and,
// where one exists, the alternative that would work) and, when none refuses, the changes to the
// session rows. Pure and deterministic: today and the stored plan arrive as arguments.
//
// What it holds:
// - The logic the plan engine's owner edits used before: the race stays, a done, linked or skipped
//   session stays, a move stays in its week, runs go on days the runner runs [availability], one
//   run a day and no hard day next to a hard day [rule F1].
// - New with phase 3a: the long run not between two quality days [F3], rest windows, quiet days and
//   per-day run caps [J9], the session spike limit [g-1], the weekly target [G-2, G-6] for a
//   restore, a back-to-back pair that stays together [H3], and the shorten builder.
//
// Safety rules win [G6]: a guard that `blocks` refuses the edit whatever the runner asked; a guard
// that `warns` lets it through with its reason.
import {
  adjustText,
  movedSummary,
  restoredSummary,
  shortenedSummary,
  skippedSummary,
  swappedSummary,
} from '../copy/revision.ts'
import { addDays, daysBetween, mondayOf } from '../dates.ts'
import { isToRun } from '../domain/sessionStatus.ts'
import type {
  AdjustGuardCode,
  Availability,
  PlanAdjustment,
  PlanGuardView,
  PlanSession,
  PlanSessionStatus,
  PlanSuggestion,
  Weekday,
} from '../types.ts'
import type { DayRule } from './disruption.ts'
import { minSize, scaleSession, spikeLevelOf } from './guards.ts'
import { EPS, isProgramme, recordOf, referenceAt, VOLUME_KINDS, type RunRecord } from './limits.ts'
import { P } from './params/index.ts'
import { sessionTitle } from './sessions.ts'
import type { PlanChange, Quantity, SessionKind, SessionSpec } from './types.ts'

// ---------------------------------------------------------------------------------------------
// Kinds
// ---------------------------------------------------------------------------------------------

/** Kinds that need the day after them easy [rules F1]; the same set the week placement uses. */
export const HARD_KINDS: ReadonlySet<SessionKind> = new Set<SessionKind>([
  'threshold',
  'intervals',
  'race-pace',
  'hills',
  'long-fast-finish',
  'b2b',
  'race',
])
/** Kinds that occupy a run day. */
export const RUN_KINDS: ReadonlySet<SessionKind> = new Set<SessionKind>([
  'easy',
  'recovery',
  'long',
  'long-fast-finish',
  'threshold',
  'intervals',
  'race-pace',
  'strides',
  'hills',
  'hike',
  'b2b',
  'race',
])
/** Quality sessions: the long run does not sit between two of them [rule F3]. */
const QUALITY_KINDS: ReadonlySet<SessionKind> = new Set<SessionKind>([
  'threshold',
  'intervals',
  'race-pace',
  'hills',
])
/** Sessions a day that windows keep easy does not hold [rule J9]. */
const NO_QUALITY_KINDS: ReadonlySet<SessionKind> = new Set<SessionKind>([
  'threshold',
  'intervals',
  'race-pace',
  'hills',
  'long-fast-finish',
  'b2b',
  'strides',
])
/** Sessions a day that a window holds does not carry: runs, hikes and strength [rule J9]. */
const HELD_KINDS: ReadonlySet<SessionKind> = new Set<SessionKind>([...RUN_KINDS, 'strength'])

const WEEKDAYS: readonly Weekday[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']
/** The rule id that marks a trimmed session; a trim keeps its status when a restore puts it back. */
const TRIM_RULE = 'design-4.3'
/** The rule a shorten cites: the minutes it takes out are not made up [rule G-6]. */
const NEVER_MAKE_UP = 'g-6'
/** One minute of rounding in a week's total, as the quality checklist allows. */
const WEEK_ROUNDING_MIN = 1

// ---------------------------------------------------------------------------------------------
// Input and result
// ---------------------------------------------------------------------------------------------

export interface AdjustContext {
  /** The local day, YYYY-MM-DD. */
  today: string
  availability: Availability
  /**
   * The plan's sessions from `g1.windowDays + 1` days before the session's week to the day after
   * it: the neighbours of the spacing rules and the planned runs of the 30-day reference. Includes
   * the session itself and any skipped ones.
   */
  sessions: readonly PlanSession[]
  /** The working weekly running target of the session's week; null when the week is not stored. */
  weekTargetMin: number | null
  /** What the rest windows allow on each date they cover; none without windows. */
  dayRules: readonly DayRule[]
  /** The completed runs of the 30-day reference (`completedReference(...).runs`). */
  completedRuns: readonly RunRecord[]
  /** The recent-injury profile: 1.10x is then a hard limit [rule g-3]. */
  injuryTight: boolean
}

/** The columns an edit writes; a column not listed keeps its value. */
export type SessionPatch = Partial<
  Pick<
    PlanSession,
    | 'date'
    | 'kind'
    | 'title'
    | 'durationMin'
    | 'distanceM'
    | 'gainM'
    | 'structure'
    | 'target'
    | 'purpose'
    | 'rules'
    | 'flags'
    | 'status'
  >
>

export interface AdjustEdit {
  sessionId: string
  patch: SessionPatch
  /** The first plan is kept in `original` (every edit but a restore). */
  remember: boolean
}

export interface AdjustCheck {
  /** Guards that refuse the edit come first, then those that only warn. */
  guards: PlanGuardView[]
  /** False when a guard blocks. */
  allowed: boolean
  /** True when the edit is allowed and changes nothing (a skip of a skipped session). */
  noop: boolean
  /** The rows to change; empty when the edit is refused or changes nothing. */
  edits: AdjustEdit[]
  /** The week-level notes of the revision. */
  changes: PlanChange[]
  /** The revision's summary; empty when the edit is refused or changes nothing. */
  summary: string
}

// ---------------------------------------------------------------------------------------------
// Small pieces
// ---------------------------------------------------------------------------------------------

/** A session as the spacing rules see it: its prescription and its row. */
type Placed = SessionSpec & { id: string }

const day = (iso: string): Quantity => ({ kind: 'date', iso, style: 'weekday' })
const minutes = (min: number): Quantity => ({ kind: 'minutes', min })

function specOf(s: PlanSession): SessionSpec {
  return {
    date: s.date,
    order: s.order,
    kind: s.kind,
    title: s.title,
    durationMin: s.durationMin,
    distanceM: s.distanceM,
    gainM: s.gainM,
    structure: s.structure,
    target: s.target,
    purpose: s.purpose,
    rules: s.rules,
    flags: s.flags,
  }
}

function placed(s: PlanSession, over: Partial<SessionSpec> = {}): Placed {
  return { id: s.id, ...specOf(s), ...over }
}

function guard(
  code: AdjustGuardCode,
  template: Parameters<typeof adjustText>[0],
  slots: Record<string, Quantity | string>,
  rules: string[],
  options: { effect?: 'blocks' | 'warns'; suggest?: PlanSuggestion | null } = {},
): PlanGuardView {
  return {
    code,
    message: adjustText(template, slots),
    rules,
    effect: options.effect ?? 'blocks',
    suggest: options.suggest ?? null,
  }
}

const restoreSuggestion = (): PlanSuggestion => ({
  label: adjustText('adjust.suggest.restore'),
  adjustment: { type: 'restore' },
})

const refused = (guards: PlanGuardView[]): AdjustCheck => ({
  guards: sortGuards(guards),
  allowed: false,
  noop: false,
  edits: [],
  changes: [],
  summary: '',
})

const unchanged = (): AdjustCheck => ({
  guards: [],
  allowed: true,
  noop: true,
  edits: [],
  changes: [],
  summary: '',
})

/** Guards that refuse come first; the order within each group is the order they were found in. */
function sortGuards(guards: PlanGuardView[]): PlanGuardView[] {
  return [
    ...guards.filter((g) => g.effect === 'blocks'),
    ...guards.filter((g) => g.effect === 'warns'),
  ]
}

function allowedWith(
  guards: PlanGuardView[],
  edits: AdjustEdit[],
  changes: PlanChange[],
  summary: string,
): AdjustCheck {
  const sorted = sortGuards(guards)
  if (sorted.some((g) => g.effect === 'blocks')) return refused(guards)
  return { guards: sorted, allowed: true, noop: false, edits, changes, summary }
}

const isDone = (status: PlanSessionStatus): boolean =>
  status === 'completed' || status === 'partial'

/**
 * Why a session cannot be moved, swapped or shortened at all, or null when it can: it is the race,
 * in the past, linked to an activity, done or skipped. One reason, the first that holds.
 */
function staysAsItIs(session: PlanSession, today: string): PlanGuardView | null {
  if (session.kind === 'race') return guard('race-day', 'adjust.race-stays', {}, [])
  if (session.date < today) return guard('past-session', 'adjust.past', {}, [])
  if (session.activityId !== null) return guard('linked', 'adjust.linked', {}, [])
  if (isDone(session.status)) return guard('settled', 'adjust.settled', {}, [])
  if (session.status === 'skipped') {
    return guard('skipped', 'adjust.skipped', {}, [NEVER_MAKE_UP], {
      suggest: restoreSuggestion(),
    })
  }
  return null
}

/** A session that another session may swap with: in the week, still to run and not linked. */
function swappable(candidate: PlanSession, session: PlanSession, today: string): boolean {
  return (
    candidate.id !== session.id &&
    candidate.weekStart === session.weekStart &&
    candidate.date >= today &&
    candidate.activityId === null &&
    candidate.kind !== 'race' &&
    isToRun(candidate.status) &&
    !candidate.flags.includes('b2b-day1') &&
    !candidate.flags.includes('b2b-day2')
  )
}

const inPair = (s: Pick<PlanSession, 'flags'>): boolean =>
  s.flags.includes('b2b-day1') || s.flags.includes('b2b-day2')

// ---------------------------------------------------------------------------------------------
// The arrangement: availability, windows, spacing, spike, weekly target
// ---------------------------------------------------------------------------------------------

/** One session that an edit changes: where it stood (null when it was not on the plan) and where it would stand. */
interface Moved {
  then: Placed | null
  now: Placed
}

interface ArrangementOptions {
  /** Offer a swap when a day already has a run; off while checking a suggestion. */
  suggestSwap: boolean
  /** The session whose move is checked, for the swap suggestion. */
  mover?: PlanSession
  /** Check the week's running minutes against its target (a restore adds minutes). */
  weekCap?: boolean
}

function availabilityOn(ctx: AdjustContext, date: string) {
  return ctx.availability[WEEKDAYS[daysBetween(mondayOf(date), date)]!]
}

/** Two days of one back-to-back pair are one block, not two hard days in a row [rule H3]. */
function samePair(a: Placed, b: Placed): boolean {
  const [first, second] = a.date < b.date ? [a, b] : [b, a]
  return first.flags.includes('b2b-day1') && second.flags.includes('b2b-day2')
}

/** Dates of long runs that sit between more quality days than F3 allows. */
function longRunsBetween(set: readonly Placed[]): Set<string> {
  const hasQuality = (date: string) => set.some((s) => s.date === date && QUALITY_KINDS.has(s.kind))
  const dates = new Set<string>()
  for (const run of set) {
    if (run.kind !== 'long') continue
    const neighbours =
      Number(hasQuality(addDays(run.date, -1))) + Number(hasQuality(addDays(run.date, 1)))
    if (neighbours > P.f3.maxQualityNeighboursOfLongRun.value) dates.add(run.date)
  }
  return dates
}

function spikeGuards(
  moved: readonly Moved[],
  ctx: AdjustContext,
  others: readonly PlanSession[],
): PlanGuardView[] {
  const touched = new Set(moved.map((m) => m.now.id))
  // The runs a planned run is compared with: the completed ones and the planned runs before it,
  // as the plan stands and as the edit would leave it.
  const untouched = others
    .filter(
      (s) =>
        !touched.has(s.id) &&
        VOLUME_KINDS.has(s.kind) &&
        isToRun(s.status) &&
        s.date >= ctx.today &&
        !s.flags.includes('override-required'),
    )
    .map((s) => recordOf(specOf(s)))
  const completed: RunRecord[] = [...ctx.completedRuns]
  const recordsOf = (placements: Array<Placed | null>): RunRecord[] => [
    ...completed,
    ...untouched,
    ...placements.flatMap((p) => (p !== null && VOLUME_KINDS.has(p.kind) ? [recordOf(p)] : [])),
  ]
  const after = recordsOf(moved.map((m) => m.now))
  const before = recordsOf(moved.map((m) => m.then))
  const levelIn = (records: RunRecord[], spec: SessionSpec): 0 | 1 | 2 =>
    VOLUME_KINDS.has(spec.kind) ? spikeLevelOf(spec, referenceAt(records, spec.date)) : 0
  const guards: PlanGuardView[] = []
  for (const m of moved) {
    if (!VOLUME_KINDS.has(m.now.kind) || isProgramme(m.now)) continue
    const level = levelIn(after, m.now)
    // A run that was already this far over the reference is not blamed on this edit.
    const was = m.then === null ? 0 : levelIn(before, m.then)
    if (level === 0 || level <= was) continue
    const slots = {
      title: m.now.title,
      date: day(m.now.date),
      days: { kind: 'count', n: P.g1.windowDays.value } as const,
    }
    // G-1 reads completed runs: the planned runs before a session only stand in for runs not yet
    // done, so a session is refused only against a window that holds a run the runner did.
    const backed = referenceAt(completed, m.now.date).min > 0
    if (backed && (level === 2 || ctx.injuryTight)) {
      guards.push(
        guard(
          'spike',
          'adjust.spike-block',
          {
            ...slots,
            limit: {
              kind: 'share',
              fraction: level === 2 ? P.g1.spikeRatioOverride.value : P.g1.spikeRatioWarn.value,
            },
          },
          ctx.injuryTight ? ['g-1', 'g-3'] : ['g-1'],
        ),
      )
    } else {
      guards.push(
        guard(
          'spike',
          'adjust.spike-warn',
          { ...slots, limit: { kind: 'share', fraction: P.g1.spikeRatioWarn.value } },
          ['g-1'],
          { effect: 'warns' },
        ),
      )
    }
  }
  return guards
}

/**
 * The guards of a new arrangement. `moved` lists the sessions the edit places; `others` are the
 * rest of the plan around the week. Findings come in the order availability, windows, spacing,
 * long run, spike, weekly target; every touched session is checked.
 */
function arrangementGuards(
  moved: readonly Moved[],
  ctx: AdjustContext,
  options: ArrangementOptions,
  weekSession: PlanSession,
): PlanGuardView[] {
  const guards: PlanGuardView[] = []
  const touchedIds = new Set(moved.map((m) => m.now.id))
  const around = ctx.sessions.filter(
    (s) =>
      s.date >= addDays(weekSession.weekStart, -1) &&
      s.date <= addDays(weekSession.weekStart, 7) &&
      s.status !== 'skipped' &&
      !touchedIds.has(s.id),
  )
  const others: Placed[] = around.map((s) => placed(s))
  const touched = moved.map((m) => m.now)
  const all = [...others, ...touched]
  const runs = all.filter((s) => RUN_KINDS.has(s.kind))

  // Availability: the day is a run day and has room for the run.
  for (const s of touched) {
    if (!RUN_KINDS.has(s.kind)) continue
    const dayRule = availabilityOn(ctx, s.date)
    if (!dayRule.available) {
      guards.push(
        guard('closed-day', 'adjust.closed-day', { date: day(s.date), title: s.title }, []),
      )
    } else if (dayRule.maxMin !== null && s.kind !== 'race' && s.durationMin > dayRule.maxMin) {
      guards.push(
        guard(
          'day-limit',
          'adjust.day-limit',
          {
            title: s.title,
            minutes: minutes(s.durationMin),
            date: day(s.date),
            max: minutes(dayRule.maxMin),
          },
          [],
        ),
      )
    }
  }

  // Rest windows: a held day carries no run, hike or strength; a capped day no longer run; a quiet
  // day no quality session [rule J9].
  for (const s of touched) {
    if (!HELD_KINDS.has(s.kind) || s.kind === 'race') continue
    const rule = ctx.dayRules.find((r) => r.date === s.date)
    if (rule === undefined) continue
    if (rule.held) {
      guards.push(
        guard('rest-window', 'adjust.rest-window', { date: day(s.date), title: s.title }, ['J9']),
      )
    } else if (VOLUME_KINDS.has(s.kind)) {
      if (rule.maxRunMin !== null && s.durationMin > rule.maxRunMin + EPS) {
        const shorter = rule.maxRunMin >= minSize(s)
        guards.push(
          guard(
            'day-cap',
            'adjust.day-cap',
            {
              date: day(s.date),
              max: minutes(rule.maxRunMin),
              title: s.title,
              minutes: minutes(s.durationMin),
            },
            ['J9'],
            {
              suggest: shorter
                ? {
                    label: adjustText('adjust.suggest.shorten', {
                      minutes: minutes(rule.maxRunMin),
                    }),
                    adjustment: { type: 'shorten', durationMin: rule.maxRunMin },
                  }
                : null,
            },
          ),
        )
      } else if (!rule.quality && NO_QUALITY_KINDS.has(s.kind)) {
        guards.push(
          guard('quiet-day', 'adjust.quiet-day', { date: day(s.date), title: s.title }, ['J9']),
        )
      }
    }
  }

  // Spacing: one run a day, and an easy day between two hard sessions [rule F1].
  for (const s of touched) {
    if (!RUN_KINDS.has(s.kind)) continue
    const sameDay = runs.filter((o) => o !== s && o.date === s.date)
    if (sameDay.length > 0) {
      guards.push(
        guard('one-run-a-day', 'adjust.one-run', { date: day(s.date) }, ['F1'], {
          suggest: options.suggestSwap ? swapSuggestion(sameDay, ctx, options.mover) : null,
        }),
      )
    }
    if (HARD_KINDS.has(s.kind)) {
      const neighbour = runs.find(
        (o) =>
          o !== s &&
          HARD_KINDS.has(o.kind) &&
          Math.abs(daysBetween(o.date, s.date)) === 1 &&
          !samePair(s, o),
      )
      if (neighbour) {
        guards.push(
          guard('hard-spacing', 'adjust.hard-spacing', { title: s.title, other: neighbour.title }, [
            'F1',
          ]),
        )
      }
    }
  }

  // The long run is not between two quality days [rule F3]; a plan that already breaks it is not
  // blamed on this edit.
  const before = longRunsBetween([
    ...others,
    ...moved.flatMap((m) => (m.then === null ? [] : [m.then])),
  ])
  for (const date of longRunsBetween(all)) {
    if (!before.has(date)) {
      guards.push(guard('long-run-between', 'adjust.long-run-between', { date: day(date) }, ['F3']))
    }
  }

  guards.push(...spikeGuards(moved, ctx, ctx.sessions))

  if (options.weekCap === true && ctx.weekTargetMin !== null) {
    const inWeek = ctx.sessions.filter(
      (s) =>
        s.weekStart === weekSession.weekStart &&
        !touchedIds.has(s.id) &&
        s.status !== 'skipped' &&
        VOLUME_KINDS.has(s.kind),
    )
    const total =
      inWeek.reduce((sum, s) => sum + s.durationMin, 0) +
      touched.filter((s) => VOLUME_KINDS.has(s.kind)).reduce((sum, s) => sum + s.durationMin, 0)
    if (total > ctx.weekTargetMin + WEEK_ROUNDING_MIN) {
      guards.push(
        guard(
          'weekly-cap',
          'adjust.weekly-cap',
          {
            date: day(weekSession.weekStart),
            minutes: minutes(total),
            max: minutes(ctx.weekTargetMin),
          },
          ['G-2', 'G-6'],
        ),
      )
    }
  }
  return guards
}

/** The swap that would work where a move onto a day with a run does not, or null. */
function swapSuggestion(
  sameDay: readonly Placed[],
  ctx: AdjustContext,
  mover: PlanSession | undefined,
): PlanSuggestion | null {
  if (mover === undefined || sameDay.length !== 1) return null
  const other = ctx.sessions.find((s) => s.id === sameDay[0]!.id)
  if (other === undefined || !swappable(other, mover, ctx.today)) return null
  const adjustment: PlanAdjustment = { type: 'swap', withSessionId: other.id }
  // Offer it only when the swap itself passes every guard.
  if (!checkSwap(mover, other.id, ctx).allowed) return null
  return {
    label: adjustText('adjust.suggest.swap', {
      title: other.title,
      minutes: minutes(other.durationMin),
    }),
    adjustment,
  }
}

// ---------------------------------------------------------------------------------------------
// The six edits
// ---------------------------------------------------------------------------------------------

function checkSkip(session: PlanSession): AdjustCheck {
  if (session.kind === 'race') return refused([guard('race-day', 'adjust.race-skip', {}, [])])
  if (session.activityId !== null) return refused([guard('linked', 'adjust.linked', {}, [])])
  if (isDone(session.status)) return refused([guard('settled', 'adjust.settled', {}, [])])
  if (session.status === 'skipped') return unchanged()
  return allowedWith(
    [],
    [{ sessionId: session.id, patch: { status: 'skipped' }, remember: true }],
    [
      {
        weekStart: session.weekStart,
        field: 'session.status',
        from: session.status,
        to: 'skipped',
        rules: [NEVER_MAKE_UP],
      },
    ],
    skippedSummary(session.title, session.date),
  )
}

/**
 * The status a restored session takes: planned, unless it differs from its first plan, when the
 * status that kept the difference comes back (moved, shortened or eased), so a re-plan keeps it.
 */
function restoredStatus(session: PlanSession): PlanSessionStatus {
  const first = session.original
  if (first === null) return 'planned'
  if (first.date !== undefined && first.date !== session.date) return 'moved'
  if (first.kind !== undefined && first.kind !== session.kind) return 'moved'
  if (first.durationMin !== undefined && first.durationMin !== session.durationMin) {
    return session.rules.includes(TRIM_RULE) ? 'downgraded' : 'adjusted'
  }
  return 'planned'
}

function checkRestore(session: PlanSession, ctx: AdjustContext): AdjustCheck {
  if (session.status !== 'skipped') return unchanged()
  const status = restoredStatus(session)
  const now = placed(session)
  const guards = arrangementGuards(
    [{ then: null, now }],
    ctx,
    { suggestSwap: false, weekCap: true },
    session,
  )
  return allowedWith(
    guards,
    [{ sessionId: session.id, patch: { status }, remember: false }],
    [
      {
        weekStart: session.weekStart,
        field: 'session.status',
        from: 'skipped',
        to: status,
        rules: [NEVER_MAKE_UP],
      },
    ],
    restoredSummary(session.title, session.date),
  )
}

function checkMove(session: PlanSession, date: string, ctx: AdjustContext): AdjustCheck {
  const stays = staysAsItIs(session, ctx.today)
  if (stays) return refused([stays])
  if (date === session.date) return unchanged()
  if (inPair(session)) {
    return refused([guard('b2b-pair', 'adjust.b2b-stays', { title: session.title }, ['H3'])])
  }
  if (mondayOf(date) !== session.weekStart) {
    return refused([guard('other-week', 'adjust.other-week', {}, [])])
  }
  if (date < ctx.today) return refused([guard('past-date', 'adjust.past-date', {}, [])])
  const guards = arrangementGuards(
    [{ then: placed(session), now: placed(session, { date }) }],
    ctx,
    { suggestSwap: true, mover: session },
    session,
  )
  return allowedWith(
    guards,
    [{ sessionId: session.id, patch: { date, status: 'moved' }, remember: true }],
    [
      {
        weekStart: session.weekStart,
        field: 'session.date',
        from: session.date,
        to: date,
        rules: ['F1'],
      },
    ],
    movedSummary(session.title, session.date, date),
  )
}

/** The content a row takes from another one in a swap of kinds. */
function contentOf(s: PlanSession): SessionPatch {
  return {
    kind: s.kind,
    title: s.title,
    durationMin: s.durationMin,
    distanceM: s.distanceM,
    gainM: s.gainM,
    structure: s.structure,
    target: s.target,
    purpose: s.purpose,
    rules: s.rules,
    flags: s.flags,
  }
}

function checkSwap(session: PlanSession, withSessionId: string, ctx: AdjustContext): AdjustCheck {
  const stays = staysAsItIs(session, ctx.today)
  if (stays) return refused([stays])
  const partner = ctx.sessions.find((s) => s.id === withSessionId)
  if (partner === undefined || !swappable(partner, session, ctx.today)) {
    return refused([guard('partner-unavailable', 'adjust.partner-unavailable', {}, [])])
  }
  if (inPair(session)) {
    return refused([guard('b2b-pair', 'adjust.b2b-stays', { title: session.title }, ['H3'])])
  }
  if (partner.date === session.date) return unchanged()
  const guards = arrangementGuards(
    [
      { then: placed(session), now: placed(session, { date: partner.date }) },
      { then: placed(partner), now: placed(partner, { date: session.date }) },
    ],
    ctx,
    { suggestSwap: false },
    session,
  )
  return allowedWith(
    guards,
    [
      { sessionId: session.id, patch: { date: partner.date, status: 'moved' }, remember: true },
      { sessionId: partner.id, patch: { date: session.date, status: 'moved' }, remember: true },
    ],
    [
      {
        weekStart: session.weekStart,
        field: 'session.date',
        from: session.date,
        to: partner.date,
        rules: ['F1'],
      },
      {
        weekStart: partner.weekStart,
        field: 'session.date',
        from: partner.date,
        to: session.date,
        rules: ['F1'],
      },
    ],
    swappedSummary(session.title, session.date, partner.title, partner.date),
  )
}

function checkSwapKind(session: PlanSession, kind: SessionKind, ctx: AdjustContext): AdjustCheck {
  const stays = staysAsItIs(session, ctx.today)
  if (stays) return refused([stays])
  if (kind === session.kind) return unchanged()
  const partner = ctx.sessions
    .filter((s) => s.kind === kind && swappable(s, session, ctx.today))
    .sort((a, b) => (a.date === b.date ? a.order - b.order : a.date < b.date ? -1 : 1))[0]
  if (partner === undefined) {
    return refused([guard('no-partner', 'adjust.no-partner', { title: sessionTitle(kind) }, [])])
  }
  if (inPair(session)) {
    return refused([guard('b2b-pair', 'adjust.b2b-stays', { title: session.title }, ['H3'])])
  }
  const guards = arrangementGuards(
    [
      {
        then: placed(session),
        now: { ...placed(partner), id: session.id, date: session.date, order: session.order },
      },
      {
        then: placed(partner),
        now: { ...placed(session), id: partner.id, date: partner.date, order: partner.order },
      },
    ],
    ctx,
    { suggestSwap: false },
    session,
  )
  return allowedWith(
    guards,
    [
      { sessionId: session.id, patch: { ...contentOf(partner), status: 'moved' }, remember: true },
      { sessionId: partner.id, patch: { ...contentOf(session), status: 'moved' }, remember: true },
    ],
    [
      {
        weekStart: session.weekStart,
        field: 'session.kind',
        from: session.kind,
        to: kind,
        rules: ['F1'],
      },
    ],
    swappedSummary(session.title, session.date, partner.title, partner.date),
  )
}

/**
 * The shorter version of a session: every step, the distance and the climb scale with the minutes
 * and round down, as the guards' own cuts do. Null when the minutes are not under the session's, or
 * fall under the smallest run the guards leave (`minSize`). It never adds anything.
 */
export function shortenedSession(session: SessionSpec, durationMin: number): SessionSpec | null {
  if (!(durationMin < session.durationMin)) return null
  const scaled = scaleSession(session, durationMin / session.durationMin)
  if (scaled === null) return null
  // The scale rounds down; the minutes asked for are exact.
  return { ...scaled, durationMin }
}

function checkShorten(session: PlanSession, durationMin: number, ctx: AdjustContext): AdjustCheck {
  const stays = staysAsItIs(session, ctx.today)
  if (stays) return refused([stays])
  if (!VOLUME_KINDS.has(session.kind)) {
    return refused([guard('not-shortenable', 'adjust.not-shortenable', {}, [])])
  }
  if (durationMin === session.durationMin) return unchanged()
  if (durationMin > session.durationMin) {
    return refused([guard('not-shorter', 'adjust.not-shorter', {}, [NEVER_MAKE_UP])])
  }
  const spec = specOf(session)
  const smallest = minSize(spec)
  const shorter = durationMin < smallest ? null : shortenedSession(spec, durationMin)
  if (shorter === null) {
    return refused([
      guard('below-minimum', 'adjust.below-minimum', { min: minutes(smallest) }, ['F5'], {
        suggest: { label: adjustText('adjust.suggest.skip'), adjustment: { type: 'skip' } },
      }),
    ])
  }
  // Day 2 of a back-to-back pair is no longer than day 1 allows [rule H3].
  if (session.flags.includes('b2b-day1')) {
    const next = addDays(session.date, 1)
    const day2 = ctx.sessions.find(
      (s) => s.date === next && s.flags.includes('b2b-day2') && s.status !== 'skipped',
    )
    if (
      day2 !== undefined &&
      day2.durationMin > durationMin * P.h3.b2bDay2MaxRatioOfDay1.value + EPS
    ) {
      return refused([guard('b2b-pair', 'adjust.b2b-day2', {}, ['H3'])])
    }
  }
  const rules = session.rules.includes(NEVER_MAKE_UP)
    ? session.rules
    : [...session.rules, NEVER_MAKE_UP]
  return allowedWith(
    [],
    [
      {
        sessionId: session.id,
        patch: {
          durationMin: shorter.durationMin,
          distanceM: shorter.distanceM,
          gainM: shorter.gainM,
          structure: shorter.structure,
          rules,
          status: 'adjusted',
        },
        remember: true,
      },
    ],
    [
      {
        weekStart: session.weekStart,
        field: 'session.durationMin',
        from: session.durationMin,
        to: shorter.durationMin,
        rules: [NEVER_MAKE_UP],
      },
    ],
    shortenedSummary(session.title, session.date, session.durationMin, shorter.durationMin),
  )
}

/**
 * Decides one owner edit of one session from the stored plan and writes nothing. Returns the
 * guards it found, whether the edit is allowed, and the row changes, week notes and summary of an
 * edit that would be written. An edit that changes nothing is allowed, with `noop` set.
 */
export function adjustCheck(
  session: PlanSession,
  adjustment: PlanAdjustment,
  ctx: AdjustContext,
): AdjustCheck {
  switch (adjustment.type) {
    case 'skip':
      return checkSkip(session)
    case 'restore':
      return checkRestore(session, ctx)
    case 'move':
      return checkMove(session, adjustment.date, ctx)
    case 'swap':
      return checkSwap(session, adjustment.withSessionId, ctx)
    case 'swap-kind':
      return checkSwapKind(session, adjustment.kind, ctx)
    case 'shorten':
      return checkShorten(session, adjustment.durationMin, ctx)
  }
}
