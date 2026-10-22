// Section (n) for the plan quality checklist (Task E9). A rule id that has no number in
// research/engine-rules.md still needs a parameter, so the "why" drawer can show its grade and
// note: the checklist reads this value instead of a literal.
import { param, type ParamGroups } from './define.ts'

export const nChecklist = {
  f3: {
    maxQualityNeighboursOfLongRun: param('f3.maxQualityNeighboursOfLongRun', 1, 'D', 'F3', [], {
      unit: 'quality days among the two days around a long run',
      note: 'Default: the long run does not sit between two quality days, so at most one of its neighbouring days is a quality day.',
    }),
  },
} satisfies ParamGroups
