// Races the runner entered before the goal race [rules K6, H12, task SR1]. Pure: no I/O, no clock.
//
// A B or C race dated after today and before the goal race gets a race session on its day, an easing
// of the days before it (K6, sized by priority) and, for a class of marathon distance or longer, the
// recovery window of H12 after it. Nothing here adds load: a session is replaced by a shorter or
// easier one, or dropped, and the minutes cut are not made up, so each week holds no more running
// than the plan without the race [rules G-1, G6]. The race itself is not plan volume, as for the
// goal race (`VOLUME_KINDS`).
//
// A race inside the taper of the goal race stays as entered with no easing and no window beyond the
// taper's own. A race inside the recovery window of an earlier one stays; the earlier window ends
// at it. The plan never suggests a race: it only plans around the ones entered.
import { addDays, daysBetween, mondayOf } from '../dates.ts'
import {
  EASED_BEFORE_RACE_TITLE,
  enteredRacePurpose,
  raceInTaperWarning,
  racesCloseWarning,
  raceOnKeptDayWarning,
  CLIPPED_HOLD_PURPOSE,
} from '../copy/enteredRaces.ts'
import { runningMinutes, VOLUME_KINDS } from './limits.ts'
import { isDuplicate } from './load.ts'
import { holdSessions, intensityMinutes } from './micro.ts'
import { P } from './params/index.ts'
import { afterRaceTitle, lastWindowDay, tuneUpWindow, windowDay } from './postRace.ts'
import type { PostRaceWindow } from './postRace.ts'
import { prescribe } from './sessions.ts'
import { startKind } from './startWeeks.ts'
import type {
  EngineInput,
  EngineWarning,
  EnteredRace,
  SessionFlag,
  SessionSpec,
  WeekDraft,
  ZoneSet,
} from './types.ts'

const DAYS_PER_WEEK = 7

/** The kinds the easing and the window turn into easy running. */
const NOT_EASY: ReadonlySet<string> = new Set(
  [...VOLUME_KINDS].filter((kind) => kind !== 'easy' && kind !== 'recovery'),
)

export interface EnteredRacesArgs {
  input: EngineInput
  zones: ZoneSet
  /** The plan's weeks, current week to race week. */
  macro: readonly WeekDraft[]
  /** The sessions the plan placed, before the goal race's own session. Kept sessions are not here. */
  sessions: readonly SessionSpec[]
  /** The sessions kept from the plan being replaced, past ones included: they count in a week's shares. */
  fixed: readonly SessionSpec[]
  /** The dates that hold a session the runner or an earlier plan keeps; such a race day is left. */
  keptDates: ReadonlySet<string>
  /** The race session of an entered race, as the goal race's is built. */
  raceSession: (race: EnteredRace, week: WeekDraft) => SessionSpec
}

export interface EnteredRacesResult {
  sessions: SessionSpec[]
  /** The plan's weeks; a week the recovery window of an entered race mostly covers is a recovery week. */
  weeks: WeekDraft[]
  warnings: EngineWarning[]
}

/** The easing before an entered race, by priority [rule K6]. */
function easing(priority: 'B' | 'C'): { days: number; maxMin: number } {
  return priority === 'B'
    ? { days: P.k6.tuneUpBEasyDays.value, maxMin: P.k6.tuneUpBDayBeforeMaxMin.value }
    : { days: P.k6.tuneUpCEasyDays.value, maxMin: P.k6.tuneUpCDayBeforeMaxMin.value }
}

/** The entered races that are planned around: ahead, before the goal race, one per day. */
export function plannedRaces(input: EngineInput): EnteredRace[] {
  const sorted = [...(input.races ?? [])]
    .filter(
      (r) =>
        r.goal.goalId !== input.goal.goalId &&
        r.goal.date > input.today &&
        r.goal.date < input.goal.date,
    )
    .sort(
      (a, b) =>
        a.goal.date.localeCompare(b.goal.date) ||
        a.priority.localeCompare(b.priority) ||
        a.goal.goalId.localeCompare(b.goal.goalId),
    )
  return sorted.filter((r, i) => i === 0 || sorted[i - 1]!.goal.date !== r.goal.date)
}

