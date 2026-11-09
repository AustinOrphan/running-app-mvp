import { describe, expect, it } from 'vitest'
import { COPY_MAX_CHARS } from '../../../shared/copy/limits.ts'
import { assertCleanCopy } from '../../../shared/copy/lint.ts'
import { TEMPLATES } from '../../../shared/copy/templates.ts'
import {
  bandBuilding,
  bandCaption,
  climbAria,
  climbCaption,
  climbCoverageLine,
  intensityAria,
  intensityCoverageLine,
  intensityLimitsLine,
  driftAria,
  driftComparableLine,
  driftFilledLine,
  driftHollowOnlyLine,
  driftSizeLine,
  driftHillsLine,
  driftMedianLine,
  driftNoMedianLine,
  hrAria,
  hrCaption,
  hrEmptyBody,
  hrEmptyPaceBody,
  hrNeedsLine,
  hrOverlapLine,
  nightsCaption,
  TRENDS_TEMPLATES,
  trendsText,
  type PlainTrendsId,
  weightAria,
  weightCaption,
} from '../../../shared/copy/trends.ts'

describe('the words of the Trends page', () => {
  it('registers every template, so the shared lint test renders it', () => {
    for (const id of Object.keys(TRENDS_TEMPLATES) as Array<keyof typeof TRENDS_TEMPLATES>) {
      expect(TEMPLATES[id], id).toBe(TRENDS_TEMPLATES[id])
      expect(id.startsWith('trends.'), id).toBe(true)
    }
  })

  it('writes the captions of the recent range from the Params of the baseline', () => {
    expect(bandCaption('hrv', false)).toBe(
      'The band is your recent range: the mean of the latest 10 readings within the 21 days before the week, plus or minus 1 SD.',
    )
    // The cycle-aware profile reads every reading of the 35 days, as Today does.
    expect(bandCaption('hrv', true)).toBe(
      'The band is your recent range: the mean of the readings within the 35 days before the week, plus or minus 1 SD.',
    )
    // Resting heart rate has no cycle handling, as Today's.
    expect(bandCaption('resting-hr', true)).toBe(bandCaption('resting-hr', false))
    expect(bandCaption('resting-hr', false)).toBe(bandCaption('hrv', false))
  })

  it('says how far the recent range is from being built, without grading it', () => {
    expect(bandBuilding(6)).toBe('The recent range is still being built: 6 of 10 readings.')
  })

  it('states the nights a weekly mean needs', () => {
    expect(nightsCaption('trends.sleep.caption', 4)).toBe(
      'Weekly mean of recorded sleep in hours, for weeks with at least 4 nights recorded. No range is drawn.',
    )
    expect(nightsCaption('trends.hrv.caption', 4)).toContain('rMSSD')
  })

  it('is clean under the G5 lint and short enough to read, whatever the figures', () => {
    const lines = [
      bandCaption('hrv', false),
      bandCaption('hrv', true),
      bandCaption('resting-hr', false),
      bandBuilding(0),
      bandBuilding(9),
      nightsCaption('trends.hrv.caption', 4),
      nightsCaption('trends.rhr.caption', 4),
      nightsCaption('trends.sleep.caption', 4),
      ...(Object.keys(TRENDS_TEMPLATES) as PlainTrendsId[])
        .filter((id) => Object.keys(TRENDS_TEMPLATES[id].slots).length === 0)
        .map((id) => trendsText(id)),
    ]
    for (const line of lines) {
      assertCleanCopy(line, line)
      expect(line.length, line).toBeLessThanOrEqual(COPY_MAX_CHARS)
    }
  })

  it('gives the weight templates no slot but the mean, a count and the months, so no change can be rendered', () => {
    const weightIds = (
      Object.keys(TRENDS_TEMPLATES) as Array<keyof typeof TRENDS_TEMPLATES>
    ).filter((id) => id.startsWith('trends.weight.'))
    expect(weightIds.length).toBeGreaterThan(0)
    for (const id of weightIds) {
      for (const slot of Object.keys(TRENDS_TEMPLATES[id].slots)) {
        expect(['mean', 'unit', 'count', 'months'], `${id}: ${slot}`).toContain(slot)
      }
    }
    const all = weightIds.map((id) => TRENDS_TEMPLATES[id].text).join('\n')
    for (const word of [
      /\bgain/i,
      /\bloss\b/i,
      /\blost\b/i,
      /\bgoal\b/i,
      /\bBMI\b/,
      /\bideal\b/i,
    ]) {
      expect(all).not.toMatch(word)
    }
  })

  it('states the weight caption and the accessible names from the page constants', () => {
    expect(weightCaption(2)).toBe(
      "Mean of each week's weigh-ins, for weeks with at least 2 weigh-ins. A scale varies within a day, so read the line, not a point.",
    )
    // The caption states no figure in a unit, so it reads the same for a runner in pounds or kilograms.
    expect(weightCaption(2)).not.toMatch(/\b(kg|lb|kilograms?|pounds?)\b/i)
    expect(weightAria(12, '70.3 kg')).toBe(
      'Body weight, weekly mean, last 12 months. Latest week with enough weigh-ins: 70.3 kg.',
    )
    expect(weightAria(12, null)).toBe(
      'Body weight, weekly mean, last 12 months. No week has enough weigh-ins yet.',
    )
    for (const line of [weightCaption(2), weightAria(12, '70.3 kg'), weightAria(6, null)]) {
      assertCleanCopy(line, line)
    }
  })

  it("words the drift panel from the Params of rules A7 and B2, in the runner's unit", () => {
    expect(driftFilledLine()).toBe(
      'Filled dots are the largest set of comparable runs, which the median is read from. Hollow dots are every other run.',
    )
    expect(driftHollowOnlyLine()).toBe('All dots are rings until 3 comparable runs make a median.')
    expect(driftSizeLine()).toBe(
      "Dot area follows run length, up to 3 h. One run's figure moves with the day, so read the dots together.",
    )
    expect(driftComparableLine('km')).toBe(
      'Comparable runs last 90 min to 3 h in air under 25 °C, within 20% in length and 5 °C in temperature of each other.',
    )
    // The air is worded in the runner's unit; 5 degrees of difference is 9, not 41.
    expect(driftComparableLine('mi')).toBe(
      'Comparable runs last 90 min to 3 h in air under 77 °F, within 20% in length and 9 °F in temperature of each other.',
    )
    expect(driftHillsLine('km')).toContain('more than 15 m per km is drawn only when')
    // 15 m per km is 24 m per mile, 79 ft.
    expect(driftHillsLine('mi')).toContain('more than 79 ft per mile is drawn only when')
    expect(driftMedianLine(4.1, 5, 118)).toBe(
      'Median 4.1% over 5 comparable runs of about 2 h on cool days.',
    )
    expect(driftNoMedianLine(2, 'km')).toBe(
      'No median yet: the largest set of comparable runs holds 2 of 3.',
    )
    expect(driftNoMedianLine(0, 'km')).toBe(
      'No median yet. It needs 3 comparable runs of 90 min to 3 h in air under 25 °C.',
    )
    expect(driftAria('last 12 months', { count: 6, pct: -1.2, date: '2026-05-04' })).toBe(
      'Heart-rate drift of 6 runs, last 12 months. Latest -1.2% on 4 May.',
    )
    expect(driftAria('last 12 months', null)).toBe(
      'Heart-rate drift of long runs, last 12 months. No run has a reading yet.',
    )
  })

  it("words the heart-rate panel from the Params of rules A8 and C9, with the pace in the runner's unit", () => {
    expect(hrCaption(2.8, 'km')).toBe(
      'Each point is the heart rate your own line gives at 5:57 /km on a cool day, from the steady runs of the 8 weeks to that date.',
    )
    expect(hrCaption(2.8, 'mi')).toContain('9:35 /mi')
    expect(hrNeedsLine(2.8, 'km')).toBe(
      'A point needs 8 steady runs with heart rate in 8 weeks, and 5:57 /km within 10% of the paces they covered.',
    )
    expect(hrEmptyPaceBody(2.8, 'km')).toBe(
      'No window of this range ran 5:57 /km or a pace near it, so no point can be read at one pace.',
    )
    expect(hrOverlapLine(4)).toContain('A point comes every 4 weeks')
    expect(hrEmptyBody(5)).toBe(
      'A line needs 8 steady runs with heart rate within 8 weeks. The latest 8 weeks have 5.',
    )
    expect(hrAria('last 12 months', { mps: 2.8, latestBpm: 146 }, 'km')).toBe(
      'Heart rate at 5:57 /km, one point per 8-week window, last 12 months. Latest point: 146 bpm.',
    )
    expect(hrAria('last 12 months', { mps: 2.8, latestBpm: null }, 'km')).toBe(
      'Heart rate at one speed, last 12 months. No window has a point yet.',
    )
  })

  it('keeps every sentence of the two panels clean under G5 and short, in both unit systems', () => {
    for (const units of ['km', 'mi'] as const) {
      const lines = [
        driftHillsLine(units),
        driftFilledLine(),
        driftHollowOnlyLine(),
        driftSizeLine(),
        hrEmptyPaceBody(3.3, units),
        driftComparableLine(units),
        driftMedianLine(-0.4, 12, 185),
        driftNoMedianLine(0, units),
        driftNoMedianLine(2, units),
        driftAria('since the week of 24 Aug', { count: 12, pct: 7.25, date: '2026-05-04' }),
        driftAria('last 6 months', null),
        hrCaption(2.1, units),
        hrCaption(4.2, units),
        hrOverlapLine(4),
        hrNeedsLine(3.3, units),
        hrEmptyBody(0),
        hrAria('last 24 months', { mps: 3.3, latestBpm: 171 }, units),
        hrAria('last 24 months', { mps: 3.3, latestBpm: null }, units),
      ]
      for (const line of lines) {
        assertCleanCopy(line, line)
        expect(line.length, line).toBeLessThanOrEqual(COPY_MAX_CHARS)
      }
    }
  })

  it('writes no grade on the runner in the drift or heart-rate panels', () => {
    const all = Object.entries(TRENDS_TEMPLATES)
      .filter(([id]) => id.startsWith('trends.drift.') || id.startsWith('trends.hr.'))
      .map(([, template]) => template.text)
      .join('\n')
    for (const word of [
      /\b(better|worse|good|poor|bad|improv\w*|declin\w*|fitter|fitness|durab\w*|efficien\w*)\b/i,
      /\b(normal|healthy|concern\w*|warning|alert)\b/i,
    ]) {
      expect(all).not.toMatch(word)
    }
  })

  it('judges no week: no template reads a point as inside, outside, low, high or a target', () => {
    const all = Object.values(TRENDS_TEMPLATES)
      .map((template) => template.text)
      .join('\n')
    for (const word of [/outside/i, /inside/i, /\bnormal\b/i, /\bgoal\b/i, /\bthreshold\b/i]) {
      expect(all).not.toMatch(word)
    }
    // "Nothing here is a target" is the one place the word appears, and it denies one.
    expect(all.match(/target/gi)).toHaveLength(1)
    expect(TRENDS_TEMPLATES['trends.context'].text).toContain('Nothing here is a target.')
  })
})

