// The one muted line on the run page about the run's heart rate (TH1): where it came from and
// whether Trends reads it. A neutral fact with no verdict (G5). The thresholds are read from their
// Params, so the words follow the engine's numbers.
import type { HrUse } from '../engine/hrQuality.ts'
import { P } from '../engine/params/index.ts'
import type { Units } from '../types.ts'
import { render, tpl } from './template.ts'

export const HR_USE_TEMPLATES = {
  'hr-use.source-strap': tpl('Heart rate from an external sensor.'),
  'hr-use.source-wrist': tpl('Heart rate from the wrist.'),
  'hr-use.passes': tpl("Trends reads this run's heart rate."),
  'hr-use.short': tpl("Trends sets this run's heart rate aside: the run is under {min} moving.", {
    min: 'minutes',
  }),
  'hr-use.unclean': tpl(
    "Trends sets this run's heart rate aside: under {share} of the moving time had clean readings.",
    { share: 'percent' },
  ),
} as const

/** "Heart rate from the wrist. Trends reads this run's heart rate." */
export function hrUseLine(use: HrUse, units: Units): string {
  const source =
    use.source === 'strap'
      ? render(HR_USE_TEMPLATES['hr-use.source-strap'], {}, units)
      : use.source === 'wrist'
        ? render(HR_USE_TEMPLATES['hr-use.source-wrist'], {}, units)
        : null
  const verdict =
    use.reason === 'short'
      ? render(
          HR_USE_TEMPLATES['hr-use.short'],
          { min: { kind: 'minutes', min: P.hrModel.minDurationMin.value } },
          units,
        )
      : use.reason === 'unclean'
        ? render(
            HR_USE_TEMPLATES['hr-use.unclean'],
            { share: { kind: 'percent', pct: Math.round(P.b2.qMinCleanShare.value * 100) } },
            units,
          )
        : render(HR_USE_TEMPLATES['hr-use.passes'], {}, units)
  return source === null ? verdict : `${source} ${verdict}`
}
