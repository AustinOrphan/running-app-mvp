import { afterEach, describe, expect, test, vi } from 'vitest'
import { COPY_MAX_CHARS } from '../../../shared/copy/limits.ts'
import { assertCleanCopy, lintText } from '../../../shared/copy/lint.ts'
import {
  placeholdersOf,
  render,
  sampleSlots,
  type Template,
} from '../../../shared/copy/template.ts'
import {
  activityWindowRefusal,
  didNotFinishSentence,
  differenceCell,
  headlineSentences,
  inRangeCell,
  outlookLine,
  rangeCell,
  resultRefusal,
  type ResultRefusal,
  savedToast,
  summarySentences,
  TRACK_RECORD_TEMPLATES,
  trackRecordLead,
  unscoredSentence,
} from '../../../shared/copy/trackRecord.ts'
import type { RecordSummary, ScoredPrediction } from '../../../shared/engine/backtest.ts'
import { summariseRecord } from '../../../shared/engine/backtest.ts'
import { P } from '../../../shared/engine/params/index.ts'
import type { Units } from '../../../shared/types.ts'

afterEach(() => {
  vi.unstubAllEnvs()
})

const UNITS: Units[] = ['km', 'mi']
const ids = Object.keys(TRACK_RECORD_TEMPLATES) as Array<keyof typeof TRACK_RECORD_TEMPLATES>

/** What every rendered string of the track record must satisfy, sentence or label. */
function expectFit(text: string, where: string): void {
  assertCleanCopy(text, where)
  expect(text.length, `${where}: ${text}`).toBeGreaterThan(0)
  expect(text.length, `${where}: ${text}`).toBeLessThanOrEqual(COPY_MAX_CHARS)
  expect(text, where).not.toMatch(/[{}]|NaN|undefined|null|Infinity/)
  expect(text, where).not.toMatch(/\d{4}-\d{2}-\d{2}/)
  // the direction is in the words: no sign in front of a number
  expect(text, where).not.toMatch(/[-−+]\d/)
}

function expectSentences(texts: string[], where: string): void {
  for (const text of texts) {
    expectFit(text, where)
    expect(text, where).toMatch(/[.?]$/)
  }
}

function point(overrides: Partial<ScoredPrediction> = {}): ScoredPrediction {
  const predictedSec = overrides.predictedSec ?? 13_920
  const errorSec = overrides.errorSec ?? 250
  return {
    weekStart: '2026-11-02',
    loggedOn: '2026-11-03',
    daysBefore: 12,
    weeksBefore: 1,
    predictedSec,
    lowSec: Math.round(predictedSec * 0.94),
    highSec: Math.round(predictedSec * 1.06),
    errorSec,
    errorPct: (errorSec / predictedSec) * 100,
    inside: true,
    ...overrides,
  }
}

describe('every template of the track record', () => {
  test('there are templates to check, with the two the design names', () => {
    expect(ids.length).toBeGreaterThan(20)
    expect(render(TRACK_RECORD_TEMPLATES['track-record.heading'], {}, 'km')).toBe(
      'Prediction track record',
    )
    expect(render(TRACK_RECORD_TEMPLATES['track-record.record-result'], {}, 'km')).toBe(
      'Record result',
    )
  })

  test.each(ids)('%s declares exactly the slots its text uses', (id) => {
    const template: Template = TRACK_RECORD_TEMPLATES[id]
    expect(Object.keys(template.slots).sort(), id).toEqual(placeholdersOf(template.text).sort())
    expect(placeholdersOf(template.fallback), `${id} fallback`).toEqual([])
  })

  test.each(ids)('%s renders clean, short and finished in both unit systems', (id) => {
    const template: Template = TRACK_RECORD_TEMPLATES[id]
    for (const units of UNITS) {
      const text = render(template, sampleSlots(template), units)
      expectFit(text, id)
      if (template.shape === 'sentence') expect(text, id).toMatch(/[.?]$/)
    }
  })

  test.each(ids)('%s has a fallback that is itself clean, short and finished', (id) => {
    const { fallback, shape } = TRACK_RECORD_TEMPLATES[id] as Template
    expect(lintText(fallback), `${id}: ${fallback}`).toEqual([])
    expect(fallback.length, id).toBeLessThanOrEqual(COPY_MAX_CHARS)
    if (shape === 'sentence') expect(fallback, id).toMatch(/[.?]$/)
  })

  test('a slot that cannot be shown throws under test and renders the fallback in production', () => {
    const template = TRACK_RECORD_TEMPLATES['track-record.table.slower-cell']
    const bad = {
      diff: { kind: 'duration', sec: Number.NaN },
      pct: { kind: 'percent', pct: 1 },
    } as const
    expect(() => render(template, bad, 'km')).toThrow()
    vi.stubEnv('NODE_ENV', 'production')
    expect(render(template, bad, 'km')).toBe('No difference to show')
  })
})

