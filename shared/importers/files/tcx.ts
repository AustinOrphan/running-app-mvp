import type { Lap, ParsedActivity } from '../../types.ts'
import { asArray, findDeep, isNode, numberOf, parseXmlDocument, textOf } from './gpx.ts'
import type { XmlNode } from './gpx.ts'
import {
  classifySport,
  elevationGainLoss,
  fillSamples,
  isFootActivity,
  mean,
  msToUtcIso,
  offsetMinFor,
  roundCoord,
  shaProviderKey,
  toUtcIso,
} from './summarize.ts'
import type { RawPoint } from './summarize.ts'

/** Every `Activity`, including those inside a multisport session. */
function activitiesOf(root: XmlNode): XmlNode[] {
  const out: XmlNode[] = []
  const collect = (node: unknown): void => {
    if (!isNode(node)) return
    for (const a of asArray(node['Activity'])) if (isNode(a)) out.push(a)
  }
  const activities = root['Activities']
  if (isNode(activities)) {
    collect(activities)
    const multi = activities['MultiSportSession']
    if (isNode(multi)) {
      collect(multi['FirstSport'])
      for (const next of asArray(multi['NextSport'])) collect(next)
    }
  }
  return out
}

function heartRateOf(node: unknown): number | null {
  return isNode(node) ? numberOf(node['Value']) : null
}

interface TrackPoint {
  ms: number
  raw: RawPoint
  lat: number | null
  lng: number | null
}

/** Throws `RangeError` with a reason for an unreadable file. */
export function parseTcx(bytes: Uint8Array, opts: { timezone: string }): ParsedActivity[] {
  const doc = parseXmlDocument(bytes, 'TCX')
  const root = doc['TrainingCenterDatabase']
  if (!isNode(root)) {
    throw new RangeError('Not a TCX file: there is no <TrainingCenterDatabase> element')
  }

  const result: ParsedActivity[] = []
  activitiesOf(root).forEach((activity, index) => {
    const sportName = textOf(activity['@_Sport'])
    const sport = classifySport(sportName ?? 'other')
    const foot = isFootActivity(sport.type, sport.subtype)
    const cadenceScale = foot ? 2 : 1

    const laps = asArray(activity['Lap']).filter(isNode)
    const lapStarts = laps.map((lap) => toUtcIso(textOf(lap['@_StartTime'])))

    // Trackpoints from every lap, with times as milliseconds until the start is known.
    const trackpoints: TrackPoint[] = []
    for (const lap of laps) {
      for (const track of asArray(lap['Track'])) {
        if (!isNode(track)) continue
        for (const tp of asArray(track['Trackpoint'])) {
          if (!isNode(tp)) continue
          const iso = toUtcIso(textOf(tp['Time']))
          if (iso === null) continue
          const position = tp['Position']
          const ext = tp['Extensions']
          const cadence =
            numberOf(tp['Cadence']) ?? numberOf(findDeep(ext, ['runcadence', 'cadence']))
          trackpoints.push({
            ms: Date.parse(iso),
            lat: isNode(position) ? numberOf(position['LatitudeDegrees']) : null,
            lng: isNode(position) ? numberOf(position['LongitudeDegrees']) : null,
            raw: {
              t: 0,
              d: numberOf(tp['DistanceMeters']),
              hr: heartRateOf(tp['HeartRateBpm']),
              alt: numberOf(tp['AltitudeMeters']),
              cad: cadence === null ? null : cadence * cadenceScale,
              pwr: numberOf(findDeep(ext, ['watts'])),
            },
          })
        }
      }
    }
    trackpoints.sort((a, b) => a.ms - b.ms)

    const startIso =
      lapStarts.find((s): s is string => s !== null) ??
      toUtcIso(textOf(activity['Id'])) ??
      (trackpoints[0] ? msToUtcIso(trackpoints[0].ms) : null)
    if (startIso === null) return
    const startMs = Date.parse(startIso)
    for (const tp of trackpoints) tp.raw.t = Math.max(0, (tp.ms - startMs) / 1000)
    const samples = fillSamples(trackpoints.map((tp) => tp.raw))

    const lapTotals = laps.map((lap) => numberOf(lap['TotalTimeSeconds']))
    const lapTimeSum = lapTotals.reduce<number>((sum, v) => sum + (v ?? 0), 0)
    const lastT = samples.t[samples.t.length - 1] ?? 0
    const elapsed = Math.max(lastT, lapTimeSum)
    if (trackpoints.length === 0 && lapTimeSum <= 0) return

    const lapDistances = laps.map((lap) => numberOf(lap['DistanceMeters']))
    const lapDistanceSum = lapDistances.reduce<number>((sum, v) => sum + (v ?? 0), 0)
    const lastDistance = samples.d ? samples.d[samples.d.length - 1]! : null
    const distance = lapDistanceSum > 0 ? lapDistanceSum : lastDistance

    const parsedLaps: Lap[] = []
    laps.forEach((lap, i) => {
      const start = lapStarts[i]
      const duration = lapTotals[i]
      if (!start || duration == null) return
      const cadence =
        numberOf(lap['Cadence']) ?? numberOf(findDeep(lap['Extensions'], ['avgruncadence']))
      parsedLaps.push({
        startSec: Math.max(0, Math.round((Date.parse(start) - startMs) / 1000)),
        durationSec: Math.round(duration),
        distanceM: lapDistances[i] ?? null,
        avgHr: heartRateOf(lap['AverageHeartRateBpm']),
        maxHr: heartRateOf(lap['MaximumHeartRateBpm']),
        avgCadence: cadence === null ? null : Math.round(cadence * cadenceScale),
      })
    })

    const change = samples.alt ? elevationGainLoss(samples.alt) : null
    const located = trackpoints.find((tp) => tp.lat !== null && tp.lng !== null)
    const avgHr = mean(samples.hr ?? [])
    const avgCadence = mean(samples.cad ?? [])
    const avgPower = mean(samples.pwr ?? [])
    const creator = activity['Creator']
    const device = isNode(creator) ? textOf(creator['Name']) : null

    result.push({
      providerKey: shaProviderKey(bytes, index),
      startUtc: startIso,
      utcOffsetMin: offsetMinFor(startIso, opts.timezone),
      type: sport.type,
      subtype: sport.subtype,
      elapsedSec: Math.round(elapsed),
      movingSec: null,
      distanceM: distance === null ? null : Math.round(distance),
      elevationGainM: change?.gain ?? null,
      elevationLossM: change?.loss ?? null,
      avgHr: avgHr === null ? null : Math.round(avgHr),
      maxHr: samples.hr ? samples.hr.reduce((m, v) => Math.max(m, v), 0) : null,
      avgCadence: avgCadence === null ? null : Math.round(avgCadence),
      avgPowerW: avgPower === null ? null : Math.round(avgPower),
      deviceName: device,
      startLat: located?.lat != null ? roundCoord(located.lat) : null,
      startLng: located?.lng != null ? roundCoord(located.lng) : null,
      samples,
      laps: parsedLaps,
    })
  })
  return result
}
