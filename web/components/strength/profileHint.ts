// The hint under the strength choice on the Profile (design 11.2): how many strength sessions the
// plan asks for, how long one takes, and what a double is. The figures are Params, so a change of
// a Param changes the sentence; the words are templates of `shared/copy/strengthTemplates.ts`.
import { countPhrase } from '../../../shared/copy/quantity.ts'
import { STRENGTH_TEMPLATES } from '../../../shared/copy/strengthTemplates.ts'
import { render } from '../../../shared/copy/template.ts'
import { P } from '../../../shared/engine/params/index.ts'
import type { Units } from '../../../shared/types.ts'

/** "The plan asks for at most two strength sessions a week, each up to about 40 min. A double is ..." */
export function strengthProfileHint(units: Units): string {
  const count = render(
    STRENGTH_TEMPLATES['strength.profile.count'],
    {
      sessions: countPhrase(P.flib.strengthPerWeek.value, 'strength session'),
      time: { kind: 'minutes', min: P.f7.blockSessionMin.value },
    },
    units,
  )
  const double = render(
    STRENGTH_TEMPLATES['strength.profile.double'],
    { hours: { kind: 'count', n: P.f4.strengthSeparationHours.value } },
    units,
  )
  return `${count} ${double}`
}
