// The same sore area across check-ins (rule J11). The check-in stores the area as the runner's own
// words, with no side or site field, so this module reads the words: `painAreaKey` gives a region
// and a side, `painReports` lists the check-ins that report an area, and `repeatPainPattern` says
// whether one area was reported on enough days to make Today ask about a rest window. Pure: no
// I/O, and the only numbers are the `pain.repeat*` Params. The word lists are data preparation,
// not Params. Nothing here diagnoses; a match is a question for the runner, not a verdict.
import { addDays } from '../dates.ts'
import { P } from '../engine/params/index.ts'

export type PainSide = 'left' | 'right'

/** The region a text names and the side it gives, when it gives one. */
export interface PainArea {
  /** A region key from the closed list, or the remaining words of the text joined. */
  key: string
  side: PainSide | null
}

const SIDE_WORDS: Readonly<Record<string, PainSide>> = {
  left: 'left',
  l: 'left',
  lt: 'left',
  right: 'right',
  r: 'right',
  rt: 'right',
}

const FILLER_WORDS: ReadonlySet<string> = new Set([
  'my',
  'the',
  'a',
  'an',
  'sore',
  'soreness',
  'pain',
  'painful',
  'tight',
  'tightness',
  'ache',
  'aches',
  'aching',
  'achy',
  'in',
  'on',
  'of',
  'at',
])

/** Region key to the words that name it (the key is also a word). */
const REGIONS: Readonly<Record<string, readonly string[]>> = {
  achilles: ['achilles'],
  calf: ['calf', 'calves', 'gastroc', 'gastrocnemius', 'soleus'],
  shin: ['shin', 'shins', 'tibia', 'tibial'],
  knee: ['knee', 'knees', 'kneecap', 'patella', 'patellar'],
  hip: ['hip', 'hips'],
  groin: ['groin', 'adductor', 'adductors'],
  hamstring: ['hamstring', 'hamstrings', 'hammy', 'hammies'],
  quad: ['quad', 'quads', 'quadricep', 'quadriceps', 'thigh'],
  glute: ['glute', 'glutes', 'butt', 'buttock'],
  foot: [
    'foot',
    'feet',
    'plantar',
    'heel',
    'arch',
    'metatarsal',
    'forefoot',
    'toe',
    'toes',
    'sole',
  ],
  ankle: ['ankle', 'ankles'],
  back: ['back', 'spine', 'lumbar'],
  'it band': ['itb', 'iliotibial'],
}

const REGION_OF: ReadonlyMap<string, string> = new Map(
  Object.entries(REGIONS).flatMap(([key, words]) => words.map((word) => [word, key] as const)),
)

/**
 * The region and side a text names, or null for a text with no words left. Lower case, punctuation
 * dropped; side words (left, right, l, r, lt, rt) and fillers (my, sore, pain, in ...) are taken
 * out; the first word of the closed region list gives the key. A text with no region word keys on
 * its remaining words joined, so an unfamiliar word still matches itself. Both sides in one text
 * ("left and right knee") read as no side.
 */
export function painAreaKey(text: string | null | undefined): PainArea | null {
  if (text === null || text === undefined) return null
  const words = text
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((word) => word !== '')
  const sides = new Set<PainSide>()
  const rest: string[] = []
  for (const word of words) {
    const side = SIDE_WORDS[word]
    if (side !== undefined) sides.add(side)
    else if (!FILLER_WORDS.has(word)) rest.push(word)
  }
  if (rest.length === 0) return null
  const region = rest.map((word) => REGION_OF.get(word)).find((key) => key !== undefined)
  const side = sides.size === 1 ? ([...sides][0] ?? null) : null
  return { key: region ?? rest.join(' '), side }
}

/** Two areas match when the keys are equal and the sides are equal or either is unstated. */
export function sameArea(a: PainArea, b: PainArea): boolean {
  return a.key === b.key && (a.side === null || b.side === null || a.side === b.side)
}

/** The part of a check-in row this module reads. */
export interface PainCheckin {
  date: string
  painScore?: number | null
  painArea?: string | null
}

/** One check-in that reports an area. */
export interface PainReport {
  date: string
  score: number
  /** The runner's words, trimmed. */
  text: string
  area: PainArea
}

/**
 * The check-ins from `from` to `to` (inclusive) that report an area: a pain score of at least
 * `pain.repeatMinScore` and an area text that names something. Newest first.
 */
export function painReports(
  wellness: readonly PainCheckin[],
  range: { from: string; to: string },
): PainReport[] {
  const min = P.pain.repeatMinScore.value
  const reports: PainReport[] = []
  for (const day of wellness) {
    if (day.date < range.from || day.date > range.to) continue
    const score = day.painScore
    if (score === null || score === undefined || score < min) continue
    const area = painAreaKey(day.painArea)
    if (area === null) continue
    reports.push({ date: day.date, score, text: (day.painArea ?? '').trim(), area })
  }
  return reports.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
}

/** The part of a stored window the quiet days read. */
export interface PainWindow {
  reason: string
  endDate: string
  area: string | null
}

/** What the repeat offer shows and fills in. */
export interface RepeatPainPattern {
  /** The area in the runner's words, from the newest matching report. */
  area: string
  /** How many days of the look-back hold a matching report. */
  reports: number
  /** The look-back, in days (`pain.repeatDays`). */
  days: number
  /** The highest score among the matching reports. */
  pain: number
}

/**
 * Whether the check-ins of the last `pain.repeatDays` days ending on `date` hold `pain.repeatReports`
 * reports of one area (rule J11). The days need not be consecutive, and one check-in is one report.
 * With several areas the one with most reports is taken, the newest on a tie. No pattern within
 * `pain.repeatQuietDays` days after the last day of a niggle window for the same area (a window
 * with no area counts as the same). Null when there is none.
 */
export function repeatPainPattern(args: {
  wellness: readonly PainCheckin[]
  windows: readonly PainWindow[]
  date: string
}): RepeatPainPattern | null {
  const days = P.pain.repeatDays.value
  const needed = P.pain.repeatReports.value
  const quietFrom = addDays(args.date, -P.pain.repeatQuietDays.value)
  const reports = painReports(args.wellness, {
    from: addDays(args.date, -(days - 1)),
    to: args.date,
  })
  const quiet = (area: PainArea): boolean =>
    args.windows.some((window) => {
      if (window.reason !== 'niggle' || window.endDate < quietFrom) return false
      const named = painAreaKey(window.area)
      return named === null || sameArea(named, area)
    })

  let best: { anchor: PainReport; matches: PainReport[] } | null = null
  for (const anchor of reports) {
    const matches = reports.filter((report) => sameArea(report.area, anchor.area))
    if (matches.length < needed || quiet(anchor.area)) continue
    if (best === null || matches.length > best.matches.length) best = { anchor, matches }
  }
  if (best === null) return null
  return {
    area: best.matches[0]?.text ?? best.anchor.text,
    reports: best.matches.length,
    days,
    pain: Math.max(...best.matches.map((report) => report.score)),
  }
}