/** The run `session` as an easy run of `minutes`, in the slot the session held. */
function easyRun(
  session: SessionSpec,
  minutes: number,
  zones: ZoneSet,
  week: WeekDraft,
  extra: { title: string; rule: string; flags?: SessionFlag[] },
): SessionSpec {
  const spec = prescribe('easy', minutes, zones, week)
  return {
    ...spec,
    date: session.date,
    order: session.order,
    title: extra.title,
    rules: [...spec.rules, extra.rule],
    flags: [...new Set([...spec.flags, ...(extra.flags ?? [])])],
  }
}

/**
 * Applies the entered races of `input` to the placed sessions: the race sessions, the easing before
 * them and the recovery after them. With no entered race ahead the sessions come back as they were.
 */
export function applyEnteredRaces(args: EnteredRacesArgs): EnteredRacesResult {
  const { input, zones, macro, keptDates } = args
  const races = plannedRaces(input)
  if (races.length === 0) return { sessions: [...args.sessions], weeks: [...macro], warnings: [] }

  const { today } = input
  const minRun = P.fplace.minRunDayMin.value
  const taperStart =
    macro.find((w) => w.isTaper || w.phase === 'race')?.weekStart ?? mondayOf(input.goal.date)
  const weekOf = (date: string) => macro.find((w) => w.weekStart === mondayOf(date))
  let out: SessionSpec[] = [...args.sessions]
  const raceDays = new Set<string>()
  const warnings: EngineWarning[] = []
  const spans: Array<{ window: PostRaceWindow; end: string }> = []
  const isEditable = (s: SessionSpec, from: string, to: string) =>
    s.date >= from &&
    s.date <= to &&
    s.date >= today &&
    !raceDays.has(s.date) &&
    s.kind !== 'race' &&
    // the sessions of a start path are fixed by its programme, never eased or cut here [rules E6]
    startKind(weekOf(s.date)?.flags ?? []) === null

  for (const [i, race] of races.entries()) {
    const date = race.goal.date
    const week = weekOf(date)
    if (week === undefined) continue
    if (keptDates.has(date)) {
      warnings.push({
        code: 'entered-race-on-kept-day',
        severity: 'info',
        message: raceOnKeptDayWarning(race.goal.name, date),
        rules: ['K6'],
      })
      continue
    }
    const inTaper = date >= taperStart
    const window = inTaper ? null : tuneUpWindow(input, race.goal)
    // The window ends the day before the next entered race, and before the goal race's taper.
    const next = races[i + 1]
    const windowEnd = [
      window === null ? date : lastWindowDay(window),
      ...(next === undefined ? [] : [addDays(next.goal.date, -1)]),
      addDays(taperStart, -1),
    ].reduce((a, b) => (a < b ? a : b))

    const clipped = window !== null && windowEnd < lastWindowDay(window)
    // the race day holds the race and nothing else the plan placed
    out = out.filter((s) => s.date !== date || s.kind === 'race')
    const base = args.raceSession(race, week)
    out.push({
      ...base,
      purpose: enteredRacePurpose({
        priority: race.priority,
        inTaper,
        recovery: window === null ? 'none' : clipped ? 'clipped' : 'full',
      }),
      rules: [...new Set([...base.rules, ...(window === null ? [] : ['H12'])])],
      flags: [...new Set<SessionFlag>([...base.flags, 'entered-race'])],
    })
    raceDays.add(date)

    if (inTaper) {
      warnings.push({
        code: 'entered-race-in-taper',
        severity: 'info',
        message: raceInTaperWarning(race.goal.name, date),
        rules: ['K6', 'K3'],
      })
      continue
    }

    // K6: the days before the race hold easy running only and the day before a shake-out
    const { days, maxMin } = easing(race.priority)
    const dayBefore = addDays(date, -1)
    out = out.flatMap((s) => {
      if (!isEditable(s, addDays(date, -Math.max(1, days)), dayBefore) || !VOLUME_KINDS.has(s.kind))
        return [s]
      const cut = s.date === dayBefore && s.durationMin > maxMin
      if (!cut && !NOT_EASY.has(s.kind)) return [s]
      const minutes = cut ? maxMin : s.durationMin
      if (minutes < minRun) return []
      return [
        easyRun(s, minutes, zones, weekOf(s.date) ?? week, {
          title: EASED_BEFORE_RACE_TITLE,
          rule: 'K6',
        }),
      ]
    })

    if (window === null) continue
    if (next !== undefined && next.goal.date <= lastWindowDay(window)) {
      warnings.push({
        code: 'entered-races-close',
        severity: 'info',
        message: racesCloseWarning({
          first: race.goal.name,
          firstDate: date,
          second: next.goal.name,
          secondDate: next.goal.date,
        }),
        rules: ['H12'],
      })
    }
    spans.push({ window, end: windowEnd })
    out = applyWindow(out, { window, windowEnd, week, isEditable })
  }

  function applyWindow(
    sessions: SessionSpec[],
    ctx: {
      window: PostRaceWindow
      windowEnd: string
      week: WeekDraft
      isEditable: (s: SessionSpec, from: string, to: string) => boolean
    },
  ): SessionSpec[] {
    const { window, windowEnd } = ctx
    const from = addDays(window.race.date, 1)
    // hold days: rest, with the hold's words, in place of anything the plan placed there
    const holds: SessionSpec[] = []
    for (const w of macro) {
      if (startKind(w.flags) !== null) continue
      for (const s of holdSessions(w, zones, [window], today)) {
        if (s.date > windowEnd || raceDays.has(s.date)) continue
        // a window that ends early promises no day it does not hold
        holds.push(windowEnd < lastWindowDay(window) ? { ...s, purpose: CLIPPED_HOLD_PURPOSE } : s)
      }
    }
    const holdDates = new Set(holds.map((s) => s.date))
    // no strength session in the window, as in the window of the goal race [rule H12]
    let rest = [
      ...sessions.filter(
        (s) =>
          !(holdDates.has(s.date) && !raceDays.has(s.date)) &&
          !(s.kind === 'strength' && ctx.isEditable(s, from, windowEnd)),
      ),
      ...holds,
    ]

    // the reference week of the steps: the most running a week held from three weeks before the race
    // week to the race week: what was run before today and what is placed or kept, as the plan had
    // it before this race [rule H12]
    const raceMonday = mondayOf(window.race.date)
    const reference = Math.max(
      0,
      ...[0, 1, 2, 3].map((back) => weekMinutes(addDays(raceMonday, -7 * back))),
    )
    for (const stage of window.stages) {
      const first = stage.from > from ? stage.from : from
      const last = stage.to < windowEnd ? stage.to : windowEnd
      if (first > last) continue
      const inStage = (s: SessionSpec) => ctx.isEditable(s, first, last) && VOLUME_KINDS.has(s.kind)
      // runs of the step: no quality (every kind above easy is easy now), each within the step's cap,
      // the longest within the long-run cap
      let runs = rest
        .filter(inStage)
        .sort((a, b) => a.date.localeCompare(b.date) || a.order - b.order)
        .map((s) => ({ s, minutes: s.durationMin }))
      const longest = runs.reduce((m, r) => Math.max(m, r.minutes), 0)
      let longGiven = false
      runs = runs.map((r) => {
        const isLong = !longGiven && r.minutes === longest
        if (isLong) longGiven = true
        return {
          ...r,
          minutes: Math.min(r.minutes, isLong ? stage.longRunMaxMin : stage.runMaxMin),
        }
      })
      // the first step holds a few runs, on days apart
      if (stage.maxRuns !== null) {
        let kept = 0
        let previous: string | null = null
        runs = runs.filter((r) => {
          const apart = previous === null || r.s.date > addDays(previous, 1)
          if (kept >= stage.maxRuns! || !apart) return false
          kept += 1
          previous = r.s.date
          return true
        })
      }
      // the step's minutes: its fraction of the reference week for the days it covers here
      const days = Math.min(DAYS_PER_WEEK, daysIn(first, last))
      const budget = Math.floor((stage.fraction * reference * days) / DAYS_PER_WEEK)
      let total = runs.reduce((sum, r) => sum + r.minutes, 0)
      while (total > budget && runs.length > 0) {
        let at = 0
        runs.forEach((r, k) => {
          if (r.minutes > runs[at]!.minutes) at = k
        })
        const run = runs[at]!
        const shortened = Math.max(0, run.minutes - (total - budget))
        total -= run.minutes
        if (shortened < minRun) runs.splice(at, 1)
        else {
          run.minutes = shortened
          total += shortened
        }
      }
      const kept = new Set(runs.map((r) => r.s))
      rest = rest.flatMap((s) => {
        if (!inStage(s)) return [s]
        const run = runs.find((r) => r.s === s)
        if (run === undefined || !kept.has(s)) return []
        return [
          easyRun(s, run.minutes, zones, weekOf(s.date) ?? ctx.week, {
            title: afterRaceTitle(run.minutes),
            rule: 'H12',
            flags: ['post-race'],
          }),
        ]
      })
    }
    return rest
  }

  // Quality stays in step with the volume the races removed, and a back-to-back pair is eased as a
  // unit: a pair that lost a day, or whose second day outgrew the first, becomes two easy runs
  // [rules F2, H3]. Only the weeks a race touched are read; the plan without the race met both.
  const touched = (week: WeekDraft) => {
    const end = addDays(week.weekStart, 6)
    const within = (s: SessionSpec) => s.date >= week.weekStart && s.date <= end
    const was = args.sessions.filter(within)
    const now = out.filter(within)
    return was.length !== now.length || was.some((s) => !now.includes(s))
  }
  const plain = (s: SessionSpec) =>
    easyRun(s, s.durationMin, zones, weekOf(s.date) ?? macro[0]!, { title: 'Easy run', rule: 'F2' })
  const easeIf = (test: (s: SessionSpec) => boolean) => {
    out = out.map((s) => (test(s) && s.kind !== 'race' ? plain(s) : s))
  }
  const pairBroken = (s: SessionSpec): boolean => {
    if (s.date < today) return false
    if (s.flags.includes('b2b-day1')) {
      const second = out.find((x) => x.date === addDays(s.date, 1) && x.flags.includes('b2b-day2'))
      return second === undefined || second.durationMin > s.durationMin
    }
    if (s.flags.includes('b2b-day2')) {
      const first = out.find((x) => x.date === addDays(s.date, -1) && x.flags.includes('b2b-day1'))
      return first === undefined || s.durationMin > first.durationMin
    }
    return false
  }
  const broken = new Set(out.filter(pairBroken))
  for (const s of [...broken]) {
    const partner = out.find(
      (x) =>
        x.date === addDays(s.date, s.flags.includes('b2b-day1') ? 1 : -1) &&
        (x.flags.includes('b2b-day1') || x.flags.includes('b2b-day2')),
    )
    if (partner !== undefined) broken.add(partner)
  }
  easeIf((s) => broken.has(s))
  // The share of the time above zone 1 is read as the check reads it: over every running session of
  // the week, the kept and the past ones included. A race that took easy volume out can push a week
  // over it: the hardest session the plan placed there is made easy first, and when none is left
  // the easy runs are lengthened, the day before a race last and within its shake-out, never past the minutes the week held without the races and never
  // past the longest run it held, so the week carries no more running than the plan without them.
  /** Running minutes of a week as it stood without the races: the runs before today, the sessions kept and the sessions placed. */
  function weekMinutes(weekStart: string): number {
    const end = addDays(weekStart, 6)
    const inWeek = (s: SessionSpec) => s.date >= weekStart && s.date <= end
    const placed = runningMinutes([...args.fixed.filter(inWeek), ...args.sessions.filter(inWeek)])
    const ran = input.activities
      .filter(
        (a) =>
          (a.type === 'run' || a.type === 'race') &&
          !isDuplicate(a) &&
          a.date >= weekStart &&
          a.date <= end &&
          a.date < today,
      )
      .reduce((sum, a) => sum + (a.movingSec ?? a.durationSec) / 60, 0)
    const ahead = runningMinutes(args.sessions.filter((s) => inWeek(s) && s.date >= today))
    const week = weekOf(weekStart)
    const minutes = Math.max(placed, ran + ahead)
    return week === undefined ? minutes : Math.min(minutes, week.targetRunMin)
  }
  const maxShare = P.f2.z2z3ShareMax.value
  /** The shake-out of an entered race: the most the day before it holds [K6], or null on any other day. */
  const shakeOutCap = (date: string): number | null => {
    const before = races.find((r) => addDays(r.goal.date, -1) === date)
    return before === undefined ? null : easing(before.priority).maxMin
  }
  const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const
  // an open day of the week with nothing placed, after today, not a race day and not a day the
  // runner closed (the day before a race takes its shake-out at most): the easy run of `minutes` it can hold
  const freeDay = (
    week: WeekDraft,
    inWeek: (s: SessionSpec) => boolean,
    minimum: number,
    room: number,
  ): { date: string; minutes: number } | null => {
    const used = new Set([...args.fixed, ...out].filter(inWeek).map((s) => s.date))
    for (let i = 0; i < 7; i++) {
      const date = addDays(week.weekStart, i)
      const open = input.profile.availability[WEEKDAYS[i]!]
      if (date < today || used.has(date) || raceDays.has(date) || !open.available) continue
      if (date >= input.goal.date) continue
      // the day before a race holds at most its shake-out
      const shake = shakeOutCap(date) ?? Infinity
      // the minutes wanted, or the largest run the room and the day's cap allow when they are fewer
      const minutes = Math.min(minimum, room, open.maxMin ?? Infinity, shake)
      if (minutes >= P.fplace.minRunDayMin.value) return { date, minutes }
    }
    return null
  }
  for (const week of macro) {
    if (!touched(week)) continue
    const end = addDays(week.weekStart, 6)
    const inWeek = (s: SessionSpec) => s.date >= week.weekStart && s.date <= end
    const counted = (s: SessionSpec) => VOLUME_KINDS.has(s.kind) && !s.flags.includes('rest-window')
    const fixedWeek = args.fixed.filter(inWeek).filter(counted)
    const held = runningMinutes(args.sessions.filter(inWeek)) + runningMinutes([...fixedWeek])
    // the longest run the week held, the kept ones included
    const longest = [...fixedWeek, ...args.sessions.filter(inWeek)].reduce(
      (m, s) => Math.max(m, s.durationMin),
      0,
    )
    // the most the runner's availability lets a run of the day hold
    const dayCap = (date: string): number =>
      input.profile.availability[WEEKDAYS[daysBetween(week.weekStart, date)]!].maxMin ?? Infinity
    for (;;) {
      const mine = out.filter(inWeek).filter(counted)
      const runs = [...fixedWeek, ...mine]
      const total = runs.reduce((sum, s) => sum + s.durationMin, 0)
      const hard = runs.reduce((sum, s) => sum + intensityMinutes(s), 0)
      if (total === 0 || (hard / total) * 100 <= maxShare) break
      const editableHard = mine.filter((s) => s.date >= today && intensityMinutes(s) > 0)
      if (editableHard.length > 0) {
        const worst = editableHard.reduce((a, b) =>
          intensityMinutes(b) > intensityMinutes(a) ? b : a,
        )
        easeIf((s) => s === worst)
        continue
      }
      // lengthen an easy run, by what is needed: one off the day before a race first, then a free
      // open day, then the shake-out up to its cap
      const needed = Math.ceil((hard * 100) / maxShare - total)
      const room = Math.min(needed, held - total)
      const longestFor = (s: SessionSpec) =>
        Math.min(longest, dayCap(s.date), shakeOutCap(s.date) ?? Infinity)
      const lengthenable = mine
        .filter(
          (s) =>
            s.date >= today &&
            (s.kind === 'easy' || s.kind === 'recovery') &&
            !s.flags.includes('post-race') &&
            s.durationMin < longestFor(s),
        )
        .sort((a, b) => a.durationMin - b.durationMin)
      const target = lengthenable.find((s) => shakeOutCap(s.date) === null)
      if (room <= 0) break
      if (target === undefined) {
        // no easy run to lengthen: an easy run on a free open day, of the minutes needed
        const day = freeDay(week, inWeek, Math.max(minRun, needed), held - total)
        if (day !== null) {
          const run = prescribe('easy', day.minutes, zones, week)
          out = [
            ...out,
            {
              ...run,
              date: day.date,
              order: 0,
              title: 'Easy run',
              rules: [...run.rules, 'F2'],
            },
          ]
          continue
        }
      }
      // the day before a race holds its shake-out: the last place for minutes, to its own cap [K6, F2]
      const grown = target ?? lengthenable[0]
      if (grown === undefined) break
      const minutes = Math.min(grown.durationMin + room, longestFor(grown))
      out = out.map((s) =>
        s === grown
          ? {
              ...easyRun(s, minutes, zones, weekOf(s.date) ?? macro[0]!, {
                title: s.title,
                rule: 'F2',
              }),
              flags: s.flags,
            }
          : s,
      )
    }
  }
  return { sessions: out, weeks: markWeeks(macro, args.sessions, out, spans), warnings }
}

