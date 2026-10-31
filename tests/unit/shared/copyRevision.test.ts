import { describe, expect, it } from 'vitest'
import { addDays } from '../../../shared/dates.ts'
import { COPY_MAX_CHARS } from '../../../shared/copy/limits.ts'
import { lintText } from '../../../shared/copy/lint.ts'
import {
  acceptedZoneSummary,
  checklistRefusedMessage,
  ADJUST_TEMPLATES,
  declinedZoneSummary,
  decisionSummary,
  describeUndoFinding,
  loadSettingSummary,
  overshootsSummary,
  overshootSummary,
  REVISION_TEMPLATES,
  targetsSummary,
  targetSummary,
} from '../../../shared/copy/revision.ts'
import { TEMPLATES } from '../../../shared/copy/templates.ts'
import { buildPlan } from '../../../shared/engine/index.ts'
import {
  positionStep,
  type LoadHold,
  type LoadPosition,
} from '../../../shared/engine/loadSetting.ts'
import type { ZoneBoundary } from '../../../shared/engine/zoneChange.ts'
import type { TargetDiffLine, TargetLimitKind } from '../../../shared/types.ts'
import { failedChecklist } from '../../../server/services/planEngine.ts'
import { windowOf } from '../engine/disruption-fixtures.ts'
import { athletes, TODAY } from '../engine/matrix-fixtures.ts'

const BOUNDARIES: ZoneBoundary[] = ['cs', 'lt1Pace', 'thresholdPace', 'lt1Hr', 'hrMax']

describe('revision summaries', () => {
  it('registers every revision template, so the shared lint test renders it', () => {
    for (const id of Object.keys(REVISION_TEMPLATES) as Array<keyof typeof REVISION_TEMPLATES>) {
      expect(TEMPLATES[id], id).toBe(REVISION_TEMPLATES[id])
      expect(id.startsWith('revision.'), id).toBe(true)
    }
  })

  it('registers every guard template of an owner edit, so the shared lint test renders it', () => {
    for (const id of Object.keys(ADJUST_TEMPLATES) as Array<keyof typeof ADJUST_TEMPLATES>) {
      expect(TEMPLATES[id], id).toBe(ADJUST_TEMPLATES[id])
      expect(id.startsWith('adjust.'), id).toBe(true)
    }
  })

  it('stores no slot that reads differently in kilometres and miles', () => {
    const unitBound = ['pace', 'speed', 'distance', 'climb']
    // the guards are written on the server, once, so they too hold no unit-bound figure
    for (const [id, template] of Object.entries({ ...REVISION_TEMPLATES, ...ADJUST_TEMPLATES })) {
      for (const [slot, kind] of Object.entries(template.slots)) {
        expect(unitBound, `${id} slot ${slot}`).not.toContain(kind)
      }
    }
  })

  it('states the minutes of the weekly decision, and leaves out a zero', () => {
    expect(decisionSummary('hold', 270)).toBe(
      "Last week's decision: hold, next week up to 270 min.",
    )
    expect(decisionSummary('reduce', 0)).toBe("Last week's decision: reduce.")
    expect(decisionSummary('progress', 0.4)).toBe("Last week's decision: progress.")
  })

  it('writes a zone decision with a plain label of the boundary and a date', () => {
    expect(acceptedZoneSummary('thresholdPace', '2026-10-23')).toBe(
      'Accepted the proposed threshold pace on Fri 23 Oct.',
    )
    expect(declinedZoneSummary('hrMax', '2026-10-23')).toBe(
      'Declined the proposed maximum heart rate on Fri 23 Oct.',
    )
  })

  it('words every boundary in plain words, with no key and no figure but the date', () => {
    for (const boundary of BOUNDARIES) {
      for (const summary of [
        acceptedZoneSummary(boundary, '2026-10-23'),
        declinedZoneSummary(boundary, '2026-10-23'),
      ]) {
        expect(lintText(summary), summary).toEqual([])
        expect(summary, summary).not.toMatch(/[a-z][A-Z]/)
        expect(summary.replace('23 Oct', ''), summary).not.toMatch(/\d/)
      }
    }
  })
})

