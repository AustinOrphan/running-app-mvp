// A parameter's value in plain words, in the runner's units: 0.2 "fraction of duration" reads "20%
// of the duration", 32 "km/week" reads "19.9 mi per week" for a runner on miles.
//
// `UNIT_RULES` maps every unit string in the registry (`allParams()`). A unit with no entry fails
// the paramUnits test, so a parameter added without its unit mapped cannot merge; at run time an
// unmapped unit falls back to the raw words instead of breaking the drawer.
import type { Param, Quantity } from '../engine/types.ts'
import type { Units } from '../types.ts'
import { FEET_PER_METRE, milesToM, NO_VALUE } from '../units.ts'
import { formatNumber, quantityParts, type QuantityParts } from './quantity.ts'
import { CopyError, isCopyStrict } from './template.ts'

type NumberStyle =
  /** 3.5 */
  | 'plain'
  /** 5.5 is "5.5%" */
  | 'percent'
  /** 0.2 is "20%" */
  | 'fraction'
  /** 21 km is "21 km" or "13.1 mi" */
  | 'distanceKm'
  /** 400 m is "400 m" or "0.25 mi" */
  | 'distanceM'
  /** 100 m is "100 m" or "328 ft" */
  | 'climbM'
  /** 12 km/h is "12 km/h" or "7.5 mph" */
  | 'speedKmh'
  /** 420 s/km is "7:00 /km" or "11:16 /mi" */
  | 'paceSecPerKm'
  /** 9000 s is "2 h 30 min" */
  | 'seconds'
  | 'celsius'
  /** 6 is "06:00" */
  | 'hourOfDay'
  /** 10 m per km is "10 m" or "53 ft" (per mile) */
  | 'gainPerKm'

interface UnitRule {
  style: NumberStyle
  /** The words around the value; `{value}` stands for the number or numbers. */
  phrase: string
  /** The phrase for exactly one ("1 day"). */
  one?: string
  /** The phrase for a runner on miles, when the words change with the units. */
  mi?: string
}

const plain = (phrase: string, one?: string): UnitRule =>
  one === undefined ? { style: 'plain', phrase } : { style: 'plain', phrase, one }
const noun = (many: string, single: string): UnitRule =>
  plain(`{value} ${many}`, `{value} ${single}`)
const pct = (phrase: string, mi?: string): UnitRule =>
  mi === undefined ? { style: 'percent', phrase } : { style: 'percent', phrase, mi }
const frac = (phrase: string): UnitRule => ({ style: 'fraction', phrase })
const style = (kind: NumberStyle, phrase: string, mi?: string): UnitRule =>
  mi === undefined ? { style: kind, phrase } : { style: kind, phrase, mi }

