import { describe, expect, test, vi } from 'vitest'
import {
  fetchArchive,
  fetchClimateHours,
  fetchForecast,
  REQUEST_TIMEOUT_MS,
} from '../../../server/providers/openMeteo.ts'
import { fakeFetch } from '../../fakeFetch.ts'

const ARCHIVE = 'https://archive-api.open-meteo.com/v1/archive'
const FORECAST = 'https://api.open-meteo.com/v1/forecast'

/** Records the URL and the init of each call, then answers with `answer`. */
function recorder(answer: () => Response) {
  const calls: Array<{ url: URL; signal: AbortSignal | null }> = []
  const fetchFn: typeof fetch = (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    calls.push({ url, signal: init?.signal ?? null })
    return Promise.resolve(answer())
  }
  return { calls, fetchFn }
}

describe('fetchForecast and fetchArchive', () => {
  test('ask for GMT hours in km/h and parse them, rounding to one decimal', async () => {
    const { calls, fetchFn } = recorder(() =>
      Response.json({
        hourly: {
          time: ['2026-03-02T07:00', '2026-03-02T08:00'],
          temperature_2m: [12.34, 13.06],
          relative_humidity_2m: [55.4, 60.6],
          dew_point_2m: [4.04, 5.5],
          wind_speed_10m: [10.26, 12],
          shortwave_radiation: [812.46, null],
        },
      }),
    )

    const hours = await fetchForecast(fetchFn, { lat: 20.5, lng: -30.1, forecastDays: 7 })

    expect(calls).toHaveLength(1)
    const { url } = calls[0]!
    expect(`${url.origin}${url.pathname}`).toBe(FORECAST)
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      latitude: '20.5',
      longitude: '-30.1',
      forecast_days: '7',
      timezone: 'GMT',
      wind_speed_unit: 'kmh',
    })
    expect(url.searchParams.get('hourly')).toContain('dew_point_2m')
    // Radiation is what turns the air temperature into a WBGT.
    expect(url.searchParams.get('hourly')).toContain('shortwave_radiation')
    expect(hours).toEqual([
      {
        time: '2026-03-02T07:00:00Z',
        tempC: 12.3,
        dewPointC: 4,
        humidityPct: 55,
        windKph: 10.3,
        shortwaveWm2: 812.5,
      },
      {
        time: '2026-03-02T08:00:00Z',
        tempC: 13.1,
        dewPointC: 5.5,
        humidityPct: 61,
        windKph: 12,
        shortwaveWm2: null,
      },
    ])
  })

  test('the archive takes a date range; a missing or unusable value becomes null', async () => {
    const { calls, fetchFn } = recorder(() =>
      Response.json({
        hourly: {
          time: ['2026-03-02T07:00', 'not an hour', '2026-03-02T09:00'],
          temperature_2m: [10, 11, null],
          wind_speed_10m: [5],
        },
      }),
    )

    const hours = await fetchArchive(fetchFn, {
      lat: 1,
      lng: 2,
      start: '2026-03-02',
      end: '2026-03-03',
    })

    const { url } = calls[0]!
    expect(`${url.origin}${url.pathname}`).toBe(ARCHIVE)
    expect(url.searchParams.get('start_date')).toBe('2026-03-02')
    expect(url.searchParams.get('end_date')).toBe('2026-03-03')
    // The activity backfill does not ask for radiation.
    expect(url.searchParams.get('hourly')).not.toContain('shortwave_radiation')
    expect(hours).toEqual([
      {
        time: '2026-03-02T07:00:00Z',
        tempC: 10,
        dewPointC: null,
        humidityPct: null,
        windKph: 5,
        shortwaveWm2: null,
      },
      {
        time: '2026-03-02T09:00:00Z',
        tempC: null,
        dewPointC: null,
        humidityPct: null,
        windKph: null,
        shortwaveWm2: null,
      },
    ])
  })

  test('every request is cut off after REQUEST_TIMEOUT_MS: the signal fires then and a fetch that honours it rejects', async () => {
    expect(REQUEST_TIMEOUT_MS).toBe(20_000)
    vi.useFakeTimers()
    // `AbortSignal.timeout` runs on Node's own timer, which fake timers do not move; this stand-in
    // fires on the faked clock after the same number of milliseconds the provider asked for.
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockImplementation((ms) => {
      const controller = new AbortController()
      setTimeout(() => {
        controller.abort(new DOMException('The operation timed out.', 'TimeoutError'))
      }, ms)
      return controller.signal
    })
    try {
      const signals: AbortSignal[] = []
      // A fetch that hangs until its signal fires, as a stalled connection does.
      const hanging: typeof fetch = (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal
          if (!signal) return
          signals.push(signal)
          signal.addEventListener('abort', () => {
            reject(signal.reason as Error)
          })
        })
      const where = { lat: 1, lng: 2, start: '2025-06-01', end: '2025-06-03' }
      const reads = [
        fetchForecast(hanging, { lat: 1, lng: 2 }),
        fetchArchive(hanging, where),
        fetchClimateHours(hanging, where),
      ].map((read) =>
        read.then(
          () => 'answered',
          (error: unknown) => error,
        ),
      )

      expect(signals).toHaveLength(3)
      await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS - 1)
      expect(signals.map((signal) => signal.aborted)).toEqual([false, false, false])
      await vi.advanceTimersByTimeAsync(1)
      expect(signals.map((signal) => signal.aborted)).toEqual([true, true, true])
      for (const outcome of await Promise.all(reads)) {
        expect(outcome).toMatchObject({ name: 'TimeoutError' })
      }
      expect(timeout.mock.calls).toEqual([[20_000], [20_000], [20_000]])
    } finally {
      timeout.mockRestore()
      vi.useRealTimers()
    }
  })

  test.each([
    ['an error status', () => new Response('busy', { status: 503 }), /HTTP 503/],
    ['a body that is not JSON', () => new Response('<html>', { status: 200 }), /not JSON/],
    ['a body without hours', () => Response.json({ error: true }), /no hourly data/],
  ])('%s is an error', async (_label, answer, message) => {
    const { fetchFn } = recorder(answer)
    await expect(fetchForecast(fetchFn, { lat: 1, lng: 2 })).rejects.toThrow(message)
    await expect(
      fetchClimateHours(fetchFn, { lat: 1, lng: 2, start: '2025-06-01', end: '2025-06-03' }),
    ).rejects.toThrow(message)
  })

  test('goes only through the injected fetch', async () => {
    await expect(fetchForecast(fakeFetch({}), { lat: 1, lng: 2 })).rejects.toThrow(/no route/)
  })
})

