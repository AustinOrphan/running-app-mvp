import { describe, expect, test } from 'vitest'
import { assertCleanCopy } from '../../../shared/copy/lint.ts'
import {
  NOT_MATCHED_NOTE_PCT,
  SURFACE_CREDIT,
  SURFACE_TEMPLATES,
  surfaceLine,
} from '../../../shared/copy/surface.ts'
import { render } from '../../../shared/copy/template.ts'
import { SURFACE_VERSION } from '../../../shared/domain/surface.ts'
import type { SurfaceBins } from '../../../shared/types.ts'

const bins = (over: Partial<SurfaceBins>): SurfaceBins => ({
  v: SURFACE_VERSION,
  trailM: 0,
  pavedM: 0,
  roadM: 0,
  unknownM: 0,
  ...over,
})

describe('surfaceLine', () => {
  test('is the three shares of the matched route', () => {
    expect(surfaceLine(bins({ trailM: 6200, pavedM: 1000, roadM: 2800 }))).toEqual({
      line: 'Trail 62 % · paved path 10 % · road 28 %',
      unmatchedPct: null,
    })
  })

  test('shares add up to 100 whatever the rounding', () => {
    const { line } = surfaceLine(bins({ trailM: 1000, pavedM: 1000, roadM: 1000 }))!
    const total = [...line.matchAll(/(\d+) %/g)].reduce((sum, m) => sum + Number(m[1]), 0)
    expect(total).toBe(100)
  })

  test('leaves out a kind with no share, and starts with a capital whichever kind leads', () => {
    expect(surfaceLine(bins({ pavedM: 400, roadM: 600 }))!.line).toBe('Paved path 40 % · road 60 %')
    expect(surfaceLine(bins({ roadM: 600 }))!.line).toBe('Road 100 %')
    expect(surfaceLine(bins({ trailM: 600 }))!.line).toBe('Trail 100 %')
  })

  test('leaves the unmatched stretches out of the shares', () => {
    const result = surfaceLine(bins({ trailM: 500, roadM: 500, unknownM: 100 }))!
    expect(result.line).toBe('Trail 50 % · road 50 %')
    expect(result.unmatchedPct).toBeNull()
  })

  test('names the unmatched share only when it is over 20 %', () => {
    expect(NOT_MATCHED_NOTE_PCT).toBe(20)
    expect(surfaceLine(bins({ trailM: 800, unknownM: 200 }))!.unmatchedPct).toBeNull()
    expect(surfaceLine(bins({ trailM: 750, unknownM: 250 }))!.unmatchedPct).toBe(25)
  })

  test('says nothing when nothing was matched', () => {
    expect(surfaceLine(bins({}))).toBeNull()
    expect(surfaceLine(bins({ unknownM: 1000 }))).toBeNull()
  })

  test('passes the G5 lint', () => {
    assertCleanCopy(surfaceLine(bins({ trailM: 6200, pavedM: 1000, roadM: 2800 }))!.line, 'line')
    assertCleanCopy(SURFACE_CREDIT, 'credit')
  })
})

describe('SURFACE_TEMPLATES', () => {
  test('say what is sent, and credit OpenStreetMap', () => {
    expect(render(SURFACE_TEMPLATES['surface.sent'], {}, 'km')).toBe(
      'One request to OpenStreetMap with a box of about 40 × 40 km around where you run. No run or route is sent.',
    )
    expect(SURFACE_CREDIT).toBe('Map data © OpenStreetMap contributors')
  })

  test('every template renders clean copy', () => {
    for (const [id, template] of Object.entries(SURFACE_TEMPLATES)) {
      const slots = Object.fromEntries(Object.keys(template.slots).map((name) => [name, '12']))
      assertCleanCopy(render(template as never, slots as never, 'km'), id)
    }
  })
})
