import { describe, expect, test } from 'vitest'
import { EXECUTION_TEMPLATES } from '../../shared/copy/execution.ts'
import { render } from '../../shared/copy/template.ts'
import { allParams } from '../../shared/engine/params/index.ts'
import type { EngineWarning, ExecutionAssessment } from '../../shared/engine/types.ts'
import {
  assessmentLines,
  groupWarnings,
  localiseEngineText,
  localiseParamNote,
  ratingCounts,
  unratedEffortNote,
} from '../../web/components/engineText.ts'

const warning = (
  code: string,
  message: string,
  over: Partial<EngineWarning> = {},
): EngineWarning => ({
  code,
  severity: 'warn',
  message,
  rules: ['H4'],
  ...over,
})

describe('localiseEngineText', () => {
  test('reads ISO dates as "19 Oct" in every unit setting', () => {
    const text = 'The run on 2026-10-19 and the week of 2027-01-04.'
    expect(localiseEngineText(text, 'km')).toBe('The run on 19 Oct and the week of 4 Jan.')
    expect(localiseEngineText(text, undefined)).toBe('The run on 19 Oct and the week of 4 Jan.')
    expect(localiseEngineText(text, 'mi')).toBe('The run on 19 Oct and the week of 4 Jan.')
  })

  test('leaves a date it cannot read alone', () => {
    expect(localiseEngineText('On 2026-13-45 nothing.', 'km')).toBe('On 2026-13-45 nothing.')
  })

  test('keeps metres and kilometres with the km setting', () => {
    const text = 'Climbing is 700 m, above 550 m; the run is 21.1 km.'
    expect(localiseEngineText(text, 'km')).toBe(text)
  })

  test('turns climbs into feet and distances into miles with the mi setting', () => {
    expect(localiseEngineText('Climbing is 700 m, above 550 m.', 'mi')).toBe(
      'Climbing is 2297 ft, above 1804 ft.',
    )
    expect(localiseEngineText('The run is 21.1 km long, 0.5 km more.', 'mi')).toBe(
      'The run is 13.1 mi long, 0.3 mi more.',
    )
  })

  test('does not touch minutes, speeds or the critical-speed distance', () => {
    const text = "90 min at 3.10 m/s with D' 120 m, 5 km/h slower, 3 mins."
    expect(localiseEngineText(text, 'mi')).toBe(text)
  })

  test('converts both ends of a range of kilometres', () => {
    expect(localiseEngineText('Long runs of 28-32 km.', 'mi')).toBe('Long runs of 17.4-19.9 mi.')
    expect(localiseEngineText('A race of 42.2 to 80.5 km.', 'mi')).toBe(
      'A race of 26.2 to 50.0 mi.',
    )
    const text = 'Long runs of 28-32 km, or 42.2 to 80.5 km.'
    expect(localiseEngineText(text, 'km')).toBe(text)
  })
})