describe('fetchClimateHours', () => {
  test('reads the place local time with radiation and keeps the values unrounded', async () => {
    const { calls, fetchFn } = recorder(() =>
      Response.json({
        hourly: {
          time: ['2025-06-01T06:00', '2025-06-01T07:00', 'broken'],
          temperature_2m: [18.26, 19.04, 1],
          relative_humidity_2m: [71.5, 69, 1],
          wind_speed_10m: [7.77, 8, 1],
          shortwave_radiation: [120.5, null, 1],
        },
      }),
    )

    const hours = await fetchClimateHours(fetchFn, {
      lat: 40.1,
      lng: -105.2,
      start: '2025-05-31',
      end: '2025-06-02',
    })

    const { url } = calls[0]!
    expect(`${url.origin}${url.pathname}`).toBe(ARCHIVE)
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      latitude: '40.1',
      longitude: '-105.2',
      start_date: '2025-05-31',
      end_date: '2025-06-02',
      timezone: 'auto',
      wind_speed_unit: 'kmh',
    })
    expect(url.searchParams.get('hourly')).toBe(
      'temperature_2m,relative_humidity_2m,wind_speed_10m,shortwave_radiation',
    )
    expect(hours).toEqual([
      {
        time: '2025-06-01T06:00',
        tempC: 18.26,
        humidityPct: 71.5,
        windKph: 7.77,
        shortwaveWm2: 120.5,
      },
      { time: '2025-06-01T07:00', tempC: 19.04, humidityPct: 69, windKph: 8, shortwaveWm2: null },
    ])
  })
})
