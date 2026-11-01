// What an evidence grade means, in words. One map for every place that says it: the hover text of a
// badge (`GradeBadge`), the visible legend under the Fuel lab ladder and the legend of the Strength
// page. A touch screen shows no hover text, so a page that shows a badge says what the letters
// mean in a line of its own, from this map.
//
// Ids are `grade.<name>`; the set is spread into `TEMPLATES`, so the copy-lint test renders every
// template.
import type { Grade } from '../engine/types.ts'
import { render, tpl, type Template } from './template.ts'

export const GRADE_TEMPLATES = {
  'grade.meaning.a': tpl(
    'consistent meta-analyses or consensus statements',
    {},
    { shape: 'label' },
  ),
  'grade.meaning.b': tpl('randomised trials or large prospective cohorts', {}, { shape: 'label' }),
  'grade.meaning.c': tpl(
    'small trials, observational data, or a reasonable extrapolation',
    {},
    { shape: 'label' },
  ),
  'grade.meaning.d': tpl(
    'a convention or engineering default; no direct evidence',
    {},
    { shape: 'label' },
  ),
  // One grade of a legend: "Grade C: small trials, observational data, or a reasonable extrapolation."
  'grade.legend-item': tpl('Grade {grade}: {meaning}.', { grade: 'text', meaning: 'text' }),
} satisfies Record<string, Template>

const MEANINGS = {
  A: 'grade.meaning.a',
  B: 'grade.meaning.b',
  C: 'grade.meaning.c',
  D: 'grade.meaning.d',
} as const satisfies Record<Grade, keyof typeof GRADE_TEMPLATES>

const ORDER: readonly Grade[] = ['A', 'B', 'C', 'D']

/** What a grade means: "randomised trials or large prospective cohorts". */
export function gradeMeaning(grade: Grade): string {
  return render(GRADE_TEMPLATES[MEANINGS[grade]], {}, 'km')
}

/**
 * The legend for the grades a page shows, strongest first and each once, as one line of sentences:
 * "Grade C: small trials, observational data, or a reasonable extrapolation. Grade D: a convention
 * or engineering default; no direct evidence." Empty when there is no grade to explain.
 */
export function gradeLegend(shown: readonly Grade[]): string {
  return ORDER.filter((grade) => shown.includes(grade))
    .map((grade) =>
      render(GRADE_TEMPLATES['grade.legend-item'], { grade, meaning: gradeMeaning(grade) }, 'km'),
    )
    .join(' ')
}