describe('the summary of a change of the load setting', () => {
  const position = (over: Partial<LoadPosition> = {}): LoadPosition => ({
    requested: 'standard',
    position: 'standard',
    held: null,
    ageCapped: false,
    ...over,
  })

  it('states the position and its step, and says "while rebuilding" where there is a zone', () => {
    expect(loadSettingSummary(position({ requested: 'standard', position: 'standard' }))).toBe(
      'Load setting changed to Standard: weeks ahead add up to 12% while rebuilding.',
    )
    expect(loadSettingSummary(position({ requested: 'upper', position: 'upper' }))).toBe(
      'Load setting changed to Upper band: weeks ahead add up to 14% while rebuilding.',
    )
  })

  it('words Steady as a plain weekly step, without "while rebuilding"', () => {
    const summary = loadSettingSummary(position({ requested: 'steady', position: 'steady' }))
    expect(summary).toBe('Load setting changed to Steady: weeks ahead add up to 10% a week.')
    expect(summary).not.toMatch(/rebuilding/)
  })

  it('reads each step from the Params, not from the words', () => {
    for (const choice of ['steady', 'standard', 'upper'] as const) {
      const pct = Math.round(positionStep(choice) * 1000) / 10
      expect(
        loadSettingSummary(position({ requested: choice, position: choice })),
        choice,
      ).toContain(`add up to ${String(pct)}%`)
    }
  })

  it('says a held position was chosen and that the steady step applies, with the reason and no step', () => {
    const holds: Array<[LoadHold, string]> = [
      ['recent-injury', 'a recent injury is on file'],
      ['bone-stress', 'an earlier bone stress injury is on file'],
      ['bsi-factors', 'at least two risk factors for bone stress injury apply'],
      ['reds-hold', 'flags from the energy availability screening hold progression'],
      ['bone-pain', 'focal bone pain holds progression'],
      ['rest-window', 'a rest window is active'],
      ['post-race', 'the plan is in the weeks after a race'],
    ]
    for (const [held, reason] of holds) {
      const summary = loadSettingSummary(position({ requested: 'upper', position: 'steady', held }))
      expect(summary, held).toBe(
        `Load setting changed to Upper band. The steady step applies for now: ${reason}.`,
      )
      expect(summary, held).not.toMatch(/\d+%/)
    }
  })

  it('names the age rule when Upper band is read as Standard, with the step of Standard', () => {
    expect(
      loadSettingSummary(position({ requested: 'upper', position: 'standard', ageCapped: true })),
    ).toBe(
      'Load setting changed to Upper band: weeks ahead add up to 12% while rebuilding. The setting is held at Standard: age 45 or over.',
    )
  })

  it('is lint-clean, and its sentences stay within a template length', () => {
    const all: string[] = []
    for (const requested of ['steady', 'standard', 'upper'] as const) {
      all.push(loadSettingSummary(position({ requested, position: requested })))
      all.push(loadSettingSummary(position({ requested, position: 'steady', held: 'rest-window' })))
    }
    all.push(
      loadSettingSummary(position({ requested: 'upper', position: 'standard', ageCapped: true })),
    )
    for (const summary of all) {
      expect(lintText(summary), summary).toEqual([])
      for (const sentence of summary.split(/(?<=\.) /)) {
        expect(sentence.length, sentence).toBeLessThanOrEqual(COPY_MAX_CHARS)
      }
    }
  })

  it('stores no unit-bound figure: the percentages read the same in kilometres and miles', () => {
    for (const id of [
      'revision.load.rebuilding',
      'revision.load.steady',
      'revision.load.changed',
    ] as const) {
      expect(Object.values(REVISION_TEMPLATES[id].slots), id).not.toContain('distance')
      expect(TEMPLATES[id], id).toBe(REVISION_TEMPLATES[id])
    }
  })
})

