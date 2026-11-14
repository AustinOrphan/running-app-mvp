import { describe, expect, test } from 'vitest'
import { addDays } from '../../../shared/dates.ts'
import {
  painAreaKey,
  painReports,
  repeatPainPattern,
  sameArea,
  type PainCheckin,
  type PainWindow,
} from '../../../shared/domain/painArea.ts'
import { P } from '../../../shared/engine/params/index.ts'

const TODAY = '2026-11-14'
const back = (n: number) => addDays(TODAY, -n)
const day = (n: number, painArea: string | null, painScore: number | null = 2): PainCheckin => ({
  date: back(n),
  painArea,
  painScore,
})
const pattern = (wellness: PainCheckin[], windows: PainWindow[] = []) =>
  repeatPainPattern({ wellness, windows, date: TODAY })

describe('painAreaKey', () => {
  test('lower-cases, drops punctuation, sides and fillers, and keeps the region', () => {
    expect(painAreaKey('My LEFT calf is sore!')).toEqual({ key: 'calf', side: 'left' })
    expect(painAreaKey('  Right, shin  ')).toEqual({ key: 'shin', side: 'right' })
    expect(painAreaKey('tight in the hamstring')).toEqual({ key: 'hamstring', side: null })
  })

  test('reads the side words l, r, lt and rt', () => {
    expect(painAreaKey('L knee')?.side).toBe('left')
    expect(painAreaKey('knee rt')?.side).toBe('right')
    expect(painAreaKey('lt achilles')).toEqual({ key: 'achilles', side: 'left' })
  })

  test('maps the usual names of a region to one key', () => {
    for (const text of ['plantar', 'heel', 'arch', 'metatarsal', 'big toe', 'feet', 'forefoot']) {
      expect(painAreaKey(text)?.key, text).toBe('foot')
    }
    expect(painAreaKey('calves')?.key).toBe('calf')
    expect(painAreaKey('quads')?.key).toBe('quad')
    expect(painAreaKey('hammy')?.key).toBe('hamstring')
    expect(painAreaKey('lower back')?.key).toBe('back')
    expect(painAreaKey('kneecap')?.key).toBe('knee')
    expect(painAreaKey('ITB')?.key).toBe('it band')
  })

  test('the first region word gives the key', () => {
    expect(painAreaKey('calf near the achilles')?.key).toBe('calf')
  })

  test('a text with no region word keys on its remaining words, so it matches itself', () => {
    expect(painAreaKey('IT band')).toEqual({ key: 'it band', side: null })
    expect(painAreaKey('it band')).toEqual(painAreaKey('IT Band!'))
    expect(painAreaKey('Morton neuroma')?.key).toBe('morton neuroma')
    expect(sameArea(painAreaKey('morton neuroma')!, painAreaKey('Morton Neuroma')!)).toBe(true)
  })

  test('words that are all sides and fillers, and empty text, give no key', () => {
    expect(painAreaKey('my sore left')).toBeNull()
    expect(painAreaKey('')).toBeNull()
    expect(painAreaKey('   ')).toBeNull()
    expect(painAreaKey(null)).toBeNull()
    expect(painAreaKey(undefined)).toBeNull()
  })

  test('both sides in one text read as no side', () => {
    expect(painAreaKey('left and right knee')).toEqual({ key: 'knee', side: null })
  })
})

describe('sameArea', () => {
  const area = (text: string) => painAreaKey(text)!

  test('left and right of one region do not match', () => {
    expect(sameArea(area('left calf'), area('right calf'))).toBe(false)
    expect(sameArea(area('R shin'), area('left shin'))).toBe(false)
  })

  test('an unstated side matches either side, and the same side matches', () => {
    expect(sameArea(area('calf'), area('left calf'))).toBe(true)
    expect(sameArea(area('right calf'), area('calf'))).toBe(true)
    expect(sameArea(area('left calf'), area('Calf, left'))).toBe(true)
  })

  test('different regions do not match', () => {
    expect(sameArea(area('left calf'), area('left shin'))).toBe(false)
  })
})