function daysIn(from: string, to: string): number {
  let n = 0
  for (let d = from; d <= to; d = addDays(d, 1)) n += 1
  return n
}

/** Days of a week inside a window that make it a recovery week. */
const RECOVERY_WEEK_DAYS = 4

/** The flag a week an entered race cut carries: the running minutes the cut took out, for the ramp's baseline. */
export const RACE_CUT_FLAG = 'race-cut-'

/** The running minutes an entered race cut out of a week, from its flag; null for any other week. */
export function raceCutMinutes(flags: readonly string[]): number | null {
  for (const flag of flags) {
    if (!flag.startsWith(RACE_CUT_FLAG)) continue
    const n = Number(flag.slice(RACE_CUT_FLAG.length))
    if (Number.isInteger(n) && n >= 0) return n
  }
  return null
}

/**
 * The weeks an entered race changed. A week the race, its easing or its window cut carries
 * `race-cut-<minutes>`: the ramp counts it at the minutes it holds (run, kept and planned) plus the
 * minutes cut out, the minutes it held before, as the baseline of the
 * weeks after it, which are the weeks of the plan without the race, so they stay inside the limits
 * that plan met. A week keeps its recovery or loading role from the plan without the race [rules
 * E3, G-2, H12]. A week with most of its days (4 or more) inside the recovery window of an entered
 * race is flagged `race-recovery` (the cadence check does not hold it to a cut of its own). Every
 * week keeps the figure of K2 in its row, as with the K6 shake-out, so the taper is read from the
 * weeks of the plan without the race.
 */