describe('plan-check refusals', () => {
  // Every check the engine runs, the rest-window check included.
  const ids = buildPlan({
    ...athletes()[0]!.input,
    disruptions: [
      windowOf({
        reason: 'illness-above-neck',
        startDate: addDays(TODAY, 2),
        endDate: addDays(TODAY, 4),
      }),
    ],
  }).checklist.map((item) => item.id)

  it('reads every check of the checklist', () => {
    expect(ids.length).toBeGreaterThan(10)
    expect(ids).toContain('disruption-window')
  })

  it('refuses an undo in plain words and keeps the check id in items', () => {
    for (const id of ids) {
      const reason = describeUndoFinding({ code: 'checklist', items: [id] }, 14)
      expect(reason.message, id).toBe(
        'The earlier plan no longer meets the plan checks, so it cannot be restored.',
      )
      expect(lintText(reason.message), id).toEqual([])
      expect(reason.items, id).toEqual([id])
    }
  })

  it('refuses a new plan in plain words and keeps the checks in details', () => {
    for (const id of ids) {
      const checklist = [{ id, ok: false, detail: 'Synthetic.', rules: ['g-1'] }]
      const error = failedChecklist(checklist)!
      expect(error.status, id).toBe(422)
      expect(error.message, id).toBe(checklistRefusedMessage())
      expect(error.message, id).toBe(
        'The plan did not pass the plan checks, so it was not published.',
      )
      expect(lintText(error.message), id).toEqual([])
      expect(error.details, id).toEqual({ checklist })
    }
    expect(failedChecklist([{ id: ids[0]!, ok: true, detail: 'Synthetic.', rules: [] }])).toBeNull()
  })
})

