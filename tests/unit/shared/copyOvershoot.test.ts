import { describe, expect, it } from 'vitest'
import { COPY_MAX_CHARS } from '../../../shared/copy/limits.ts'
import { assertCleanCopy } from '../../../shared/copy/lint.ts'
import {
  OVERSHOOT_TEMPLATES,
  overshootMin,
  overshootNote,
  overshootTodayLine,
  plannedBaselineLine,
} from '../../../shared/copy/overshoot.ts'
import { TEMPLATES } from '../../../shared/copy/templates.ts'

describe('the words for a week run past its plan', () => {
  it('registers every template, so the shared lint test renders it in both unit systems', () => {
    for (const id of Object.keys(OVERSHOOT_TEMPLATES) as Array<keyof typeof OVERSHOOT_TEMPLATES>) {
      expect(TEMPLATES[id], id).toBe(OVERSHOOT_TEMPLATES[id])
      expect(id.startsWith('overshoot.'), id).toBe(true)
    }
  })

  it('works the minutes over the plan out, in whole minutes', () => {
    expect(overshootMin(144, 79)).toBe(65)
    expect(overshootMin(144.4, 79)).toBe(65)
  })

  it('says nothing when the minutes run do not lie over the plan', () => {
    expect(overshootMin(79, 79)).toBeNull()
    expect(overshootMin(60, 79)).toBeNull()
    expect(overshootNote(79, 79)).toBeNull()
    expect(overshootNote(60, 79)).toBeNull()
    expect(overshootTodayLine(60, 79)).toBeNull()
  })

  it('notes how far the minutes run lie over the plan, beside the run figure', () => {
    expect(overshootNote(144, 79)).toBe('1.1 h over the plan')
  })

  it('words Today’s caption with the minutes run, the plan and the difference', () => {
    expect(overshootTodayLine(144, 79)).toBe('Ran 2.4 h of 1.3 h planned, 1.1 h over')
  })

  it('words the planned baseline of the week editor', () => {
    expect(plannedBaselineLine(79)).toBe('Planned before the week was run: 1.3 h (79 min)')
  })

  it('stays clean, short and free of second-person grading', () => {
    const lines = [overshootNote(144, 79)!, overshootTodayLine(144, 79)!, plannedBaselineLine(79)]
    for (const line of lines) {
      assertCleanCopy(line, 'overshoot copy')
      expect(line.length).toBeLessThanOrEqual(COPY_MAX_CHARS)
      expect(line).not.toMatch(/\b(you|your|we)\b/i)
    }
  })
})