const UNIT_RULES: Readonly<Record<string, UnitRule>> = {
  // Percentages: the value is already a percent.
  '%': pct('{value}'),
  '% 1RM': pct('{value} of one-repetition maximum'),
  '% HR per C WBGT above 15 C': pct('{value} rise in heart rate per °C of WBGT above 15 °C'),
  '% body mass': pct('{value} of body mass'),
  '% grade': pct('{value} grade'),
  '% of non-finishers': pct('{value} of non-finishers'),
  '% of overuse injuries': pct('{value} of overuse injuries'),
  '% of pace': pct('{value} of pace'),
  '% of predicted time': pct('{value} of the predicted time'),
  '% of race time': pct('{value} of the race time'),
  '% of running time': pct('{value} of running time'),
  '% of target distance': pct('{value} of the target distance'),
  '% of the adaptation per day': pct('{value} of the adaptation per day'),
  '% of the goal distance': pct('{value} of the goal distance'),
  '% of weekly time': pct('{value} of weekly time'),
  '% pace per effort unit': pct('{value} of pace per effort unit'),
  '% per 1000 m': pct('{value} per 1000 m of altitude', '{value} per 3281 ft of altitude'),
  '% per C': pct('{value} per °C'),
  '% per C WBGT above 15 C': pct('{value} per °C of WBGT above 15 °C'),
  '% per m of gain per km': pct(
    '{value} per m of gain per km',
    '{value} per 5.3 ft of gain per mile',
  ),
  '% per year after 35': pct('{value} per year after age 35'),
  '% slower at 161 km in a hot year': pct(
    '{value} slower at 161 km in a hot year',
    '{value} slower at 100 mi in a hot year',
  ),
  '% slower, relative to WBGT 5-10 C': pct('{value} slower than at a WBGT of 5 to 10 °C'),
  '% trend': pct('{value} trend'),
  '% volume cut': pct('{value} volume cut'),

  // Fractions of one: the value reads as a percentage of what it is a fraction of.
  fraction: frac('{value}'),
  'fraction of CS': frac('{value} of critical speed'),
  'fraction of HRmax': frac('{value} of maximum heart rate'),
  'fraction of day 1': frac('{value} of day 1'),
  'fraction of duration': frac('{value} of the duration'),
  'fraction of expected race duration': frac('{value} of the expected race duration'),
  'fraction of planned minutes': frac('{value} of planned minutes'),
  'fraction of pre-break week': frac('{value} of the week before the break'),
  'fraction of recent runs': frac('{value} of recent runs'),
  'fraction of samples': frac('{value} of samples'),
  'fraction of shortwave radiation': frac('{value} of shortwave radiation'),
  'fraction of the default ramp': frac('{value} of the default ramp'),
  'fraction of the duration': frac('{value} of the duration'),
  'fraction of the heat penalty': frac('{value} of the heat penalty'),
  'fraction of the planned quality volume': frac('{value} of the planned quality volume'),
  'fraction of the pre-taper reference week': frac('{value} of the pre-taper reference week'),
  'fraction of time': frac('{value} of the time'),
  'fraction of time in the target zone': frac('{value} of the time in the target zone'),
  'fraction of time to exhaustion': frac('{value} of the time to exhaustion'),
  'fraction over any 2-week window': frac('{value} over any 2-week window'),
  'fraction per week': frac('{value} per week'),

  // Ratios. A ratio of actual to planned reads as a percentage; the others stay a ratio.
  ratio: plain('a ratio of {value}'),
  'ratio lower': plain('a ratio {value} lower'),
  'ratio of actual to planned minutes': frac('{value} of planned minutes'),
  'ratio of longest to shortest effort time': plain(
    'a ratio of {value} between the longest and shortest effort',
  ),
  'ratio of longest to shortest race distance': plain(
    'a ratio of {value} between the longest and shortest race distance',
  ),
  'ratio of weeks available to weeks needed': plain('{value} weeks available for each week needed'),
  'ratio per week': frac('{value} of the previous week'),
  'ratio to LT1 pace': plain('{value} times the pace at the first lactate threshold'),
  'ratio to level cost': plain('{value} times the cost of level running'),
  'ratio to the 30-day longest completed run': frac(
    '{value} of the longest completed run of the last 30 days',
  ),
  'ratio to the largest 2-day total in the last 30 days': frac(
    '{value} of the largest 2-day total in the last 30 days',
  ),
  'hazard ratio': plain('a hazard ratio of {value}'),
  'odds ratio': plain('an odds ratio of {value}'),
  x: plain('{value} times', '{value} time'),
  'x faster than decay': plain('{value} times faster than decay'),
  'flat m per m of gain': plain('{value} times the climb, counted as flat distance'),

  // Distances, speeds and climbs: these follow the runner's units.
  km: style('distanceKm', '{value}'),
  'km/week': style('distanceKm', '{value} per week'),
  'km/h': style('speedKmh', '{value}'),
  'km/h below CS': style('speedKmh', '{value} below critical speed'),
  m: style('distanceM', '{value}'),
  'm/h': style('climbM', '{value} per hour'),
  'm of ascent per km': style(
    'gainPerKm',
    '{value} of ascent per km',
    '{value} of ascent per mile',
  ),
  'm of climb per km': style('gainPerKm', '{value} of climb per km', '{value} of climb per mile'),
  'm of descent per km': style(
    'gainPerKm',
    '{value} of descent per km',
    '{value} of descent per mile',
  ),
  'sec/km': style('paceSecPerKm', '{value}'),

  // Times and temperatures.
  s: style('seconds', '{value}'),
  sec: style('seconds', '{value}'),
  min: plain('{value} min'),
  'min by tier': plain('{value} min by volume tier'),
  'min of continuous easy running per run': plain('{value} min of continuous easy running per run'),
  'min of running and walking per session': plain('{value} min of running and walking per session'),
  'min of running per week': plain('{value} min of running per week'),
  'min per run': plain('{value} min per run'),
  'min per session': plain('{value} min per session'),
  'min per week': plain('{value} min per week'),
  'min per week (mean of the last 16 weeks)': plain(
    '{value} min per week (mean of the last 16 weeks)',
  ),
  h: plain('{value} h'),
  'h per week': plain('{value} h per week'),
  'h/week': plain('{value} h per week'),
  'hour of day': style('hourOfDay', '{value}'),
  C: style('celsius', '{value}'),
  'C WBGT': style('celsius', '{value} WBGT'),
  'C of the index': style('celsius', '{value} of the index'),
  weeks: noun('weeks', 'week'),
  'weeks with a run (of the last 16)': noun(
    'weeks with a run (of the last 16)',
    'week with a run (of the last 16)',
  ),
  days: noun('days', 'day'),
  'days in the week': noun('days in the week', 'day in the week'),
  'days per week': noun('days per week', 'day per week'),
  months: noun('months', 'month'),
  nights: noun('nights', 'night'),
  years: noun('years', 'year'),

  // Scales and scores.
  'CR-10': plain('{value} on the CR-10 scale'),
  'CR-10 points per effort unit': plain('{value} CR-10 points per effort unit'),
  'Borg 6-20': plain('{value} on the Borg 6-20 scale'),
  'RPE 0-10': plain('{value} on the 0 to 10 effort scale'),
  '0-10 review fatigue': plain('{value} on the 0 to 10 review fatigue scale'),
  'pain score 0-10': plain('{value} on the 0 to 10 pain scale'),
  'check-in score': plain('a check-in score of {value}'),
  'effort score': plain('an effort score of {value}'),
  score: plain('a score of {value}'),
  weight: plain('a weight of {value}'),
  SD: noun('standard deviations', 'standard deviation'),
  'z-score per effort unit': plain('{value} z-score per effort unit'),
  'points from normal': noun('points from normal', 'point from normal'),
  'points from normal, summed': noun('points from normal, summed', 'point from normal, summed'),
  'percentage points': noun('percentage points', 'percentage point'),
  'effort units': noun('effort units', 'effort unit'),

  // Heart rate, energy, nutrition and physical units.
  bpm: plain('{value} bpm'),
  'bpm above the baseline mean': plain('{value} bpm above the baseline mean'),
  'bpm either side of the average HR': plain('{value} bpm either side of the average heart rate'),
  'bpm per year': plain('{value} bpm per year'),
  'bpm per year of age': plain('{value} bpm per year of age'),
  'g/h': plain('{value} g per hour'),
  'g/kg/day': plain('{value} g per kg of body mass per day'),
  'kcal/h': plain('{value} kcal per hour'),
  'mL/h': plain('{value} mL per hour'),
  'mg/L': plain('{value} mg per litre'),
  'ml/kg/min': plain('{value} mL/kg/min'),
  'kg/m2': plain('{value} kg/m²'),
  'J/kg/m': plain('{value} J/kg/m'),
  'J/kg/m, highest power of grade first': plain('{value} J/kg/m, highest power of grade first'),
  'W/m2': plain('{value} W/m²'),
  hPa: plain('{value} hPa'),
  degrees: plain('{value} degrees', '{value} degree'),

  // Counts of things.
  'check-ins': noun('check-ins', 'check-in'),
  'check-ins in the 28 days before the race': noun(
    'check-ins in the 28 days before the race',
    'check-in in the 28 days before the race',
  ),
  'concordant observations': noun('concordant observations', 'concordant observation'),
  'contacts per session': noun('contacts per session', 'contact per session'),
  efforts: noun('efforts', 'effort'),
  exercises: noun('exercises', 'exercise'),
  factors: noun('factors', 'factor'),
  flags: noun('flags', 'flag'),
  'independent signals': noun('independent signals', 'independent signal'),
  'injuries per 1000 h': noun('injuries per 1000 h', 'injury per 1000 h'),
  observations: noun('observations', 'observation'),
  parts: noun('parts', 'part'),
  'parts run': noun('parts run', 'part run'),
  'parts walk': noun('parts walk', 'part walk'),
  'performance observations': noun('performance observations', 'performance observation'),
  'prior sessions': noun('prior sessions', 'prior session'),
  'pseudo-runs': noun('pseudo-runs', 'pseudo-run'),
  'quality days among the two days around a long run': noun(
    'quality days among the two days around a long run',
    'quality day among the two days around a long run',
  ),
  'quality sessions in a row': noun('quality sessions in a row', 'quality session in a row'),
  'races at different distances': noun(
    'races at different distances',
    'race at different distances',
  ),
  readings: noun('readings', 'reading'),
  reps: noun('repetitions', 'repetition'),
  runs: noun('runs', 'run'),
  'runs per week': noun('runs per week', 'run per week'),
  'sessions in a row': noun('sessions in a row', 'session in a row'),
  'sessions in the week': noun('sessions in the week', 'session in the week'),
  'sessions per week': noun('sessions per week', 'session per week'),
  sets: noun('sets', 'set'),
  sources: noun('sources', 'source'),
  sprints: noun('sprints', 'sprint'),
  'trims per week': noun('trims per week', 'trim per week'),
  'valid readings': noun('valid readings', 'valid reading'),
}