describe('painReports', () => {
  test('lists check-ins at or above the Param score with an area, newest first, inside the range', () => {
    const min = P.pain.repeatMinScore.value
    const reports = painReports(
      [
        day(5, 'calf', min),
        day(3, 'calf', min - 1),
        day(2, null, 5),
        day(1, '  calf  ', min + 3),
        day(40, 'calf', 5),
      ],
      { from: back(7), to: TODAY },
    )
    expect(reports.map((report) => [report.date, report.score, report.text])).toEqual([
      [back(1), min + 3, 'calf'],
      [back(5), min, 'calf'],
    ])
  })

  test('a score of null or a missing score is no report', () => {
    const rows: PainCheckin[] = [day(1, 'calf', null), { date: back(2), painArea: 'calf' }]
    expect(painReports(rows, { from: back(7), to: TODAY })).toEqual([])
  })
})

describe('repeatPainPattern', () => {
  const days = P.pain.repeatDays.value

  test('the Params are the defaults the rule records', () => {
    expect([
      P.pain.repeatReports.value,
      days,
      P.pain.repeatMinScore.value,
      P.pain.repeatQuietDays.value,
    ]).toEqual([3, 7, 2, 7])
  })

  test('two reports are not a pattern, three are', () => {
    expect(pattern([day(0, 'left calf'), day(2, 'left calf')])).toBeNull()
    expect(pattern([day(0, 'left calf'), day(2, 'left calf'), day(4, 'left calf')])).toEqual({
      area: 'left calf',
      reports: 3,
      days,
      pain: 2,
    })
  })

  test('the days need not be consecutive, and the words may differ', () => {
    const found = pattern([day(0, 'Left calf'), day(3, 'my calf is tight'), day(6, 'calf (left)')])
    expect(found).toMatchObject({ reports: 3, area: 'Left calf' })
  })

  test('a score of 1 does not count and a score of 2 does', () => {
    const one = P.pain.repeatMinScore.value - 1
    expect(pattern([day(0, 'calf', one), day(1, 'calf', one), day(2, 'calf', one)])).toBeNull()
    expect(pattern([day(0, 'calf', 2), day(1, 'calf', 2), day(2, 'calf', 2)])).not.toBeNull()
    expect(pattern([day(0, 'calf', 2), day(1, 'calf', 2), day(2, 'calf', one)])).toBeNull()
  })

  test('a report outside the look-back is not counted', () => {
    expect(pattern([day(0, 'calf'), day(1, 'calf'), day(days, 'calf')])).toBeNull()
    expect(pattern([day(0, 'calf'), day(1, 'calf'), day(days - 1, 'calf')])).not.toBeNull()
  })

  test('different regions, or the two sides of one, are counted apart', () => {
    expect(pattern([day(0, 'left calf'), day(1, 'right calf'), day(2, 'left calf')])).toBeNull()
    expect(pattern([day(0, 'calf'), day(1, 'shin'), day(2, 'knee')])).toBeNull()
    // an unstated side joins whichever side it matches
    expect(pattern([day(0, 'left calf'), day(1, 'calf'), day(2, 'left calf')])).toMatchObject({
      reports: 3,
    })
  })

  test('takes the area with most reports, and the highest score among them', () => {
    const found = pattern([
      day(0, 'shin', 2),
      day(1, 'calf', 3),
      day(2, 'calf', 5),
      day(3, 'shin', 2),
      day(4, 'calf', 2),
      day(5, 'shin', 2),
      day(6, 'shin', 2),
    ])
    expect(found).toMatchObject({ area: 'shin', reports: 4, pain: 2 })
  })

  test('a window that ended inside the quiet days for the same area keeps it quiet', () => {
    const three = [day(0, 'left calf'), day(1, 'left calf'), day(2, 'left calf')]
    const ended = (daysAgo: number, area: string | null, reason = 'niggle'): PainWindow[] => [
      { reason, endDate: back(daysAgo), area },
    ]
    const quiet = P.pain.repeatQuietDays.value
    expect(pattern(three, ended(1, 'Left calf'))).toBeNull()
    expect(pattern(three, ended(quiet, 'calf'))).toBeNull()
    expect(pattern(three, ended(quiet + 1, 'calf'))).not.toBeNull()
    // a window with no area counts as the same area
    expect(pattern(three, ended(2, null))).toBeNull()
    // another area, the other side, or another reason does not
    expect(pattern(three, ended(2, 'right calf'))).not.toBeNull()
    expect(pattern(three, ended(2, 'shin'))).not.toBeNull()
    expect(pattern(three, ended(2, 'left calf', 'travel'))).not.toBeNull()
  })

  test('no check-ins, or none with an area, give no pattern', () => {
    expect(pattern([])).toBeNull()
    expect(pattern([day(0, null), day(1, ''), day(2, '  ')])).toBeNull()
  })
})
