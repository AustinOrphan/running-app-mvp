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
  REVISION_TEMPLATES,
  targetsSummary,
  targetSummary,
} from '../../../shared/copy/revision.ts'
import { TEMPLATES } from '../../../shared/copy/templates.ts'
import { buildPlan } from '../../../shared/engine/index.ts'
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

  it.each(KINDS.filter((k) => k !== 'ceiling' && k !== 'profile'))(
    'names a week that a rule draws: %s',
    (limit) => {
      const text = targetSummary(line({ limit, ramp: null }))
      expect(text).toMatch(/is lowered to 247 min, the plan's own figure (for|while|after) /)
    },
  )

  it.each(KINDS)('passes the G5 lint, fits one sentence and claims no safety: %s', (limit) => {
    for (const outcome of ['kept', 'clipped'] as const) {
      // large figures, so the longest rendering is the one checked
      const text = targetSummary(
        line({ limit, outcome, askedMin: 1234.5, keptMin: 1000.5, engineMin: 999.5 }),
      )
      expect(lintText(text), text).toEqual([])
      expect(text.length, text).toBeLessThanOrEqual(COPY_MAX_CHARS)
      expect(text, text).not.toMatch(/\b(safe|unsafe|protect|injur\w*|risk)\b/i)
      expect(text, text).not.toMatch(/\b(you|your|we)\b/i)
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