/** Parameters whose unit is ambiguous on its own: an elevation measured in the same `m` as a distance. */
const PARAM_RULES: Readonly<Record<string, UnitRule>> = {
  'h4.minStepGainM': style('climbM', '{value}'),
  'i12.altitudeFromM': style('climbM', '{value}'),
}

/** Parameters whose two or more values are steps or edges in order, not the ends of a range. */
const SEQUENCE_PARAMS: ReadonlySet<string> = new Set([
  'k2.twoWeekMultipliers',
  'macroDesign.postRaceMarathonFractions',
  'macroDesign.longRunTierWeeklyMin',
])

const PLAIN_RULE: UnitRule = plain('{value}')

/** Whether `unit` has a reading in `UNIT_RULES`. */
export function isMappedUnit(unit: string): boolean {
  return Object.hasOwn(UNIT_RULES, unit)
}

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value)

function partsFor(kind: NumberStyle, n: number, units: Units): QuantityParts | null {
  const q = (quantity: Quantity) => quantityParts(quantity, units)
  switch (kind) {
    case 'plain':
      return { num: formatNumber(n), suffix: '' }
    case 'percent':
      return q({ kind: 'percent', pct: n })
    case 'fraction':
      return q({ kind: 'share', fraction: n })
    case 'distanceKm':
      return q({ kind: 'distance', m: n * 1000 })
    case 'distanceM':
      return q({ kind: 'distance', m: n })
    case 'climbM':
      return q({ kind: 'climb', m: n })
    case 'speedKmh':
      return q({ kind: 'speed', kmh: n })
    case 'paceSecPerKm':
      return q({ kind: 'pace', secPerKm: n })
    case 'seconds':
      return q({ kind: 'duration', sec: n })
    case 'celsius':
      return q({ kind: 'temp', c: n })
    case 'hourOfDay':
      return Number.isInteger(n) && n >= 0 && n <= 24
        ? { num: `${String(n).padStart(2, '0')}:00`, suffix: '' }
        : null
    case 'gainPerKm':
      // Metres of gain per kilometre, as feet of gain per mile.
      return units === 'mi'
        ? { num: String(Math.round(n * FEET_PER_METRE * (milesToM(1) / 1000))), suffix: ' ft' }
        : { num: formatNumber(n), suffix: ' m' }
  }
}