describe('the sentences over a grid of inputs', () => {
  test('lead', () => {
    for (const units of UNITS) {
      const lead = trackRecordLead(units)
      expect(lead).toEqual([
        'The app writes down its predicted finish time once a week.',
        'After a race, each prediction is compared with what happened.',
        'The comparison describes the prediction, not the race.',
      ])
      expectSentences(lead, 'lead')
    }
  })

  test('outlook line', () => {
    for (const units of UNITS) {
      expect(outlookLine(0, units)).toBeNull()
      expect(outlookLine(-3, units)).toBeNull()
      expect(outlookLine(1, units)).toBe(
        '1 prediction logged so far. After the race, add the result to see how it compared.',
      )
      expect(outlookLine(12, units)).toBe(
        '12 predictions logged so far, one a week. After the race, add the result to see how they compared.',
      )
      for (const n of [1, 2, 9, 10, 52, 130]) {
        expectSentences([outlookLine(n, units) as string], `outlook ${String(n)}`)
      }
    }
  })

  test('summary: every count of races, inside counts and medians', () => {
    const summaries: RecordSummary[] = []
    for (let races = 0; races <= 12; races++) {
      for (const error of [-3000, -600, 0, 6, 600, 3000]) {
        summaries.push(
          summariseRecord(
            Array.from({ length: races }, (_, i) => ({
              date: '2026-11-15',
              outcome: 'finished' as const,
              resultSec: 12_000 + error * (i % 2 === 0 ? 1 : -1),
              points: [],
              headline: point({
                predictedSec: 12_000,
                errorSec: error * (i % 2 === 0 ? 1 : -1),
                inside: i % 3 !== 0,
              }),
              inside: i % 3 !== 0,
              unscoredCount: 0,
            })),
          ),
        )
      }
    }
    // hand-built extremes the roll-up does not reach: all outside, all inside, a tiny median
    for (const insideCount of [0, 1, 2, 3, 10]) {
      for (const medianSignedPct of [-100, -12.345, -1.8333, -0.04, 0, 0.04, 1.8333, 9.99, 100]) {
        summaries.push({
          raceCount: Math.max(3, insideCount),
          insideCount,
          medianSignedPct,
          medianAbsPct: Math.abs(medianSignedPct),
          enough: true,
          needed: 0,
        })
      }
    }
    for (const units of UNITS) {
      for (const summary of summaries) {
        const texts = summarySentences(summary, units)
        expect(texts.length).toBeGreaterThan(0)
        expectSentences(texts, `summary ${JSON.stringify(summary)}`)
      }
    }
  })

  test('summary: once there are enough races it reads as the design words it', () => {
    const summary: RecordSummary = {
      raceCount: 3,
      insideCount: 2,
      medianSignedPct: 1.8333,
      medianAbsPct: 2.5,
      enough: true,
      needed: 0,
    }
    expect(summarySentences({ ...summary, insideCount: 3 }, 'km')).toEqual([
      'Across 3 races the result was inside the predicted range 3 times.',
      'The median difference was 1.8% slower than predicted.',
    ])
    expect(summarySentences(summary, 'km')[0]).toBe(
      'Across 3 races the result was inside the predicted range twice.',
    )
    expect(
      summarySentences({ ...summary, raceCount: 4, insideCount: 1, medianSignedPct: -4.04 }, 'mi'),
    ).toEqual([
      'Across 4 races the result was inside the predicted range once.',
      'The median difference was 4% faster than predicted.',
    ])
    expect(summarySentences({ ...summary, insideCount: 0 }, 'km')[0]).toBe(
      'Across 3 races the result was inside the predicted range 0 times.',
    )
    expect(summarySentences({ ...summary, raceCount: 5, insideCount: 5 }, 'km')[0]).toBe(
      'Across 5 races the result was inside the predicted range 5 times.',
    )
    expect(summarySentences({ ...summary, insideCount: 2, raceCount: 2 }, 'km')[0]).toBe(
      'Across 2 races the result was inside the predicted range twice.',
    )
    expect(summarySentences({ ...summary, medianSignedPct: 0.04 }, 'km')[1]).toBe(
      'The median result was within 0.1% of the predicted time.',
    )
    expect(summarySentences({ ...summary, medianSignedPct: -0.04 }, 'km')[1]).toBe(
      'The median result was within 0.1% of the predicted time.',
    )
  })

  test('summary: before enough races each race stands on its own, with the count from the Params', () => {
    const min = P.l7.minRacesForSummary.value
    const needs = (n: number) =>
      `A summary across races needs ${String(n)} more; until then each race stands on its own.`
    expect(summarySentences(summariseRecord([]), 'km')).toEqual([
      'No race compared so far.',
      needs(min),
    ])
    const one = summariseRecord([scoreless()])
    expect(summarySentences(one, 'km')).toEqual(['One race compared so far.', needs(min - 1)])
    const two = summariseRecord([scoreless(), scoreless()])
    expect(summarySentences(two, 'mi')).toEqual(['Two races compared so far.', needs(min - 2)])
    // a threshold raised in the Params reads in the sentence without an edit here
    const raised = summariseRecord([scoreless(), scoreless(), scoreless()], 5)
    expect(summarySentences(raised, 'km')).toEqual(['3 races compared so far.', needs(2)])
    // no pattern figure ever appears before the threshold
    for (const summary of [summariseRecord([]), one, two, raised]) {
      expect(summarySentences(summary, 'km').join(' ')).not.toMatch(/median|inside the predicted/)
    }
  })

  test('summary: inconsistent input never states a pattern or "needs 0 more"', () => {
    const odd: RecordSummary = {
      raceCount: 4,
      insideCount: null,
      medianSignedPct: null,
      medianAbsPct: null,
      enough: true,
      needed: 0,
    }
    expect(summarySentences(odd, 'km')).toEqual(['4 races compared so far.'])
  })

  test('headline: a grid of horizons, times and differences', () => {
    for (const units of UNITS) {
      for (const daysBefore of [1, 2, 6, 13, 200]) {
        for (const predictedSec of [900, 3_599, 12_000, 99_600]) {
          for (const errorSec of [
            -Math.round(predictedSec / 2),
            -4_000,
            -250,
            -1,
            0,
            1,
            59,
            250,
            3_599,
            4_000,
            40_000,
          ]) {
            for (const inside of [true, false]) {
              const texts = headlineSentences(
                point({ daysBefore, predictedSec, errorSec, inside }),
                units,
              )
              expect(texts).toHaveLength(2)
              expectSentences(
                texts,
                `headline ${String(daysBefore)}/${String(predictedSec)}/${String(errorSec)}`,
              )
            }
          }
        }
      }
    }
  })

  test('headline: reads as the design words it, in both directions and on the edge', () => {
    expect(headlineSentences(point(), 'km')).toEqual([
      'The last prediction, made 12 days before the race, was 3 h 52 min (3 h 38 min to 4 h 6 min).',
      'The result was 4 min 10 s slower than predicted (1.8%), inside the range.',
    ])
    const faster = headlineSentences(point({ errorSec: -250, inside: false }), 'mi')
    expect(faster[1]).toBe(
      'The result was 4 min 10 s faster than predicted (1.8%), outside the range.',
    )
    expect(headlineSentences(point({ errorSec: 0 }), 'km')[1]).toBe(
      'The result matched the prediction, inside the range.',
    )
    expect(headlineSentences(point({ errorSec: 0, inside: false }), 'km')[1]).toBe(
      'The result matched the prediction, outside the range.',
    )
    expect(headlineSentences(point({ daysBefore: 1 }), 'km')[0]).toMatch(
      /^The last prediction, made the day before the race, was /,
    )
    expect(headlineSentences(point({ errorSec: 3_000, predictedSec: 13_920 }), 'km')[1]).toContain(
      '50 min slower than predicted (21.6%)',
    )
  })

  test('did not finish: none, one and many predictions', () => {
    for (const units of UNITS) {
      expect(didNotFinishSentence(0, units)).toBe('Did not finish. There is nothing to compare.')
      expect(didNotFinishSentence(1, units)).toBe(
        'Did not finish. There is nothing to compare, so this prediction is not scored.',
      )
      expect(didNotFinishSentence(12, units)).toBe(
        'Did not finish. There is nothing to compare, so these 12 predictions are not scored.',
      )
      for (const n of [-1, 0, 1, 2, 11, 57, 400]) {
        expectSentences([didNotFinishSentence(n, units)], `did not finish ${String(n)}`)
      }
    }
  })

  test('unscored predictions: a race not finished, another course, none logged, all scored', () => {
    const scored = [point()]
    for (const units of UNITS) {
      expect(
        unscoredSentence({ outcome: 'did-not-finish', points: [], unscoredCount: 12 }, units),
      ).toBe('Did not finish. There is nothing to compare, so these 12 predictions are not scored.')
      expect(unscoredSentence({ outcome: 'finished', points: [], unscoredCount: 5 }, units)).toBe(
        '5 predictions were made for a different course, so they are not scored.',
      )
      expect(unscoredSentence({ outcome: 'finished', points: [], unscoredCount: 1 }, units)).toBe(
        '1 prediction was made for a different course, so it is not scored.',
      )
      // some scored and some not: the note names the ones that were left out
      expect(
        unscoredSentence({ outcome: 'finished', points: scored, unscoredCount: 2 }, units),
      ).toBe('2 predictions were made for a different course, so they are not scored.')
      expect(unscoredSentence({ outcome: 'finished', points: [], unscoredCount: 0 }, units)).toBe(
        'No predictions were logged before this race, so there is nothing to compare.',
      )
      expect(
        unscoredSentence({ outcome: 'finished', points: scored, unscoredCount: 0 }, units),
      ).toBeNull()
      for (const unscoredCount of [0, 1, 2, 9, 52]) {
        for (const outcome of ['finished', 'did-not-finish'] as const) {
          for (const points of [[], scored]) {
            const text = unscoredSentence({ outcome, points, unscoredCount }, units)
            if (text !== null)
              expectSentences([text], `unscored ${outcome} ${String(unscoredCount)}`)
          }
        }
      }
    }
  })

  test('table cells', () => {
    for (const units of UNITS) {
      expect(differenceCell(point({ errorSec: 250 }), units)).toBe('4 min 10 s slower (1.8%)')
      expect(differenceCell(point({ errorSec: -250 }), units)).toBe('4 min 10 s faster (1.8%)')
      expect(differenceCell(point({ errorSec: 0 }), units)).toBe('Matched')
      expect(rangeCell(point(), units)).toBe('3 h 38 min to 4 h 6 min')
      expect(inRangeCell(point({ inside: true }), units)).toBe('Yes')
      expect(inRangeCell(point({ inside: false }), units)).toBe('No')
      for (const errorSec of [-40_000, -61, -1, 0, 1, 61, 40_000]) {
        const cells = [
          differenceCell(point({ errorSec }), units),
          rangeCell(point({ predictedSec: 900 }), units),
          inRangeCell(point({ inside: errorSec > 0 }), units),
        ]
        for (const cell of cells) expectFit(cell, `cell ${String(errorSec)}`)
      }
    }
  })

  test('toast after saving', () => {
    for (const units of UNITS) {
      expect(savedToast({ outcome: 'finished', scoredPredictions: 12 }, units)).toBe(
        'Result saved. 12 predictions compared.',
      )
      expect(savedToast({ outcome: 'finished', scoredPredictions: 1 }, units)).toBe(
        'Result saved. 1 prediction compared.',
      )
      expect(savedToast({ outcome: 'finished', scoredPredictions: 0 }, units)).toBe(
        'Result saved. 0 predictions compared.',
      )
      expect(savedToast({ outcome: 'did-not-finish', scoredPredictions: 0 }, units)).toBe(
        'Result saved. Nothing to compare for a race not finished.',
      )
      for (const scoredPredictions of [0, 1, 2, 12, 104]) {
        expectSentences([savedToast({ outcome: 'finished', scoredPredictions }, units)], 'toast')
      }
    }
  })

  test('the fixed sheet and chart words pass the lint', () => {
    for (const id of [
      'track-record.sheet.time-hint',
      'track-record.sheet.link-notice',
      'track-record.sheet.remove-confirm',
    ] as const) {
      expectSentences([render(TRACK_RECORD_TEMPLATES[id], {}, 'km')], id)
    }
    expect(render(TRACK_RECORD_TEMPLATES['track-record.sheet.time-hint'], {}, 'km')).toBe(
      'Official time as h:mm:ss, like 3:52:10.',
    )
    expect(render(TRACK_RECORD_TEMPLATES['track-record.sheet.remove-confirm'], {}, 'km')).toBe(
      'Remove this result? The weekly predictions stay logged and are no longer compared.',
    )
    const name = render(
      TRACK_RECORD_TEMPLATES['track-record.chart.name'],
      { race: 'Example 100 Mile' },
      'km',
    )
    expect(name).toBe(
      'Weekly predicted finish times and ranges for Example 100 Mile, against the result',
    )
    expectFit(name, 'chart name')
    expect(
      render(
        TRACK_RECORD_TEMPLATES['track-record.record-result-for'],
        { goal: 'Example 100 Mile' },
        'km',
      ),
    ).toBe('Record result for Example 100 Mile')
    expect(
      render(
        TRACK_RECORD_TEMPLATES['track-record.edit-result-for'],
        { goal: 'Example 100 Mile' },
        'km',
      ),
    ).toBe('Edit result for Example 100 Mile')
  })
})

