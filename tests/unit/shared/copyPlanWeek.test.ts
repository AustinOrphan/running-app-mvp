import { describe, expect, it } from 'vitest'
import { assertCleanCopy } from '../../../shared/copy/lint.ts'
import {
  PAGE_TEMPLATES,
  thisWeekLabel,
  weekRanOfText,
  weekRanText,
} from '../../../shared/copy/pageCopy.ts'
import { TEMPLATES } from '../../../shared/copy/templates.ts'

describe('the words of a row of the Plan page’s week table', () => {
  it('registers every template, so the shared lint test renders it', () => {
    for (const id of Object.keys(PAGE_TEMPLATES).filter((key) => key.startsWith('plan.week.'))) {
      expect(TEMPLATES[id as keyof typeof TEMPLATES], id).toBe(
        PAGE_TEMPLATES[id as keyof typeof PAGE_TEMPLATES],
      )
    }
  })

  it('marks the current week with two words', () => {
    expect(thisWeekLabel()).toBe('This week')
  })

  it('names the minutes run as hours with one decimal', () => {
    expect(weekRanText(150)).toBe('2.5 h run')
    expect(weekRanText(0)).toBe('0.0 h run')
  })

  it('names the minutes run so far and the week they are of, sharing the unit', () => {
    expect(weekRanOfText(150, 312)).toBe('2.5 of 5.2 h run')
    expect(weekRanOfText(0, 312)).toBe('0.0 of 5.2 h run')
  })

  it('never grades the week: no word of the G5 lint, whatever the figures', () => {
    for (const [ran, target] of [
      [0, 300],
      [150, 300],
      [300, 300],
      [450, 300],
    ] as const) {
      assertCleanCopy(weekRanOfText(ran, target), 'ran of target')
      assertCleanCopy(weekRanText(ran), 'ran')
    }
    assertCleanCopy(thisWeekLabel(), 'this week')
  })
})
