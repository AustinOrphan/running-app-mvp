import { describe, expect, it } from 'vitest'
import { addDays } from '../../../shared/dates.ts'
import { lintText } from '../../../shared/copy/lint.ts'
import {
  acceptedZoneSummary,
  checklistRefusedMessage,
  declinedZoneSummary,
  describeUndoFinding,
  REVISION_TEMPLATES,
} from '../../../shared/copy/revision.ts'
import { TEMPLATES } from '../../../shared/copy/templates.ts'
import { buildPlan } from '../../../shared/engine/index.ts'
import type { ZoneBoundary } from '../../../shared/engine/zoneChange.ts'
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

  it('stores no slot that reads differently in kilometres and miles', () => {
    const unitBound = ['pace', 'speed', 'distance', 'climb']
    for (const [id, template] of Object.entries(REVISION_TEMPLATES)) {
      for (const [slot, kind] of Object.entries(template.slots)) {
        expect(unitBound, `${id} slot ${slot}`).not.toContain(kind)
      }
    }
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
