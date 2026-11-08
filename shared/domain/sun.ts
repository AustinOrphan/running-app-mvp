// The height of the sun above the horizon at a place and an instant, and the minutes of a span that
// fall in the dark. Pure: the instant and the place arrive as data, so no time zone is needed (a
// run's UTC start and the home coordinates are enough). The formula is the NOAA solar position
// approximation (Meeus, "Astronomical Algorithms", ch. 25 and 28), good to about a minute of
// sunrise and sunset away from the poles; atmospheric refraction is left to the threshold the
// caller passes (-0.833 degrees is sunrise and sunset, -6 degrees the end of civil twilight).

const MS_PER_DAY = 86_400_000
const MS_PER_MIN = 60_000
const UNIX_EPOCH_JD = 2_440_587.5
const J2000_JD = 2_451_545
const DAYS_PER_CENTURY = 36_525
const MIN_PER_DAY = 1440
const RAD = Math.PI / 180

/** The sun's altitude in degrees above the horizon at `utcMs` (a Unix time) at `lat`, `lng` degrees. */
export function sunAltitudeDeg(utcMs: number, lat: number, lng: number): number {
  const t = (utcMs / MS_PER_DAY + UNIX_EPOCH_JD - J2000_JD) / DAYS_PER_CENTURY
  const meanLong = mod360(280.46646 + t * (36000.76983 + t * 0.0003032))
  const meanAnomaly = 357.52911 + t * (35999.05029 - t * 0.0001537)
  const eccentricity = 0.016708634 - t * (0.000042037 + t * 0.0000001267)
  const m = meanAnomaly * RAD
  const center =
    Math.sin(m) * (1.914602 - t * (0.004817 + t * 0.000014)) +
    Math.sin(2 * m) * (0.019993 - t * 0.000101) +
    Math.sin(3 * m) * 0.000289
  const omega = (125.04 - 1934.136 * t) * RAD
  const apparentLong = (meanLong + center - 0.00569 - 0.00478 * Math.sin(omega)) * RAD
  const meanObliquity = 23 + (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60
  const obliquity = (meanObliquity + 0.00256 * Math.cos(omega)) * RAD
  const declination = Math.asin(Math.sin(obliquity) * Math.sin(apparentLong))

  const y = Math.tan(obliquity / 2) ** 2
  const l0 = meanLong * RAD
  const equationOfTimeMin =
    4 *
    ((y * Math.sin(2 * l0) -
      2 * eccentricity * Math.sin(m) +
      4 * eccentricity * y * Math.sin(m) * Math.cos(2 * l0) -
      0.5 * y * y * Math.sin(4 * l0) -
      1.25 * eccentricity * eccentricity * Math.sin(2 * m)) /
      RAD)

  const utcMin = (((utcMs % MS_PER_DAY) + MS_PER_DAY) % MS_PER_DAY) / MS_PER_MIN
  const solarMin =
    (((utcMin + equationOfTimeMin + 4 * lng) % MIN_PER_DAY) + MIN_PER_DAY) % MIN_PER_DAY
  const hourAngle = (solarMin / 4 - 180) * RAD
  const sinAlt =
    Math.sin(lat * RAD) * Math.sin(declination) +
    Math.cos(lat * RAD) * Math.cos(declination) * Math.cos(hourAngle)
  return Math.asin(Math.min(1, Math.max(-1, sinAlt))) / RAD
}

function mod360(deg: number): number {
  return ((deg % 360) + 360) % 360
}

/**
 * Whole minutes of the span from `startMs` for `durationSec` seconds during which the sun is below
 * `belowDeg` degrees, counted at each minute's midpoint. A span of under a minute counts none.
 */
export function darkMinutesOf(
  startMs: number,
  durationSec: number,
  lat: number,
  lng: number,
  belowDeg: number,
): number {
  const minutes = Math.floor(durationSec / 60)
  let dark = 0
  for (let i = 0; i < minutes; i++) {
    if (sunAltitudeDeg(startMs + (i + 0.5) * MS_PER_MIN, lat, lng) < belowDeg) dark++
  }
  return dark
}
