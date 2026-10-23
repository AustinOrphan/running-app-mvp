// The one G5 lint (rule G5 of the phase 3a design, section 4.5): no red, no "behind" or "missed", no
// streaks or badges, targets are a sketch. Every epic's templates and rendered pages run it; no
// epic keeps a word list of its own.
//
// It covers copy the app authors. Text a provider or the system returns (an intervals.icu error, a
// Garmin message) is shown verbatim inside an app-authored sentence, quoted as the service's own
// words, and is outside the lint.

export const G5_BANNED = {
  /** Whole words and phrases, any case. The plain word "record" is allowed ("track record"). */
  words: [
    'behind',
    'missed',
    'miss',
    'streak',
    'streaks',
    'badge',
    'badges',
    'trophy',
    'personal record',
    'personal best',
    'fail',
    'failed',
    'failure',
    'lazy',
    'crush',
    'smash',
    'should have',
  ],
  /** Whole words, exactly as written: PB and PR, and lowercase "red" (RED-S and REDs pass). */
  caseSensitiveWords: ['PB', 'PR', 'red'],
  /** Characters: no exclamation marks. */
  characters: ['!'],
  /** Wording that puts a probability on an injury. */
  injuryProbability: [
    /\binjury (?:risk|probability|chance|odds)\b/i,
    /\b(?:risk|chance|chances|probability|odds) of (?:an? )?(?:injury|injuries|getting injured|being injured)\b/i,
    /\b(?:likely|going|bound) to (?:get|be|become) injured\b/i,
  ],
} as const

export interface LintHit {
  rule: 'word' | 'case-sensitive-word' | 'character' | 'injury-probability'
  /** The text that matched, as written. */
  match: string
  /** Offset in the linted text. */
  index: number
}

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

const WORDS = new RegExp(`\\b(?:${G5_BANNED.words.map(escape).join('|')})\\b`, 'gi')
const CASE_SENSITIVE = new RegExp(
  `\\b(?:${G5_BANNED.caseSensitiveWords.map(escape).join('|')})\\b`,
  'g',
)
const CHARACTERS = new RegExp(`[${G5_BANNED.characters.map(escape).join('')}]`, 'g')

function collect(text: string, pattern: RegExp, rule: LintHit['rule']): LintHit[] {
  const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`
  return [...text.matchAll(new RegExp(pattern.source, flags))].map((match) => ({
    rule,
    match: match[0],
    index: match.index,
  }))
}

/** Every banned word, character and phrase in `text`, in order of position. Empty when clean. */
export function lintText(text: string): LintHit[] {
  return [
    ...collect(text, WORDS, 'word'),
    ...collect(text, CASE_SENSITIVE, 'case-sensitive-word'),
    ...collect(text, CHARACTERS, 'character'),
    ...G5_BANNED.injuryProbability.flatMap((pattern) =>
      collect(text, pattern, 'injury-probability'),
    ),
  ].sort((a, b) => a.index - b.index)
}

/** Throws, naming every hit, when `text` breaks the lint. `where` says what was linted. */
export function assertCleanCopy(text: string, where = 'Copy'): void {
  const hits = lintText(text)
  if (hits.length === 0) return
  const found = hits.map((hit) => `"${hit.match}" (${hit.rule})`).join(', ')
  throw new Error(`${where} breaks the G5 lint: ${found} in ${JSON.stringify(text)}`)
}
