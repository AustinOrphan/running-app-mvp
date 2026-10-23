import { describe, expect, test } from 'vitest'
import { lintText } from '../../../shared/copy/lint.ts'
import { render, sampleSlots, type Template } from '../../../shared/copy/template.ts'
import { renderFact, TEMPLATES } from '../../../shared/copy/templates.ts'
import { raceEstimateSlots, TODAY_TEMPLATES } from '../../../shared/copy/today.ts'
import { P } from '../../../shared/engine/params/index.ts'
import { rangeLabel } from '../../../shared/engine/predict.ts'
import type { ReadinessVerdict, WeekStripMark } from '../../../shared/types.ts'
import { formatEstimate } from '../../../shared/units.ts'

const ids = Object.keys(TODAY_TEMPLATES) as Array<keyof typeof TODAY_TEMPLATES>
const hms = (h: number, m = 0, sec = 0) => h * 3600 + m * 60 + sec

describe('Today templates', () => {
  test('are in the registry the copy-lint test renders', () => {
    expect(ids.length).toBeGreaterThan(0)
    for (const id of ids) {
      expect(id.startsWith('today.'), id).toBe(true)
      expect(TEMPLATES[id], id).toBe(TODAY_TEMPLATES[id])
    }
  })

  test.each(ids)('%s renders clean in both unit systems', (id) => {
    const template: Template = TODAY_TEMPLATES[id]
    for (const units of ['km', 'mi'] as const) {
      const text = render(template, sampleSlots(template), units)
      expect(lintText(text), `${id}: ${text}`).toEqual([])
    }
  })

  test('the verdicts read as the design words them', () => {
    const verdicts: Record<ReadinessVerdict['code'], string> = {
      ready: 'Ready as planned.',
      'low-stays': "Signals are a little low. Today's session is already easy, so it stays.",
      'low-plan-stays': 'Signals are a little low. The plan stays as it is.',
      easy: 'An easy run is the better choice today.',
      rest: 'A rest day is the better choice today.',
      'lighter-week': 'Recent signals have stayed low for several days. A lighter week may help.',
      'no-signals': 'No readiness signals yet. One tap below adds the first.',
    }
    for (const [code, sentence] of Object.entries(verdicts)) {
      expect(renderFact({ template: `today.verdict.${code}`, slots: {} }, 'km')).toBe(sentence)
    }
  })

  test('a sentence that restates a rule number takes it from the Params', () => {
    const building = renderFact(
      {
        template: 'today.signal.hrv-building',
        slots: {
          readings: { kind: 'count', n: 7 },
          needed: { kind: 'count', n: P.j4.minReadings.value },
        },
      },
      'km',
    )
    expect(building).toBe(
      `Building your usual HRV range (7 of ${String(P.j4.minReadings.value)} readings).`,
    )
    const sleep = renderFact(
      {
        template: 'today.signal.sleep-low',
        slots: {
          hours: { kind: 'duration', sec: 5.5 * 3600 },
          nights: { kind: 'count', n: P.j5.sleepWarnNights.value },
          floor: { kind: 'duration', sec: P.j5.sleepWarnHours.value * 3600 },
        },
      },
      'km',
    )
    expect(sleep).toBe(
      `Sleep averaged 5 h 30 min across ${String(P.j5.sleepWarnNights.value)} recent nights, under ${String(P.j5.sleepWarnHours.value)} h.`,
    )
  })
})

