import { describe, expect, it } from 'vitest'
import { lintText } from '../../../shared/copy/lint.ts'
import {
  acceptedZoneSummary,
  declinedZoneSummary,
  REVISION_TEMPLATES,
} from '../../../shared/copy/revision.ts'
import { TEMPLATES } from '../../../shared/copy/templates.ts'
import type { ZoneBoundary } from '../../../shared/engine/zoneChange.ts'

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