function markWeeks(
  macro: readonly WeekDraft[],
  before: readonly SessionSpec[],
  after: readonly SessionSpec[],
  spans: ReadonlyArray<{ window: PostRaceWindow; end: string }>,
): WeekDraft[] {
  return macro.map((week) => {
    if (week.isTaper) return week
    const days = [0, 1, 2, 3, 4, 5, 6].map((i) => addDays(week.weekStart, i))
    const inWindow = days.filter((d) =>
      spans.some(
        ({ window, end }) => d > window.race.date && d <= end && windowDay(window, d) !== null,
      ),
    ).length
    const within = (sessions: readonly SessionSpec[]) =>
      sessions.filter((s) => s.date >= week.weekStart && s.date <= days[6]!)
    const was = within(before)
    const now = within(after)
    // what the races took out of the week: added to the minutes the week holds (done, kept and
    // placed), it is the minutes the week held without them
    const cutMin = Math.max(0, runningMinutes(was) - runningMinutes(now))
    const changed = was.length !== now.length || was.some((s) => !now.includes(s))
    const windowWeek = inWindow >= RECOVERY_WEEK_DAYS && startKind(week.flags) === null
    if (!windowWeek) {
      return changed
        ? { ...week, flags: [...week.flags, `${RACE_CUT_FLAG}${String(cutMin)}`] }
        : week
    }
    return {
      ...week,
      flags: [...new Set([...week.flags, `${RACE_CUT_FLAG}${String(cutMin)}`, 'race-recovery'])],
      focus: 'After the race: easy running',
    }
  })
}