describe('race countdown copy', () => {
  const prediction = {
    lowSec: hms(27, 41, 30),
    predictedSec: hms(31, 52, 40),
    highSec: hms(36, 18, 5),
  }

  test('prints the finish range and its middle as the design words them', () => {
    expect(
      renderFact({ template: 'today.race.estimate', slots: raceEstimateSlots(prediction) }, 'km'),
    ).toBe('Finish estimate 27 h 40 min to 36 h 20 min, most likely about 31 h 50 min.')
  })

  test('rounds the way formatEstimate does, for a short race too', () => {
    const marathon = {
      lowSec: hms(3, 33, 14),
      predictedSec: hms(3, 47, 12),
      highSec: hms(4, 1, 40),
    }
    const sentence = renderFact(
      { template: 'today.race.estimate', slots: raceEstimateSlots(marathon) },
      'mi',
    )
    expect(sentence).toBe(
      `Finish estimate ${formatEstimate(marathon.lowSec)} to ${formatEstimate(marathon.highSec)}, most likely about ${formatEstimate(marathon.predictedSec)}.`,
    )
    expect(sentence).toBe('Finish estimate 3 h 33 min to 4 h 2 min, most likely about 3 h 47 min.')
  })

  test("says the range is wide on purpose, with the distance in the runner's units and the grade", () => {
    const label = rangeLabel({ distanceM: 160934 })
    expect(label.wide).toBe(true)
    const slots = { distance: { kind: 'distance', m: 160934 }, grade: label.grade } as const
    expect(renderFact({ template: 'today.race.wide', slots }, 'mi')).toBe(
      'The range is wide on purpose. Predictions for 100 mi rest on thin evidence (grade D).',
    )
    expect(renderFact({ template: 'today.race.wide', slots }, 'km')).toBe(
      'The range is wide on purpose. Predictions for 160.9 km rest on thin evidence (grade D).',
    )
  })
})

describe('week strip names', () => {
  test('every mark has a name, and the past planned day is not called a miss', () => {
    const names: Record<WeekStripMark, string> = {
      done: 'Done',
      partial: 'Partly done',
      skipped: 'Skipped',
      planned: 'Planned',
      unlogged: 'Planned, no run logged',
      free: 'No run planned',
    }
    for (const [mark, name] of Object.entries(names)) {
      const template = `today.week.${mark}`
      expect(TEMPLATES[template as keyof typeof TEMPLATES].shape).toBe('label')
      expect(renderFact({ template, slots: {} }, 'km')).toBe(name)
      expect(lintText(name), name).toEqual([])
    }
  })
})

describe('hero copy', () => {
  const say = (template: string, slots: Record<string, unknown>, units: 'km' | 'mi' = 'mi') =>
    renderFact({ template, slots: slots as never }, units)

  test('the targets read as the design words them', () => {
    expect(say('today.target.hr-ceiling', { limit: { kind: 'bpm', bpm: 149 } })).toBe(
      'under 149 bpm',
    )
    expect(say('today.target.pace-guide', { range: '9:20 to 10:28 /mi' })).toBe(
      'about 9:20 to 10:28 /mi',
    )
    expect(say('today.target.effort', { range: '3 to 4' })).toBe('3 to 4 out of 10')
    expect(say('today.target.note-pace-guide', {})).toBe('Effort and heart rate come first.')
    expect(say('today.target.note-hot-effort', {})).toBe('Go by this today.')
    expect(say('today.target.note-hot-hr', {})).toBe('It runs high in heat.')
  })

  test('the cooler start names the hour and the index then and at the peak', () => {
    const slots = {
      time: '06:00',
      then: { kind: 'temp', c: 17 },
      peak: { kind: 'temp', c: 25 },
      hour: '15:00',
    }
    expect(say('today.cooler.wbgt', slots)).toBe(
      'Cooler start: 06:00. WBGT about 17 °C then, 25 °C around 15:00.',
    )
    expect(say('today.cooler.air', { time: '06:00', then: { kind: 'temp', c: 17 } })).toBe(
      'Cooler start: 06:00. Air temperature about 17 °C then.',
    )
  })

  test('an eased or rested day keeps the planned session in view', () => {
    const planned = { title: 'Threshold', duration: { kind: 'minutes', min: 50 } }
    expect(say('today.hero.planned', planned)).toBe('Planned: Threshold, 50 min')
    expect(say('today.hero.planned-not-today', planned)).toBe(
      'Planned: Threshold, 50 min. Not today.',
    )
    expect(say('today.hero.rest-day', {})).toBe('Rest day.')
  })

  test('the week reads in minutes a day, without a minimum', () => {
    expect(say('today.week.advisory', { perDay: { kind: 'minutes', min: 34 } })).toBe(
      '34 min a day left, through Sunday',
    )
    expect(
      say('today.week.day-logged', {
        weekday: { kind: 'weekday', iso: '2026-03-16', style: 'long' },
        date: { kind: 'date', iso: '2026-03-16', style: 'short' },
        mark: 'Done',
        logged: { kind: 'minutes', min: 40 },
      }),
    ).toBe('Monday 16 Mar, Done, 40 min logged')
  })
})
