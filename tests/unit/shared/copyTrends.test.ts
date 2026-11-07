import { describe, expect, it } from 'vitest'
import { COPY_MAX_CHARS } from '../../../shared/copy/limits.ts'
import { assertCleanCopy } from '../../../shared/copy/lint.ts'
import { TEMPLATES } from '../../../shared/copy/templates.ts'
import {
  bandBuilding,
  bandCaption,
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
