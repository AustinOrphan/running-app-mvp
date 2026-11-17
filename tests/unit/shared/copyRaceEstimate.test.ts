// The one text of the goal-race estimate (PF1): the same words on Today, the Race plan, Goals and
// My paces, rounded by `roundEstimateSec`, with the A6 "at most" wording for a floor from training
// and no raw method id anywhere.
import { describe, expect, test } from 'vitest'
import { lintText } from '../../../shared/copy/lint.ts'
import {
  describeEstimate,
  estimateBasis,
  isTrainingBasisCondition,
  METHOD_WORDS,
  methodWords,
  RACE_ESTIMATE_TEMPLATES,
  raceEstimateSlots,
} from '../../../shared/copy/raceEstimate.ts'
import { render, sampleSlots, type Template } from '../../../shared/copy/template.ts'
import { TEMPLATES } from '../../../shared/copy/templates.ts'
import { CS_METHODS } from '../../../shared/engine/predict.ts'
import { formatEstimate } from '../../../shared/units.ts'

const ids = Object.keys(RACE_ESTIMATE_TEMPLATES) as Array<keyof typeof RACE_ESTIMATE_TEMPLATES>
const hms = (h: number, m = 0, sec = 0) => h * 3600 + m * 60 + sec

// A 100-mile estimate as the engine gives it, with seconds the display rounds away.
const hundred = {
  lowSec: hms(27, 41, 30),
  predictedSec: hms(32, 20, 31),
  highSec: hms(36, 18, 5),
}
const marathon = { lowSec: hms(3, 33, 14), predictedSec: hms(3, 47, 12), highSec: hms(4, 1, 40) }

describe('race estimate templates', () => {
  test('are in the registry the copy-lint test renders', () => {
    for (const id of ids) {
      expect(id.startsWith('race-estimate.'), id).toBe(true)
      expect(TEMPLATES[id], id).toBe(RACE_ESTIMATE_TEMPLATES[id])
    }
  })

  test.each(ids)('%s renders clean in both unit systems', (id) => {
    const template: Template = RACE_ESTIMATE_TEMPLATES[id]
    for (const units of ['km', 'mi'] as const) {
      const text = render(template, sampleSlots(template), units)
      expect(lintText(text), `${id}: ${text}`).toEqual([])
    }
  })
})

describe('describeEstimate', () => {
  test('words a 100-mile estimate at the rounding of ten minutes, never to the second', () => {
    const text = describeEstimate(hundred, 'mi')
    expect(text.figure).toBe('32 h 20 min')
    expect(text.span).toBe('27 h 40 min to 36 h 20 min')
    expect(text.summary).toBe(
      'Finish estimate 27 h 40 min to 36 h 20 min, most likely about 32 h 20 min.',
    )
    expect(text.label).toBe('Time')
    expect(text.note).toBeNull()
    expect(text.basis).toBe('likely')
    expect(JSON.stringify(text)).not.toMatch(/:\d\d:\d\d/)
  })

  test('words a marathon at the rounding of a minute, as formatEstimate does', () => {
    const text = describeEstimate(marathon, 'km')
    expect(text.summary).toBe(
      `Finish estimate ${formatEstimate(marathon.lowSec)} to ${formatEstimate(marathon.highSec)}, most likely about ${formatEstimate(marathon.predictedSec)}.`,
    )
    expect(text.summary).toBe(
      'Finish estimate 3 h 33 min to 4 h 2 min, most likely about 3 h 47 min.',
    )
    expect(text.figure).toBe('3 h 47 min')
  })

  test('says "at most" and the basis for a time from training (A6), without "a race or"', () => {
    const text = describeEstimate({ ...hundred, trainingSince: '2026-08-11' }, 'km')
    expect(text.basis).toBe('at-most')
    expect(text.label).toBe('Time, at most')
    expect(text.summary).toBe(
      'At most about 32 h 20 min. Finish estimate 27 h 40 min to 36 h 20 min.',
    )
    expect(text.note).toBe(
      'It rests on your best efforts in training since 11 Aug, not on races. A short test would likely show faster.',
    )
    expect(text.note).not.toMatch(/a race or/i)
    expect(lintText(text.note ?? '')).toEqual([])
  })

  test('says a time from older training is no "at most" and may be stale (A6)', () => {
    const text = describeEstimate(
      { ...hundred, trainingSince: '2026-06-01', trainingWidened: true },
      'km',
    )
    expect(text.basis).toBe('widened')
    expect(text.label).toBe('Time, from training')
    expect(text.summary).not.toMatch(/At most/)
    expect(text.note).toMatch(/^From your best efforts in training since 1 Jun, some older/)
    expect(text.note).toMatch(/A short test narrows it\.$/)
  })

  test('reads a null or absent trainingSince as a time from races or a test', () => {
    expect(estimateBasis({ ...marathon, trainingSince: null })).toBe('likely')
    expect(estimateBasis({ ...marathon })).toBe('likely')
    expect(
      estimateBasis({ ...marathon, trainingSince: '2026-08-11', trainingWidened: false }),
    ).toBe('at-most')
  })

  test('rounds the slots the way every surface reads them', () => {
    const slots = raceEstimateSlots(hundred)
    expect(slots.likely.sec).toBe(hms(32, 20))
    expect(slots.low.sec).toBe(hms(27, 40))
    expect(slots.high.sec).toBe(hms(36, 20))
  })
})

describe('method words', () => {
  test('every method the engine names has plain words, and the CS methods are named as such', () => {
    for (const id of CS_METHODS) expect(METHOD_WORDS[id], id).toBeTruthy()
    for (const id of ['personal-exponent', 'riegel', 'same-distance', 'single-anchor']) {
      expect(METHOD_WORDS[id], id).toBeTruthy()
    }
  })

  test('word a combined method without any id', () => {
    expect(methodWords('cs-fraction')).toBe('a share of your critical speed for long events')
    expect(methodWords('riegel+critical-speed')).toBe(
      'a recent race scaled to this distance and your critical speed',
    )
    expect(methodWords('cs-fraction')).not.toMatch(/cs-fraction/)
  })

  test('an id with no words reads as no id', () => {
    expect(methodWords('made-up-method')).not.toMatch(/made-up/)
  })
})

describe('the engine sentence for the training basis', () => {
  test('is recognised so a page can leave it to the estimate text', () => {
    expect(
      isTrainingBasisCondition(
        'Critical speed comes from the best efforts in training since 2026-08-11, not from races or a short test, so it is a floor.',
      ),
    ).toBe(true)
    expect(isTrainingBasisCondition('Trail course: road models explain trail less well.')).toBe(
      false,
    )
  })
})
