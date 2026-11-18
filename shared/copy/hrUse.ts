// The one muted line on the run page about the run's heart rate (TH1): where it came from and
// whether Trends reads it. A neutral fact with no verdict (G5). The thresholds are read from their
// Params, and the panels are named by the Trends page's own headings.
//
// What each panel does with a run that fails `hrQualityPasses`: "Intensity per week" and "Long runs
// by the hour" set every such run aside; "Heart rate at one speed" and "Heart-rate drift on long
// runs" set aside a hilly one and still read a flat one (`hrDataUsable`, `longRunReadings`).
import type { HrUse } from '../engine/hrQuality.ts'
import { P } from '../engine/params/index.ts'
import type { Units } from '../types.ts'
import { render, tpl } from './template.ts'
import { TRENDS_TEMPLATES } from './trends.ts'

export const HR_USE_TEMPLATES = {
  'hr-use.source-strap': tpl('Heart rate from an external sensor.'),
  'hr-use.source-wrist': tpl('Heart rate from the wrist.'),
  'hr-use.passes': tpl("Trends reads this run's heart rate."),
  'hr-use.short': tpl('The run is under {min} moving.', { min: 'minutes' }),
  'hr-use.unclean': tpl('Under {share} of the moving time had clean readings.', {
    share: 'percent',
  }),
  'hr-use.aside-hilly': tpl("{panels} set this run's heart rate aside.", { panels: 'text' }),
  'hr-use.aside-flat': tpl('{panels} set it aside; {others} can still read it as a flat run.', {
    panels: 'text',
    others: 'text',
  }),
} as const

/** "Heart rate from the wrist. Trends reads this run's heart rate." */
export function hrUseLine(use: HrUse, units: Units): string {
  const title = (id: keyof typeof TRENDS_TEMPLATES) => render(TRENDS_TEMPLATES[id], {}, units)
  const source =
    use.source === 'strap'
      ? render(HR_USE_TEMPLATES['hr-use.source-strap'], {}, units)
      : use.source === 'wrist'
        ? render(HR_USE_TEMPLATES['hr-use.source-wrist'], {}, units)
        : null
  const zones = title('trends.intensity.heading')
  const durability = title('trends.durability.heading')
  const pace = title('trends.hr.heading')
  const drift = title('trends.drift.heading')
  const body = use.passes
    ? render(HR_USE_TEMPLATES['hr-use.passes'], {}, units)
    : [
        use.reason === 'short'
          ? render(
              HR_USE_TEMPLATES['hr-use.short'],
              { min: { kind: 'minutes', min: P.hrModel.minDurationMin.value } },
              units,
            )
          : render(
              HR_USE_TEMPLATES['hr-use.unclean'],
              { share: { kind: 'percent', pct: Math.round(P.b2.qMinCleanShare.value * 100) } },
              units,
            ),
        use.flat
          ? render(
              HR_USE_TEMPLATES['hr-use.aside-flat'],
              { panels: `${zones} and ${durability}`, others: `${pace} and ${drift}` },
              units,
            )
          : render(
              HR_USE_TEMPLATES['hr-use.aside-hilly'],
              { panels: `${zones}, ${durability}, ${pace} and ${drift}` },
              units,
            ),
      ].join(' ')
  return source === null ? body : `${source} ${body}`
}
