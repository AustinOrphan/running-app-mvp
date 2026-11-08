// What the weekly review says about the answers it fills in from the week's check-ins. The cut-offs
// are in `shared/domain/review.ts` (`PREFILL`); the words are here, so the lint test renders every
// one. The runner confirms or changes each answer; the copy says what the answer rests on and never
// that the week went well or badly.
import { PREFILL, type ReviewPrefill } from '../domain/review.ts'
import { numberWord, plural } from './quantity.ts'
import { render, tpl } from './template.ts'

export const REVIEW_PREFILL_TEMPLATES = {
  'review.prefill.heading': tpl("From this week's check-ins", {}, { shape: 'label' }),
  'review.prefill.basis': tpl(
    'Taken from {days} of check-ins. Confirm each answer or change it below.',
    {
      days: 'text',
    },
  ),
  'review.prefill.fatigue': tpl(
    'Fatigue {value} of 10, from an average of {average} of 5 over {days}.',
    { value: 'text', average: 'text', days: 'text' },
  ),
  'review.prefill.fatigue-few': tpl(
    'Fatigue: too few answers this week to suggest a number. Enter it below.',
  ),
  'review.prefill.symptoms-none': tpl(
    'Symptoms: none. The check-ins show no pain, illness or marked soreness.',
  ),
  'review.prefill.symptoms-soreness': tpl(
    'Symptoms: mild. Soreness of {level} or more on at least one day.',
    { level: 'text' },
  ),
  'review.prefill.symptoms-pain': tpl(
    'Symptoms: mild. A pain score above zero on at least one day.',
  ),
  'review.prefill.symptoms-illness': tpl('Symptoms: mild. Illness was ticked on at least one day.'),
  'review.prefill.symptoms-persistent-pain': tpl(
    'Symptoms: persistent. A pain score of {level} or more on {days} or more days.',
    { level: 'text', days: 'text' },
  ),
  'review.prefill.symptoms-persistent-illness': tpl(
    'Symptoms: persistent. Illness or pain of {level} or more on {days} or more days.',
    { level: 'text', days: 'text' },
  ),
  'review.prefill.symptoms-bone': tpl(
    'Symptoms: persistent. Bone tenderness was ticked on at least one day.',
  ),
  'review.prefill.symptoms-few': tpl(
    'Symptoms: too few check-in days to suggest an answer. Enter it below.',
  ),
  'review.prefill.accept': tpl('Looks right', {}, { shape: 'label' }),
  'review.prefill.accepted': tpl('Filled in', {}, { shape: 'label' }),
  'review.prefill.accepted-status': tpl(
    'Fatigue and symptoms are filled in from the check-ins. Save the review to keep them.',
  ),
} as const

export type ReviewPrefillTemplateId = keyof typeof REVIEW_PREFILL_TEMPLATES

/** The lines the review card shows for a prefill, in the order they are read. */
export interface PrefillLines {
  basis: string
  fatigue: string
  symptoms: string
}

/** The sentences behind a prefill; the numbers come from the prefill and the `PREFILL` cut-offs. */
export function prefillLines(prefill: ReviewPrefill): PrefillLines {
  const units = 'km' as const
  const basis = render(
    REVIEW_PREFILL_TEMPLATES['review.prefill.basis'],
    { days: plural(prefill.checkinDays, 'day') },
    units,
  )
  const fatigue =
    prefill.fatigue === null || prefill.fatigueAverage === null
      ? render(REVIEW_PREFILL_TEMPLATES['review.prefill.fatigue-few'], {}, units)
      : render(
          REVIEW_PREFILL_TEMPLATES['review.prefill.fatigue'],
          {
            value: String(prefill.fatigue),
            average: String(prefill.fatigueAverage),
            days: plural(prefill.fatigueDays, 'day'),
          },
          units,
        )
  return { basis, fatigue, symptoms: symptomsLine(prefill) }
}

function symptomsLine(prefill: ReviewPrefill): string {
  const units = 'km' as const
  const t = REVIEW_PREFILL_TEMPLATES
  switch (prefill.symptomsBasis) {
    case 'none':
      return render(t['review.prefill.symptoms-none'], {}, units)
    case 'soreness':
      return render(
        t['review.prefill.symptoms-soreness'],
        { level: String(PREFILL.mildSoreness) },
        units,
      )
    case 'pain':
      return prefill.symptoms === 'persistent'
        ? render(
            t['review.prefill.symptoms-persistent-pain'],
            { level: String(PREFILL.persistentPain), days: numberWord(PREFILL.persistentDays) },
            units,
          )
        : render(t['review.prefill.symptoms-pain'], {}, units)
    case 'illness':
      return prefill.symptoms === 'persistent'
        ? render(
            t['review.prefill.symptoms-persistent-illness'],
            { level: String(PREFILL.persistentPain), days: numberWord(PREFILL.persistentDays) },
            units,
          )
        : render(t['review.prefill.symptoms-illness'], {}, units)
    case 'bone':
      return render(t['review.prefill.symptoms-bone'], {}, units)
    case null:
      return render(t['review.prefill.symptoms-few'], {}, units)
  }
}

/** The status the page announces after "Looks right". */
export function prefillAcceptedStatus(): string {
  return render(REVIEW_PREFILL_TEMPLATES['review.prefill.accepted-status'], {}, 'km')
}

/** Whether the prefill has an answer to offer for either field. */
export function prefillHasAnswer(prefill: ReviewPrefill): boolean {
  return prefill.fatigue !== null || prefill.symptoms !== null
}