describe('the words of the climbing and intensity panels', () => {
  it('words the climbing captions in the runner unit and the coverage as counts', () => {
    expect(climbCaption('km')).toBe(
      'Bars are the elevation gain recorded on your runs each week, in metres. The line is the mean of that week and the three before it.',
    )
    expect(climbCaption('mi')).toContain('in feet.')
    expect(climbCoverageLine(31, 36)).toBe(
      '31 of 36 runs have elevation. A run with none is left out, not read as flat.',
    )
    expect(climbAria('last 12 months', 1000, 'km')).toBe(
      'Climbing per week, last 12 months. Latest complete week with elevation: 1000 m.',
    )
    expect(climbAria('last 12 months', 1000, 'mi')).toContain('3281 ft')
    expect(climbAria('last 12 months', null, 'km')).toBe(
      'Climbing per week, last 12 months. No complete week has elevation yet.',
    )
    expect(TRENDS_TEMPLATES['trends.climb.rough'].text).toContain('barometer or GPS is rough')
  })

  it('words the intensity panel from the zone limits, and names the part with no usable heart rate', () => {
    expect(intensityLimitsLine(140, 160)).toBe(
      'Zone 1 is up to 140 bpm, Zone 2 is up to 160 bpm and Zone 3 is above, by the heart rate of the zone table on Profile.',
    )
    expect(intensityCoverageLine(20, 36)).toBe('20 of 36 runs have usable heart rate.')
    expect(intensityAria('last 12 months', { z1: 120, z2: 45, z3: 5, none: 30 })).toBe(
      'Run hours per week by zone, last 12 months. Latest complete week: Zone 1 2 h, Zone 2 45 min, Zone 3 5 min, no usable heart rate 30 min.',
    )
    expect(intensityAria('last 12 months', null)).toContain('No complete week has runs yet.')
    expect(trendsText('trends.intensity.caption')).toContain('as they stand today')
    expect(trendsText('trends.intensity.neutral')).toContain('no usable heart rate')
  })

  it('keeps the two panels clean under G5 and short, with no ratio, risk or verdict word', () => {
    const lines = [
      climbCaption('km'),
      climbCaption('mi'),
      climbCoverageLine(0, 0),
      climbCoverageLine(31, 36),
      climbAria('since the week of 24 Aug', 842.5, 'mi'),
      climbAria('last 6 months', null, 'km'),
      intensityLimitsLine(139.5, 161),
      intensityCoverageLine(0, 12),
      intensityAria('last 24 months', { z1: 0, z2: 0, z3: 0, none: 0 }),
      intensityAria('last 24 months', null),
      ...(Object.keys(TRENDS_TEMPLATES) as Array<keyof typeof TRENDS_TEMPLATES>)
        .filter((id) => /^trends\.(climb|intensity|load)\./.test(id))
        .filter((id) => Object.keys(TRENDS_TEMPLATES[id].slots).length === 0)
        .map((id) => trendsText(id as PlainTrendsId)),
    ]
    for (const line of lines) {
      assertCleanCopy(line, line)
      expect(line.length, line).toBeLessThanOrEqual(COPY_MAX_CHARS)
      expect(line, line).not.toMatch(/\b(ratio|risk|spike|overload|too much|safe|danger)/i)
    }
    // No slot can carry a comparison with an earlier week, the plan or a target.
    const slots = (Object.keys(TRENDS_TEMPLATES) as Array<keyof typeof TRENDS_TEMPLATES>)
      .filter((id) => /^trends\.(climb|intensity)\./.test(id))
      .flatMap((id) => Object.keys(TRENDS_TEMPLATES[id].slots))
    for (const slot of slots) {
      expect([
        'unit',
        'have',
        'runs',
        'span',
        'climb',
        'lt1',
        'lt2',
        'z1',
        'z2',
        'z3',
        'none',
      ]).toContain(slot)
    }
  })
})
