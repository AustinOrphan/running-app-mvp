// Section (o) Delivery to devices. Source: research/engine-rules.md, rule O1. The device rules
// apply the same targets as every other surface (`resolveTargets`) to the steps of a workout; both
// numbers are labelled engine defaults. The plumbing of delivery (horizons, grace period, back-off,
// chunk sizes, name caps) is named constants in the server, not parameters.
import { param, type ParamGroups } from './define.ts'

export const oDelivery = {
  o1: {
    hrFloorBpm: param('o1.hrFloorBpm', 40, 'D', 'O1', [], {
      unit: 'bpm',
      note: 'Default: the lower edge written with a heart-rate ceiling, so the watch alerts only above the ceiling and never for a low reading. No study sets it; 40 bpm is below any running heart rate.',
    }),
    hrTargetMinStepSec: param(
      'o1.hrTargetMinStepSec',
      180,
      'D',
      'O1',
      ['bent-2020-ppg-inaccuracy', 'gillinov-2017-wearable-hr-aerobic'],
      {
        unit: 'sec',
        note: 'Default: a step shorter than this carries no heart-rate target. Wrist heart rate is accurate on average in steady running but errs more when activity changes (the direction is grade C), and it lags a change of effort; the length itself is an engine default.',
      },
    ),
  },
} satisfies ParamGroups
