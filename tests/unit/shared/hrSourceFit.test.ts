import { describe, expect, test } from 'vitest'
import { fitHrSource, parseFit } from '../../../shared/importers/files/fit.ts'
import { buildFit } from '../../fixtures/fit/buildFit.ts'

const START = Date.UTC(2026, 0, 5, 7, 0, 0) / 1000
const OPTS = { timezone: 'UTC' }
const sessions = [
  {
    sport: 1,
    startUnix: START,
    durationSec: 20,
    records: [
      { t: 0, distanceM: 0, hr: 140 },
      { t: 20, distanceM: 60, hr: 142 },
    ],
  },
]

describe('the heart-rate source of a FIT file', () => {
  test('is a strap when the file lists an ANT+ or Bluetooth heart-rate device', () => {
    const ant = buildFit({
      productName: 'Example Watch 100',
      deviceInfos: [{ deviceIndex: 1, deviceType: 120, sourceType: 1 }],
      sessions,
    })
    expect(parseFit(ant, OPTS)[0]!.hrSource).toBe('strap')
    expect(fitHrSource(ant)).toBe('strap')
    const ble = buildFit({
      productName: 'Example Watch 100',
      deviceInfos: [{ deviceIndex: 2, deviceType: 1, sourceType: 3 }],
      sessions,
    })
    expect(parseFit(ble, OPTS)[0]!.hrSource).toBe('strap')
  })

  test('is wrist when the file lists devices and none is a heart-rate sensor', () => {
    const watchOnly = buildFit({ productName: 'Example Watch 100', sessions })
    expect(parseFit(watchOnly, OPTS)[0]!.hrSource).toBe('wrist')
    const bikeSensor = buildFit({
      productName: 'Example Watch 100',
      deviceInfos: [{ deviceIndex: 1, deviceType: 121, sourceType: 1 }],
      sessions,
    })
    expect(fitHrSource(bikeSensor)).toBe('wrist')
  })

  test('is unknown when the file lists no device', () => {
    const bare = buildFit({ sessions })
    expect(parseFit(bare, OPTS)[0]!.hrSource).toBe('unknown')
    expect(fitHrSource(bare)).toBe('unknown')
  })
})
