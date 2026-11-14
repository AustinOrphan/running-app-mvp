// The health notice shown once before a runner's first plan (FS1, beta checklist item 16).
//
// The app links the official PAR-Q+ and never reproduces, paraphrases or embeds it: the licence
// allows the whole questionnaire without change and asks third-party apps for authorization. The
// notice asks nothing medical of its own. The age is the one fact it uses.

/**
 * The version of the notice's words. Raise it when the wording changes in meaning; a stored
 * confirmation of an older version no longer counts for a runner who has no plan yet.
 */
export const PLAN_NOTICE_VERSION = 1

/** The official page of the PAR-Q+ Collaboration that lists the print versions of the form. */
export const PARQ_PLUS_URL = 'https://eparmedx.com/print-versions-of-par-q/'

export const MINIMUM_AGE = 18

/**
 * What the profile says about the minimum age. Only a birth year is stored, so a runner is
 * `under` only when the year alone settles it (the year gives an age of 17 or less whatever the
 * birthday), `ok` when the year gives 19 or more, and `ask` when the year is missing or the runner
 * may be 17 or 18, so the confirmation carries "I am 18 or older".
 */
export type AgeStanding = 'under' | 'ask' | 'ok'

export function ageStanding(birthYear: number | null, todayYear: number): AgeStanding {
  if (birthYear === null) return 'ask'
  const age = todayYear - birthYear
  if (age < MINIMUM_AGE) return 'under'
  if (age === MINIMUM_AGE) return 'ask'
  return 'ok'
}