describe('localiseParamNote', () => {
  test('reads climbs, distances, speeds, climbing rates and paces in miles and feet', () => {
    const note =
      'A step of 0.5 km or 100 m of gain, 12 km/h or slower, 550 m/h on climbs, a prior of 7:00 per km.'
    expect(localiseParamNote(note, 'mi')).toBe(
      'A step of 0.3 mi or 328 ft of gain, 7.5 mph or slower, 1804 ft/h on climbs, a prior of 11:16 /mi.',
    )
  })

  test('leaves minutes, race classes and miles as written', () => {
    const note = 'Peak long run for a 50K ultra: 175 min, 5-10K RCT, 100 miles, 30-day maxima.'
    expect(localiseParamNote(note, 'mi')).toBe(note)
  })

  test('is the engine-text conversion for dates, climbs and distances', () => {
    const text = 'On 2026-10-19 a climb of 700 m and a run of 21.1 km.'
    expect(localiseParamNote(text, 'mi')).toBe(localiseEngineText(text, 'mi'))
    expect(localiseParamNote(text, 'km')).toBe(localiseEngineText(text, 'km'))
  })

  // The registry is the data: a note added later is covered without an edit here.
  const notes = allParams().flatMap((p) =>
    p.note === undefined ? [] : [{ id: p.id, note: p.note }],
  )
  /** Kilometre and metre figures: "0.5 km", "28-32 km", "800 m/h", "7:00 per km". */
  const METRIC_FIGURE = /\d(?:\.\d+)?\s?(?:km|m)(?![A-Za-z])|\d:\d\d(?: per |\/)km/
  /** Paper ids such as daniel-2024-217km-sleep-training carry digits and letters of no unit. */
  const PAPER_ID = /\b[a-z]+-\d{4}-[a-z0-9-]+/g
  /** A race class spelled as a distance ("a 50 km ultra", "classed 5 km"), not as "50K". */
  const CLASS_AS_DISTANCE =
    /\bclassed (?:5|10|50|100) km\b|\b5-10 km\b|\b(?:5|10|50|100) km (?:goals?|class|ultras?|races?|athletes?|long-run)\b/

  test('the registry has notes to check', () => {
    expect(notes.length).toBeGreaterThan(300)
  })

  test('no note shows a kilometre or metre figure to a runner on miles', () => {
    const left = notes
      .map(({ id, note }) => ({ id, text: localiseParamNote(note, 'mi').replace(PAPER_ID, '') }))
      .filter(({ text }) => METRIC_FIGURE.test(text))
      .map(({ id, text }) => `${id}: ${text}`)
    expect(left).toEqual([])
  })

  test('no note changes for a runner on kilometres', () => {
    const changed = notes.filter(({ note }) => localiseParamNote(note, 'km') !== note)
    expect(changed.map(({ id }) => id)).toEqual([])
  })

  test('race classes are spelled 5K, 10K, 50K and 100K, never as a distance to convert', () => {
    const spelled = notes.filter(({ note }) => CLASS_AS_DISTANCE.test(note)).map(({ id }) => id)
    expect(spelled).toEqual([])
  })
})

describe('groupWarnings', () => {
  test('groups by code into one line with the messages as details', () => {
    const groups = groupWarnings(
      [
        warning('gain-ramp-soft', 'Climbing in the week of 2026-10-19 is 700 m.'),
        warning('spike-shortened', 'The run on 2026-10-20 is shortened.', { rules: ['g-1'] }),
        warning('gain-ramp-soft', 'Climbing in the week of 2026-10-26 is 800 m.'),
        warning('gain-ramp-soft', 'Climbing in the week of 2026-11-02 is 900 m.', {
          rules: ['H4', 'g-1'],
        }),
      ],
      'km',
    )
    expect(groups).toHaveLength(2)
    expect(groups[0]).toMatchObject({
      code: 'gain-ramp-soft',
      summary: 'Climbing above the 10% step in 3 weeks',
      details: [
        'Climbing in the week of 19 Oct is 700 m.',
        'Climbing in the week of 26 Oct is 800 m.',
        'Climbing in the week of 2 Nov is 900 m.',
      ],
      rules: ['H4', 'g-1'],
    })
    expect(groups[1]).toMatchObject({
      code: 'spike-shortened',
      summary: 'The run on 20 Oct is shortened.',
    })
  })

  test('sums several soft-step warnings without a figure of its own, as each message names its step', () => {
    const [group] = groupWarnings(
      [
        warning(
          'ramp-soft',
          'Running time in the week of 2026-10-19 is 150 min, above the 12% rebuild step toward 196 min on the highest of the previous 2 weeks (130 min). Keep it if it feels right.',
          { rules: ['g-2', 'g-8'] },
        ),
        warning(
          'ramp-soft',
          'Running time in the week of 2026-10-26 is 215 min, above a 10% step on the highest of the previous 2 weeks (190 min). Keep it if it feels right.',
          { rules: ['g-2'] },
        ),
      ],
      'km',
    )
    expect(group!.summary).toBe('Running time above the weekly step in 2 weeks')
    expect(group!.summary).not.toMatch(/\d+%/)
    expect(group!.details[0]).toContain('12% rebuild step')
    expect(group!.details[1]).toContain('a 10% step')
  })

  test('uses the strongest severity of the group', () => {
    const [group] = groupWarnings(
      [
        warning('x', 'a', { severity: 'info' }),
        warning('x', 'b', { severity: 'hold' }),
        warning('x', 'c', { severity: 'warn' }),
      ],
      undefined,
    )
    expect(group!.severity).toBe('hold')
  })

  test('a code without a summary keeps its first message and a count', () => {
    const [group] = groupWarnings([warning('other', 'First.'), warning('other', 'Second.')], 'km')
    expect(group!.summary).toBe('First. (and 1 more like it)')
  })

  test('localises a lone warning with the viewer units', () => {
    const [group] = groupWarnings(
      [warning('a', 'Climbing is 700 m in the week of 2026-10-19.')],
      'mi',
    )
    expect(group!.summary).toBe('Climbing is 2297 ft in the week of 19 Oct.')
  })
})

