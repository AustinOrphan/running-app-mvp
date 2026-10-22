// Stub from the data-foundation scaffold; Task D4 implements it.
import type { Deps } from '../app.ts'

export interface ForecastHour {
  time: string
  tempC: number | null
  dewPointC: number | null
  humidityPct: number | null
  windKph: number | null
}

/** Fills weather on up to `limit` activities that have none; returns how many were updated. */
export function enrichWeather(
  deps: Deps,
  userId: string,
  opts: { limit: number; fetch: typeof fetch; now: Date },
): Promise<number> {
  void deps
  void userId
  void opts
  return Promise.reject(new Error('not implemented'))
}

/** Seven days of hourly forecast at home, cached for one hour; null without a home location. */
export function getForecast(
  deps: Deps,
  userId: string,
  fetchFn: typeof fetch,
): Promise<{ hours: ForecastHour[] } | null> {
  void deps
  void userId
  void fetchFn
  return Promise.reject(new Error('not implemented'))
}
