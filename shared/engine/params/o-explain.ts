// Section (o) Explanations from the runner's own numbers: the data thresholds behind the "What
// stood out" card of a run (phase 3a design 8.5). They are design decisions with no research rule,
// so the rule id is `design-explain`, and every one is a labelled default. Display caps (how many
// sources or cards fit on a screen) are constants in `shared/copy/limits.ts`, not parameters.
import { param, type ParamGroups } from './define.ts'

export const oExplain = {
  standout: {
    longestLookbackWeeks: param('standout.longestLookbackWeeks', 12, 'D', 'design-explain', [], {
      unit: 'weeks',
      note: 'Default: a run is called the longest of recent weeks when it beats every run in this look-back. No study sets the length; it spans a typical build block.',
    }),
    gradeNoteMinPct: param('standout.gradeNoteMinPct', 3, 'D', 'design-explain', [], {
      unit: '% grade',
      note: 'Default: a run gets a note about its climbing only when its average grade reaches this. Below it the effect on pace is small next to the noise of the reading, and no study sets the cut-off.',
    }),
    driftDeltaPp: param(
      'standout.driftDeltaPp',
      2,
      'D',
      'design-explain',
      ['nuuttila-2025-recreational-runners-durability'],
      {
        unit: 'percentage points',
        note: 'Default: a run is said to drift more or less than usual when its pace-to-heart-rate drift differs from the median of comparable runs by this much. The spread of drift between runners is wide (about 4 to 6 points), so a smaller gap says little; the cut-off itself is an engine default.',
      },
    ),
    hrDeltaMinBpm: param(
      'standout.hrDeltaMinBpm',
      3,
      'D',
      'design-explain',
      ['bent-2020-ppg-inaccuracy', 'navalta-2020-trail-running-hr'],
      {
        unit: 'bpm',
        note: 'Default: a heart-rate comparison between runs is stated only when the two differ by more than this. Wrist sensors err by more than a few beats when effort changes, so a smaller gap would be noise; the cut-off itself is an engine default.',
      },
    ),
  },
} satisfies ParamGroups