describe('the sentences of a week target raised by hand', () => {
  const line = (over: Partial<TargetDiffLine> = {}): TargetDiffLine => ({
    weekStart: '2026-10-26',
    outcome: 'clipped',
    askedMin: 400,
    keptMin: 247,
    engineMin: 209,
    limit: 'ceiling',
    ramp: 0.3,
    ...over,
  })
  const KINDS: TargetLimitKind[] = [
    'ceiling',
    'profile',
    'hold',
    'decision',
    'post-race',
    'window',
    'programme',
    'structure',
  ]

  it('says a kept target stays and what the plan’s own figure would be', () => {
    expect(targetSummary(line({ outcome: 'kept', askedMin: 230, keptMin: 230 }))).toBe(
      "Week of Mon 26 Oct: the target set by hand, 230 min, stays; the plan's own figure would be 209 min.",
    )
  })

  it('names the 2-week ceiling with its share, from the stored line', () => {
    expect(targetSummary(line())).toBe(
      'Week of Mon 26 Oct: the target set by hand, 400 min, is lowered to 247 min, the most the limits allow that week (growth over two weeks stays within 30%).',
    )
    // the share is the line's own, and the ceiling's Param when a line carries none
    expect(targetSummary(line({ ramp: 0.25 }))).toContain('stays within 25%')
    expect(targetSummary(line({ ramp: null }))).toContain('stays within 30%')
  })

  it('names the tightened step of a profile with its share', () => {
    expect(targetSummary(line({ limit: 'profile', ramp: 0.05 }))).toBe(
      'Week of Mon 26 Oct: the target set by hand, 400 min, is lowered to 247 min, the most the tightened weekly step allows that week (5% a week).',
    )
  })

  it('names the plan’s own figure when it is what the ceiling or the profile leaves, not the most the limits allow', () => {
    expect(targetSummary(line({ bound: 'plan', keptMin: 209 }))).toBe(
      "Week of Mon 26 Oct: the target set by hand, 400 min, is lowered to 209 min, the plan's own figure that week, which the limits do not go under.",
    )
    expect(targetSummary(line({ limit: 'profile', ramp: 0.05, bound: 'plan', keptMin: 209 }))).toBe(
      "Week of Mon 26 Oct: the target set by hand, 400 min, is lowered to 209 min, the plan's own figure that week, which the tightened step does not go under.",
    )
  })

  it('names the minutes already run when they are what the ceiling or the profile leaves', () => {
    expect(targetSummary(line({ bound: 'logged', keptMin: 262 }))).toBe(
      'Week of Mon 26 Oct: the target set by hand, 400 min, is lowered to 262 min, the minutes already run that week, which the limits do not go under.',
    )
    expect(
      targetSummary(line({ limit: 'profile', ramp: 0.05, bound: 'logged', keptMin: 262 })),
    ).toBe(
      'Week of Mon 26 Oct: the target set by hand, 400 min, is lowered to 262 min, the minutes already run that week, which the tightened step does not go under.',
    )
  })

  it('reads a line stored without a bound, and a bound of the limit, as the most the limits allow', () => {
    const stored = targetSummary(line())
    expect(stored).toContain('the most the limits allow that week')
    expect(targetSummary(line({ bound: 'limit' }))).toBe(stored)
    expect(targetSummary(line({ limit: 'profile', ramp: 0.05, bound: 'limit' }))).toContain(
      'the most the tightened weekly step allows that week',
    )
  })

  it('ignores the bound where a rule draws the week, which names the plan’s own figure', () => {
    for (const bound of ['limit', 'plan', 'logged'] as const) {
      expect(targetSummary(line({ limit: 'hold', ramp: null, bound }))).toMatch(
        /the plan's own figure while progression is on hold\.$/,
      )
    }
  })

  it.each(KINDS.filter((k) => k !== 'ceiling' && k !== 'profile'))(
    'names a week that a rule draws: %s',
    (limit) => {
      const text = targetSummary(line({ limit, ramp: null }))
      expect(text).toMatch(/is lowered to 247 min, the plan's own figure (for|while|after) /)
    },
  )

  it.each(KINDS)('passes the G5 lint, fits one sentence and claims no safety: %s', (limit) => {
    for (const outcome of ['kept', 'clipped'] as const) {
      for (const bound of ['limit', 'plan', 'logged'] as const) {
        // large figures, so the longest rendering is the one checked
        const text = targetSummary(
          line({ limit, outcome, bound, askedMin: 1234.5, keptMin: 1000.5, engineMin: 999.5 }),
        )
        expect(lintText(text), text).toEqual([])
        expect(text.length, text).toBeLessThanOrEqual(COPY_MAX_CHARS)
        expect(text, text).not.toMatch(/\b(safe|unsafe|protect|injur\w*|risk)\b/i)
        expect(text, text).not.toMatch(/\b(you|your|we)\b/i)
      }
    }
  })

  it('lists the weeks in order, one sentence each', () => {
    const text = targetsSummary([
      line({ weekStart: '2026-11-09', outcome: 'kept', keptMin: 400 }),
      line({ weekStart: '2026-10-26' }),
    ])
    expect(text.indexOf('Mon 26 Oct')).toBeGreaterThanOrEqual(0)
    expect(text.indexOf('Mon 26 Oct')).toBeLessThan(text.indexOf('Mon 9 Nov'))
    expect(targetsSummary([])).toBe('')
  })
})

describe('the sentence for a week the re-plan took as run', () => {
  const line = { weekStart: '2026-10-26', ranMin: 144, plannedMin: 79 }

  it('says the week was run past its plan, with the minutes run against the plan', () => {
    expect(overshootSummary(line)).toBe(
      'Week of Mon 26 Oct was run past its plan: 144 min against 79 min; the weeks after it are drawn from the plan.',
    )
  })

  it('is a registered template, clean and within the length limit', () => {
    expect(TEMPLATES['revision.overshoot']).toBe(REVISION_TEMPLATES['revision.overshoot'])
    const text = overshootSummary(line)
    expect(lintText(text)).toEqual([])
    expect(text.length).toBeLessThanOrEqual(COPY_MAX_CHARS)
    expect(text).not.toMatch(/\b(you|your|we)\b/i)
  })

  it('lists the weeks in order, one sentence each, and nothing for none', () => {
    const text = overshootsSummary([
      { weekStart: '2026-11-02', ranMin: 200, plannedMin: 150 },
      line,
    ])
    expect(text.indexOf('Mon 26 Oct')).toBeGreaterThanOrEqual(0)
    expect(text.indexOf('Mon 26 Oct')).toBeLessThan(text.indexOf('Mon 2 Nov'))
    expect(overshootsSummary([])).toBe('')
  })
})