/** "5 to 10%" for a range that shares a unit, "400 m to 5 km" for one that does not. */
function joinRange(a: QuantityParts, b: QuantityParts): string {
  if (a.num === b.num && a.suffix === b.suffix) return `${a.num}${a.suffix}`
  if (a.suffix === b.suffix) return `${a.num} to ${b.num}${a.suffix}`
  return `${a.num}${a.suffix} to ${b.num}${b.suffix}`
}

/** Anything the rules cannot read, as words: numbers trimmed, nested lists split by semicolons. */
function plainText(value: unknown): string {
  if (typeof value === 'number') return formatNumber(value)
  if (typeof value === 'string') return value
  if (typeof value === 'boolean') return value ? 'yes' : 'no'
  if (Array.isArray(value)) {
    return value.map(plainText).join(value.some((item) => Array.isArray(item)) ? '; ' : ', ')
  }
  if (value === null || value === undefined) return NO_VALUE
  return JSON.stringify(value)
}

function ruleFor(param: Param<unknown>): UnitRule | null {
  const own = Object.hasOwn(PARAM_RULES, param.id) ? PARAM_RULES[param.id] : undefined
  if (own !== undefined) return own
  if (param.unit === undefined) return PLAIN_RULE
  if (isMappedUnit(param.unit)) return UNIT_RULES[param.unit] ?? null
  if (isCopyStrict()) {
    throw new CopyError(`Parameter ${param.id}`, [
      `the unit ${JSON.stringify(param.unit)} has no reading in shared/copy/paramUnits.ts`,
    ])
  }
  return null
}

