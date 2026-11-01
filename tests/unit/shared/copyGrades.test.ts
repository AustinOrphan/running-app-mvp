import { describe, expect, it } from 'vitest'
import { COPY_MAX_CHARS } from '../../../shared/copy/limits.ts'
import { assertCleanCopy } from '../../../shared/copy/lint.ts'
import { GRADE_TEMPLATES, gradeLegend, gradeMeaning } from '../../../shared/copy/grades.ts'
import { TEMPLATES } from '../../../shared/copy/templates.ts'

describe('what an evidence grade means', () => {
  it('registers every template, so the shared lint test renders it', () => {
    for (const id of Object.keys(GRADE_TEMPLATES) as Array<keyof typeof GRADE_TEMPLATES>) {
      expect(TEMPLATES[id], id).toBe(GRADE_TEMPLATES[id])
      expect(id.startsWith('grade.'), id).toBe(true)
    }
  })

  it('has one meaning for each of the four grades, the words the badges have always carried', () => {
    expect(gradeMeaning('A')).toBe('consistent meta-analyses or consensus statements')
    expect(gradeMeaning('B')).toBe('randomised trials or large prospective cohorts')
    expect(gradeMeaning('C')).toBe(
      'small trials, observational data, or a reasonable extrapolation',
    )
    expect(gradeMeaning('D')).toBe('a convention or engineering default; no direct evidence')
  })

  it('writes the legend of the grades a page shows: strongest first, each once, as sentences', () => {
    expect(gradeLegend(['D', 'C', 'D', 'C'])).toBe(
      'Grade C: small trials, observational data, or a reasonable extrapolation. ' +
        'Grade D: a convention or engineering default; no direct evidence.',
    )
    expect(gradeLegend(['B'])).toBe('Grade B: randomised trials or large prospective cohorts.')
    expect(gradeLegend([])).toBe('')
  })

  it('stays clean under the G5 lint and short enough to read, for every grade together', () => {
    const all = gradeLegend(['A', 'B', 'C', 'D'])
    assertCleanCopy(all, 'the legend')
    // A sentence of the legend is a template and holds the limit of one; the four read as a line.
    for (const grade of ['A', 'B', 'C', 'D'] as const) {
      const one = gradeLegend([grade])
      assertCleanCopy(one, `the legend of ${grade}`)
      expect(one.length, grade).toBeLessThanOrEqual(COPY_MAX_CHARS)
      expect(one.endsWith('.'), grade).toBe(true)
    }
  })
})