describe('ratingCounts', () => {
  test('an RPE or a feel counts for an activity of the planned kind', () => {
    expect(ratingCounts('completed', { rpe: 6, feel: null })).toBe(true)
    expect(ratingCounts('partial', { rpe: null, feel: 0 })).toBe(true)
    expect(ratingCounts('extended', { rpe: null, feel: null })).toBe(false)
  })

  test('only a feel counts for a different kind of activity', () => {
    expect(ratingCounts('modified', { rpe: 6, feel: null })).toBe(false)
    expect(ratingCounts('modified', { rpe: 6, feel: -1 })).toBe(true)
    expect(ratingCounts('modified', { rpe: null, feel: 0 })).toBe(true)
  })
})

describe('unratedEffortNote', () => {
  test('asks for a feel rating alone when the activity is of a different kind', () => {
    expect(unratedEffortNote(null, 'modified')).toBe(
      'Rate how this activity felt so the plan can adjust.',
    )
    expect(unratedEffortNote(null, 'completed')).toBe(
      'Rate this activity (effort or feel) so the plan can adjust.',
    )
  })

  test('adds the caveat only where there is a score to call a guess', () => {
    expect(unratedEffortNote(1, 'completed')).toMatch(/low-confidence guess/)
    expect(unratedEffortNote(null, 'completed')).not.toMatch(/low-confidence guess/)
  })
})