describe('the refusals of the result routes', () => {
  const MESSAGES: Record<ResultRefusal, string> = {
    'not-a-run': 'Choose a run or a race.',
    distance: 'Enter the distance that was raced.',
    'activity-taken': 'That activity is already linked to the result of another race.',
    'no-result': 'No result is recorded for this goal.',
    'time-required': 'Enter the official finish time.',
    'date-passed': 'Use a race date that has passed.',
  }

  test('keep their words, and pass the lint', () => {
    for (const [kind, message] of Object.entries(MESSAGES) as Array<[ResultRefusal, string]>) {
      expect(resultRefusal(kind)).toBe(message)
      expectSentences([resultRefusal(kind)], kind)
    }
    expect(activityWindowRefusal(3)).toBe('Choose an activity within 3 days of the race date.')
    for (const days of [0, 1, 3, 14, 365]) {
      expectSentences([activityWindowRefusal(days)], 'activity-window')
    }
  })

  test('every refusal template is reached by a helper', () => {
    const refused = ids.filter((id) => id.startsWith('track-record.refused.'))
    expect(refused.map((id) => id.replace('track-record.refused.', '')).sort()).toEqual(
      [...Object.keys(MESSAGES), 'activity-window'].sort(),
    )
  })
})

describe('the track record never judges', () => {
  test('no sentence calls a difference a miss, a failure or a setback', () => {
    const all: string[] = []
    for (const units of UNITS) {
      for (const id of ids) {
        const template: Template = TRACK_RECORD_TEMPLATES[id]
        all.push(render(template, sampleSlots(template), units))
      }
    }
    expect(all.join(' ')).not.toMatch(/behind|missed|fail|streak|badge|\bPB\b|\bPR\b|!/i)
  })
})

/** A race that counts in the summary; only its presence matters for the not-enough sentences. */
function scoreless() {
  return {
    date: '2026-11-15',
    outcome: 'finished' as const,
    resultSec: 12_000,
    points: [point()],
    headline: point(),
    inside: true,
    unscoredCount: 0,
  }
}
