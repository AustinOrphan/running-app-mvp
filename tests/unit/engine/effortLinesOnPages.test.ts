// The effort sentence of an assessment on the three pages that print it (the activity page, the
// Session sheet and the Review page), read over what the real engine writes. The engine blends heart
// rate and pace into the verdict with the rating; a page shows the sentence only when the runner's
// own rating supports its way (`effortFact` in `shared/engine/standout.ts`), and these cases are the
// ones where the blend and the rating disagree.
import { describe, expect, it } from 'vitest'
import { renderFact } from '../../../shared/copy/templates.ts'
import { assessExecution, type ExecutionContext } from '../../../shared/engine/execution.ts'
import type {
  AthleteState,
  ExecutionAssessment,
  SessionSpec,
  ZoneSet,
} from '../../../shared/engine/types.ts'
import type { Activity } from '../../../shared/types.ts'
import { assessmentLines } from '../../../web/components/engineText.ts'
import { makeActivity } from '../../factories.ts'

const TODAY = '2026-06-30'

/** An easy session: expected RPE 2 to 3, the pace band 6:30 to 5:50 a kilometre. */
function easy(): SessionSpec {
  return {
    date: TODAY,
    order: 0,
    kind: 'easy',
    title: 'Easy run',
    durationMin: 60,
    distanceM: null,
    gainM: null,
    structure: [],
    target: { zone: 'z2', rpe: [2, 3], hr: [130, 145], paceSecPerKm: [390, 350], heatNote: null },
    purpose: 'Aerobic base',
    rules: [],
    flags: [],
  }
}

const ZONES = {
  hr: { z1: [110, 130], z2: [130, 145], z3: [145, 160] },
  pace: { z1: [420, 390], z2: [390, 350], z3: [350, 320] },
} as unknown as ZoneSet
const STATE = {
  longest30d: { distanceM: 0, durationSec: 0, gainM: 0, lossM: 0, twoDaySec: 0 },
} as AthleteState
const CTX: ExecutionContext = { zones: ZONES, state: STATE }

/** The assessment as the API serves it: the findings, and the sentences written from the facts. */
function served(activity: Activity, session = easy()): ExecutionAssessment {
  const record = assessExecution(session, activity, CTX)
  const { facts, ...findings } = record
  return { ...findings, lines: facts.map((fact) => renderFact(fact, 'km')) }
}

/** A run of the session's length whose pace is in the faster half of the band. */
const quick = (over: Partial<Activity> = {}): Activity =>
  makeActivity({ durationSec: 3600, distanceM: 10_400, ...over })

const effort = (lines: readonly string[]) => lines.filter((line) => line.startsWith('Effort '))

describe('the effort sentence, over the real engine', () => {
  it('writes a verdict that the pace tipped, beside a rating that does not say so', () => {
    // the premise: the engine does print "harder" for an RPE inside the band
    const inBand = served(quick({ rpe: 3 }))
    expect(inBand.effort.score).toBeGreaterThan(0)
    expect(effort(inBand.lines)).toEqual([
      'Effort felt harder than expected. RPE 3 against 2-3 expected for this kind.',
    ])
    const feelZero = served(quick({ feel: 0 }))
    expect(feelZero.effort.score).toBeGreaterThan(0)
    expect(effort(feelZero.lines)).toEqual(['Effort felt harder than expected.'])
  })

  it('drops it for an RPE inside the band, and for a feel of 0', () => {
    const band = easy().target.rpe
    expect(effort(assessmentLines(served(quick({ rpe: 3 })), band))).toEqual([])
    expect(effort(assessmentLines(served(quick({ feel: 0 })), band))).toEqual([])
  })

  it('drops it for a run with no rating at all', () => {
    const run = served(quick())
    expect(effort(run.lines).length).toBeGreaterThan(0)
    expect(effort(assessmentLines(run, easy().target.rpe))).toEqual([])
  })

  it('keeps it, quoting the RPE, when the RPE is above the band', () => {
    const run = served(quick({ rpe: 6 }))
    expect(effort(assessmentLines(run, easy().target.rpe))).toEqual(effort(run.lines))
    expect(effort(run.lines)[0]).toMatch(
      /^Effort felt (much )?harder than expected\. RPE 6 against/,
    )
  })

  it('keeps an easier verdict when the feel is below 0, and drops it when the feel is not', () => {
    // a slow run: the pace pulls the verdict to easier, and a feel of "easier" agrees
    const slow = (over: Partial<Activity>) =>
      makeActivity({ durationSec: 3600, distanceM: 8800, ...over })
    const agreeing = served(slow({ feel: -1 }))
    expect(agreeing.effort.score).toBeLessThan(0)
    expect(effort(agreeing.lines)).toHaveLength(1)
    expect(assessmentLines(agreeing, easy().target.rpe)).toEqual(agreeing.lines)
    // the same slow run felt "as expected": the pace alone tipped it
    const tipped = served(slow({ feel: 0 }))
    expect(effort(tipped.lines).length).toBeGreaterThan(0)
    expect(effort(assessmentLines(tipped, easy().target.rpe))).toEqual([])
  })

  it('leaves the other sentences alone, whatever it drops', () => {
    const run = served(quick({ rpe: 3 }))
    expect(
      assessmentLines(run, easy().target.rpe).filter((line) => !line.startsWith('Effort ')),
    ).toEqual(run.lines.filter((line) => !line.startsWith('Effort ')))
  })
})