describe('assessmentLines', () => {
  const BAND: readonly [number, number] = [2, 3]
  const sentence = (id: keyof typeof EXECUTION_TEMPLATES, slots: Record<string, unknown> = {}) =>
    render(EXECUTION_TEMPLATES[id], slots as never, 'km')
  const count = (n: number) => ({ kind: 'count', n }) as const
  const quoted = (rpe: number) =>
    sentence('execution.effort-harder-rpe', { rpe: count(rpe), low: count(2), high: count(3) })
  /** An assessment of a session whose band is 2 to 3 (middle 2.5), rated as given. */
  const assessment = (
    lines: string[],
    rating: { rpe?: number; feel?: number } = {},
    score: ExecutionAssessment['effort']['score'] = 1,
  ): ExecutionAssessment => ({
    completion: 'completed',
    intensity: 'on',
    effort: {
      score,
      confidence: 'low',
      parts: {
        rpeDelta: rating.rpe === undefined ? null : rating.rpe - 2.5,
        feel: rating.feel ?? null,
        hrResidualZ: 1.4,
        paceResidualPct: null,
      },
    },
    conditions: { wbgtC: null, heatAdjusted: false, gradeAdjusted: false },
    flags: [],
    lines,
  })
  const PLANNED = '54 min against 60 min planned (90%).'
  const ON = sentence('execution.intensity-on')

  test('keeps the sentences that are not about effort, whatever the rating', () => {
    const lines = [PLANNED, ON, sentence('execution.hr-unqualified')]
    expect(assessmentLines(assessment(lines), BAND)).toEqual(lines)
    expect(assessmentLines(assessment(lines, { rpe: 3 }), BAND)).toEqual(lines)
  })

  test('drops the effort sentence of a run with no rating', () => {
    const lines = [PLANNED, ON, sentence('execution.effort-harder')]
    expect(assessmentLines(assessment(lines), BAND)).toEqual([PLANNED, ON])
  })

  test('drops a harder verdict beside an RPE inside the band, quoted RPE and all', () => {
    for (const rpe of [2, 3]) {
      const lines = [PLANNED, quoted(rpe)]
      expect(assessmentLines(assessment(lines, { rpe }), BAND), `RPE ${String(rpe)}`).toEqual([
        PLANNED,
      ])
    }
  })

  test('drops a harder verdict beside a feel of 0, or below it', () => {
    const lines = [PLANNED, sentence('execution.effort-harder')]
    expect(assessmentLines(assessment(lines, { feel: 0 }), BAND)).toEqual([PLANNED])
    expect(assessmentLines(assessment(lines, { feel: -1 }), BAND)).toEqual([PLANNED])
  })

  test('keeps a harder verdict, quoting the RPE, when the RPE is above the band', () => {
    const lines = [PLANNED, quoted(5)]
    expect(assessmentLines(assessment(lines, { rpe: 5 }), BAND)).toEqual(lines)
  })

  test('keeps a harder verdict when the feel is above 0', () => {
    const lines = [PLANNED, sentence('execution.effort-much-harder')]
    expect(assessmentLines(assessment(lines, { feel: 2 }, 2), BAND)).toEqual(lines)
  })

  test('says a verdict only the feel supports without the RPE that does not', () => {
    // the RPE is inside the band, the feel is above 0: harder, in the sentence that quotes no RPE
    const lines = [PLANNED, quoted(3)]
    expect(assessmentLines(assessment(lines, { rpe: 3, feel: 1 }), BAND)).toEqual([
      PLANNED,
      sentence('execution.effort-harder'),
    ])
  })

  test('keeps an easier verdict when the RPE is below the band or the feel below 0, and drops it otherwise', () => {
    const lines = [PLANNED, sentence('execution.effort-easier')]
    expect(assessmentLines(assessment(lines, { rpe: 1 }, -1), BAND)).toEqual(lines)
    expect(assessmentLines(assessment(lines, { feel: -1 }, -1), BAND)).toEqual(lines)
    expect(assessmentLines(assessment(lines, { rpe: 2 }, -1), BAND)).toEqual([PLANNED])
    expect(assessmentLines(assessment(lines, { feel: 0 }, -1), BAND)).toEqual([PLANNED])
    expect(assessmentLines(assessment(lines, { feel: 1 }, -1), BAND)).toEqual([PLANNED])
  })

  test('keeps "as expected" for an RPE inside the band or a feel of 0, and drops it otherwise', () => {
    const lines = [PLANNED, sentence('execution.effort-matched')]
    expect(assessmentLines(assessment(lines, { rpe: 2 }, 0), BAND)).toEqual(lines)
    expect(assessmentLines(assessment(lines, { feel: 0 }, 0), BAND)).toEqual(lines)
    expect(assessmentLines(assessment(lines, { rpe: 6 }, 0), BAND)).toEqual([PLANNED])
    expect(assessmentLines(assessment(lines, {}, 0), BAND)).toEqual([PLANNED])
  })

  test('reads the RPE from the band it is given, so a session with another band is read against it', () => {
    // RPE 7 is above the band of an easy run and inside the band of intervals
    const lines = [PLANNED, quoted(7)]
    expect(assessmentLines(assessment(lines, { rpe: 7 }), BAND)).toEqual(lines)
    const intervals = assessment(lines, { rpe: 7 })
    intervals.effort.parts.rpeDelta = 7 - 7.5
    expect(assessmentLines(intervals, [7, 8])).toEqual([PLANNED])
  })

  test('with no band there is no RPE to read, and only the feel can support a verdict', () => {
    const lines = [PLANNED, sentence('execution.effort-harder')]
    expect(assessmentLines(assessment(lines, { rpe: 8 }), null)).toEqual([PLANNED])
    expect(assessmentLines(assessment(lines, { feel: 1 }), null)).toEqual(lines)
  })

  test('names every effort sentence of the registry, so a new one is not shown unchecked', () => {
    const ids = Object.keys(EXECUTION_TEMPLATES).filter((id) => id.startsWith('execution.effort-'))
    expect(ids).toHaveLength(7)
    // each is dropped when no rating stands behind it (a sentence the helper did not know would stay)
    for (const id of ids) {
      const key = id as keyof typeof EXECUTION_TEMPLATES
      const quotes = Object.keys(EXECUTION_TEMPLATES[key].slots).length > 0
      const line = sentence(key, quotes ? { rpe: count(5), low: count(2), high: count(3) } : {})
      expect(assessmentLines(assessment([line]), BAND), id).toEqual([])
    }
  })
})