function describeValue(
  param: Param<unknown>,
  value: unknown,
  units: Units,
  asRange: boolean,
): string {
  const rule = ruleFor(param)
  const numbers =
    typeof value === 'number'
      ? [value]
      : Array.isArray(value) && value.every(isFiniteNumber)
        ? value
        : null
  if (numbers === null || numbers.length === 0) return plainText(value)

  if (rule === null) {
    // An unmapped unit outside tests: the numbers, then the unit as written.
    return `${numbers.map(formatNumber).join(', ')} ${param.unit ?? ''}`.trim()
  }

  const parts = numbers.map((n) => partsFor(rule.style, n, units))
  const first = parts[0]
  const second = parts[1]
  let joined: string
  if (parts.some((part) => part === null)) {
    joined = NO_VALUE
  } else if (parts.length === 1 && first) {
    joined = `${first.num}${first.suffix}`
  } else if (parts.length === 2 && first && second && (asRange || !SEQUENCE_PARAMS.has(param.id))) {
    joined = joinRange(first, second)
  } else {
    joined = parts.map((part) => (part ? `${part.num}${part.suffix}` : NO_VALUE)).join(', ')
  }

  const single = numbers.length === 1 && numbers[0] === 1
  const phrase = units === 'mi' && rule.mi !== undefined ? rule.mi : rule.phrase
  const template = single && rule.one !== undefined ? rule.one : phrase
  return template.replace('{value}', () => joined)
}

/**
 * The parameter's value in plain words and the runner's units. A parameter with a range keeps its
 * value here; `describeParamRange` reads the range with the same words.
 *
 * Under test a unit with no reading in this module throws; elsewhere the numbers are followed by
 * the unit as the registry spells it.
 */
export function describeParamValue(param: Param<unknown>, units: Units): string {
  return describeValue(param, param.value, units, false)
}

/** The parameter's range ("2 to 4 on the CR-10 scale"), or null when it has none. */
export function describeParamRange(param: Param<unknown>, units: Units): string | null {
  return param.range === undefined ? null : describeValue(param, param.range, units, true)
}
