// The words of the distance estimate (STATUS follow-up 17): an estimate, never a target, in the
// runner's units, at the precision an estimate deserves.
import { describe, expect, test } from 'vitest'
import {
  DISTANCE_ESTIMATE_TEMPLATES,
  estimateAboutText,
  estimateQuantity,
  estimateText,
  nextWithEstimateText,
  weekStripEstimateText,
} from '../../../shared/copy/distanceEstimate.ts'
import { briefKeySession, renderBriefLine } from '../../../shared/copy/briefRender.ts'
import { lintText } from '../../../shared/copy/lint.ts'
import { render, sampleSlots, type Template } from '../../../shared/copy/template.ts'
import { TEMPLATES } from '../../../shared/copy/templates.ts'
import { milesToM } from '../../../shared/units.ts'

const ids = Object.keys(DISTANCE_ESTIMATE_TEMPLATES) as Array<
  keyof typeof DISTANCE_ESTIMATE_TEMPLATES
>

describe('estimate templates', () => {
  test('are in the registry the copy-lint test renders', () => {
    expect(ids.length).toBeGreaterThan(0)
    for (const id of ids) {
      expect(id.startsWith('estimate.'), id).toBe(true)
      expect(TEMPLATES[id], id).toBe(DISTANCE_ESTIMATE_TEMPLATES[id])
    }
  })

  test.each(ids)('%s renders clean in both unit systems', (id) => {
    const template: Template = DISTANCE_ESTIMATE_TEMPLATES[id]
    for (const units of ['km', 'mi'] as const) {
      const text = render(template, sampleSlots(template), units)
      expect(lintText(text), `${id}: ${text}`).toEqual([])
    }
  })

  test('word an estimate: "about", and never a target, a goal or a comparison', () => {
    for (const id of ids) {
      const text = DISTANCE_ESTIMATE_TEMPLATES[id].text
      expect(text, id).toMatch(/\babout\b/)
      expect(text, id).not.toMatch(/target|goal|short of|on track/i)
    }
  })
})

describe('estimateQuantity', () => {
  test('reads to the half unit below five and to the whole unit from there', () => {
    const km = (m: number) => estimateQuantity(m, 'km').m / 1000
    expect(km(2_400)).toBe(2.5)
    expect(km(2_700)).toBe(2.5)
    expect(km(3_300)).toBe(3.5)
    expect(km(4_700)).toBe(4.5)
    expect(km(4_800)).toBe(5)
    expect(km(9_863)).toBe(10)
    expect(km(16_800)).toBe(17)
    const mi = (m: number) => estimateQuantity(m, 'mi').m / milesToM(1)
    expect(mi(milesToM(6.13))).toBe(6)
    expect(mi(milesToM(3.3))).toBeCloseTo(3.5, 10)
  })

  test('never reads less than a half unit', () => {
    expect(estimateQuantity(120, 'km').m).toBe(500)
    expect(estimateQuantity(40, 'mi').m / milesToM(1)).toBeCloseTo(0.5, 10)
  })
})

describe('estimateText', () => {
  test('names the easy pace for a run led by heart rate or effort', () => {
    const easy = { distanceM: 14_480, basis: 'easy' } as const
    expect(estimateText(easy, 'km')).toBe('about 14 km at your easy pace')
    expect(estimateText(easy, 'mi')).toBe('about 9 mi at your easy pace')
  })

  test('is the figure alone for a session with a pace target of its own', () => {
    const paced = { distanceM: 10_932, basis: 'pace' } as const
    expect(estimateText(paced, 'km')).toBe('about 11 km')
    expect(estimateText(paced, 'mi')).toBe('about 7 mi')
  })

  test('keeps a short run to the half unit, as the runner’s units write it', () => {
    expect(estimateText({ distanceM: 3_300, basis: 'easy' }, 'km')).toBe(
      'about 3.5 km at your easy pace',
    )
    expect(estimateText({ distanceM: milesToM(2.2), basis: 'easy' }, 'mi')).toBe(
      'about 2 mi at your easy pace',
    )
  })

  test('says nothing a lint would flag', () => {
    for (const units of ['km', 'mi'] as const) {
      for (const basis of ['easy', 'pace'] as const) {
        expect(lintText(estimateText({ distanceM: 9_000, basis }, units))).toEqual([])
      }
    }
  })
})

describe('the other lines', () => {
  test('a week, a session where the pace need not be named, and the week strip', () => {
    expect(estimateAboutText(30_500, 'km')).toBe('about 31 km')
    expect(estimateAboutText(30_500, 'mi')).toBe('about 19 mi')
    expect(weekStripEstimateText(30_500, 'km')).toBe("The week's planned runs come to about 31 km.")
    expect(weekStripEstimateText(30_500, 'mi')).toBe("The week's planned runs come to about 19 mi.")
  })

  test('the next session on Today', () => {
    const next = { date: '2026-10-22', title: 'Long run', durationMin: 90 }
    expect(nextWithEstimateText(next, 16_200, 'km')).toBe(
      'Next: Thu 22 Oct, Long run, 90 min, about 16 km.',
    )
    expect(nextWithEstimateText(next, 16_200, 'mi')).toBe(
      'Next: Thu 22 Oct, Long run, 90 min, about 10 mi.',
    )
  })
})

describe('one figure, every wording', () => {
  // The hero, the session sheet, the day card, the next line, the week row and strip, the brief
  // page and the brief line all word the figure they were sent. They must read the same number.
  const figure = /about ([0-9.]+ (?:mi|km|m))\b/

  test.each([800, 2_400, 4_900, 5_100, 9_863, 21_097, 42_195, 160_934])(
    'reads %i m the same on every surface, in both unit systems',
    (distanceM) => {
      for (const units of ['km', 'mi'] as const) {
        const estimate = { distanceM, basis: 'easy' } as const
        const key = {
          sessionId: 's1',
          externalId: null,
          date: '2026-10-24',
          kind: 'long' as const,
          durationMin: 105,
          distanceM: null,
          gainM: null,
          distanceEstimate: estimate,
          target: {
            zone: 'z1' as const,
            mode: 'effort' as const,
            hrCeiling: null,
            hrRange: null,
            paceSecPerKm: null,
            rpe: [2, 3] as [number, number],
            hot: false,
          },
        }
        const wordings = [
          estimateText(estimate, units),
          estimateAboutText(distanceM, units),
          weekStripEstimateText(distanceM, units),
          nextWithEstimateText(
            { date: '2026-10-22', title: 'Long run', durationMin: 90 },
            distanceM,
            units,
          ),
          briefKeySession(key, units)!.line,
          renderBriefLine(
            {
              changeCount: 1,
              nextKey: { date: '2026-10-24', kind: 'long', distanceEstimate: estimate },
            },
            units,
          ),
        ]
        const read = wordings.map((text) => figure.exec(text)?.[1])
        expect(new Set(read).size, wordings.join(' | ')).toBe(1)
        expect(read[0]).toBeDefined()
      }
    },
  )
})
