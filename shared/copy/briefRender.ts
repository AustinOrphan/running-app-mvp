// The Monday brief as the page reads it (phase 3a design 8.6): the stored facts of a week turned
// into sentences in the runner's units. The facts are chosen by `shared/engine/brief.ts`; the words
// are `briefTemplates.ts`. Nothing here is stored, so a copy fix and a change of units reach every
// brief written earlier.
import { CAUSE_ORDER } from '../engine/revisionDiff.ts'
import type {
  BriefFacts,
  BriefKeySession,
  BriefLastWeek,
  InputFact,
  SessionKind,
  SourceRef,
} from '../engine/types.ts'
import type { CauseCode, Units } from '../types.ts'
import { BRIEF_KIND_IDS, BRIEF_REPLAN_IDS, BRIEF_TEMPLATES } from './briefTemplates.ts'
import { causeSentence } from './revisionView.ts'
import { render } from './template.ts'
import { targetRows, type TargetRow } from './targetRows.ts'
import { renderFact, TEMPLATES, type TemplateId } from './templates.ts'

/** The most causes the brief names under "What changed and why", the same as a revision's page. */
export const BRIEF_CAUSES_SHOWN = 2

/** Ids of the brief templates that take no slot: the headings, labels and fixed sentences. */
export type BriefPlainId = {
  [K in keyof typeof BRIEF_TEMPLATES]: [keyof (typeof BRIEF_TEMPLATES)[K]['slots']] extends [never]
    ? K
    : never
}[keyof typeof BRIEF_TEMPLATES]

/** A heading, label or fixed sentence of the brief, in the runner's units. */
export function briefText(id: BriefPlainId, units: Units): string {
  return render(BRIEF_TEMPLATES[id], {}, units)
}

const date = (iso: string) => ({ kind: 'date', iso, style: 'short' }) as const
const count = (n: number) => ({ kind: 'count', n }) as const
const minutes = (min: number) => ({ kind: 'minutes', min }) as const
const seconds = (sec: number) => ({ kind: 'duration', sec }) as const

/** "Week of 26 Oct". */
export function briefWeekLabel(weekStart: string, units: Units): string {
  return render(BRIEF_TEMPLATES['brief.week-of'], { week: date(weekStart) }, units)
}

// ---------------------------------------------------------------------------------------------
// Parts
// ---------------------------------------------------------------------------------------------

/** The sentence about last week's running. */
function lastWeekLine(lastWeek: BriefLastWeek, units: Units): string {
  if (lastWeek.ranMin <= 0) return briefText('brief.last-week-none', units)
  // A week planned at zero minutes was not planned to run: "of 0 planned minutes" is no sentence,
  // and a brief stored before the builder left it out may still hold one.
  if (lastWeek.plannedMin === null || lastWeek.plannedMin <= 0) {
    return render(
      BRIEF_TEMPLATES['brief.last-week-ran'],
      { actual: minutes(lastWeek.ranMin) },
      units,
    )
  }
  return render(
    BRIEF_TEMPLATES['brief.last-week-ran-of'],
    { actual: count(lastWeek.ranMin), planned: count(lastWeek.plannedMin) },
    units,
  )
}

/** Last week and the weekly decision about it: the two sentences the brief opens with. */
export function briefHeadline(facts: BriefFacts, units: Units): string[] {
  const lines: string[] = []
  const { lastWeek, decision } = facts
  if (lastWeek !== null) lines.push(lastWeekLine(lastWeek, units))
  if (decision !== null) {
    const id = {
      progress: 'brief.decision-progress',
      hold: 'brief.decision-hold',
      reduce: 'brief.decision-reduce',
      'post-race': 'brief.decision-post-race',
    } as const
    const bare = {
      progress: 'brief.decision-progress-bare',
      hold: 'brief.decision-hold-bare',
      reduce: 'brief.decision-reduce-bare',
      'post-race': 'brief.decision-post-race-bare',
    } as const
    // Zero minutes is "no running set", not "up to 0 min".
    lines.push(
      decision.nextWeekTargetMin <= 0
        ? briefText(bare[decision.kind], units)
        : render(
            BRIEF_TEMPLATES[id[decision.kind]],
            { minutes: minutes(decision.nextWeekTargetMin) },
            units,
          ),
    )
  }
  return lines
}

/** The race countdown and the finish estimate: the sentences under the headline, when there are any. */
export function briefContext(facts: BriefFacts, units: Units): string[] {
  const lines: string[] = []
  const { countdown, prediction } = facts
  if (countdown !== null) {
    if (countdown.days <= 0) {
      lines.push(render(BRIEF_TEMPLATES['brief.countdown-today'], { name: countdown.name }, units))
    } else if (countdown.days >= 14) {
      lines.push(
        render(
          BRIEF_TEMPLATES['brief.countdown-weeks'],
          { name: countdown.name, n: count(Math.floor(countdown.days / 7)) },
          units,
        ),
      )
    } else {
      lines.push(
        render(
          BRIEF_TEMPLATES['brief.countdown-days'],
          { name: countdown.name, n: count(countdown.days) },
          units,
        ),
      )
    }
  }
  if (prediction !== null) {
    const likely = seconds(prediction.nowSec)
    const gap = Math.abs(prediction.nowSec - prediction.priorSec)
    if (gap === 0) {
      lines.push(render(BRIEF_TEMPLATES['brief.prediction-same'], { likely }, units))
    } else {
      const delta = seconds(gap)
      const id =
        prediction.nowSec < prediction.priorSec
          ? 'brief.prediction-quicker'
          : 'brief.prediction-slower'
      lines.push(render(BRIEF_TEMPLATES[id], { likely, delta }, units))
    }
  }
  return lines
}

export interface RenderedChanges {
  /** The sentence under "What changed and why". */
  text: string
  /** Why, most specific cause first, at most `BRIEF_CAUSES_SHOWN`. */
  causes: string[]
}

/**
 * What the weekly update did. A reason it wrote nothing comes first, then a brief built before the
 * update ran, then the count of sessions it changed with the causes of its lines.
 */
export function briefChanges(
  facts: BriefFacts,
  provisional: boolean,
  units: Units,
): RenderedChanges {
  const { replan, changes } = facts
  if (replan !== null) {
    const id = Object.hasOwn(BRIEF_REPLAN_IDS, replan)
      ? BRIEF_REPLAN_IDS[replan]
      : BRIEF_REPLAN_IDS.error
    return { text: briefText(id, units), causes: [] }
  }
  if (provisional) return { text: briefText('brief.provisional', units), causes: [] }
  if (changes === null || (changes.count === 0 && changes.lines.length === 0)) {
    return { text: briefText('brief.changes-none', units), causes: [] }
  }
  const text =
    changes.count === 0
      ? briefText('brief.changes-weeks', units)
      : changes.count === 1
        ? briefText('brief.changes-one', units)
        : render(BRIEF_TEMPLATES['brief.changes-many'], { n: count(changes.count) }, units)
  const found = new Set<CauseCode>(changes.lines.flatMap((line) => line.causes))
  const causes = CAUSE_ORDER.filter((cause) => found.has(cause))
    .slice(0, BRIEF_CAUSES_SHOWN)
    .map((cause) => causeSentence(cause, units))
  return { text, causes }
}

export interface RenderedNoticed {
  id: string
  text: string
  /** The rule the Why opens on. */
  rule: string
  /** What the sentence rests on, newest first, with the dates. */
  sources: SourceRef[]
  moreSources: number
  window: InputFact['window'] | null
}

/** The facts the plan noticed, as sentences, in the order stored. */
export function briefNoticed(facts: BriefFacts, units: Units): RenderedNoticed[] {
  return facts.noticed.map((fact) => ({
    id: fact.id,
    text: renderFact(fact, units),
    rule: fact.rule,
    sources: fact.sources,
    moreSources: fact.moreSources,
    window: fact.window ?? null,
  }))
}

/** What a kind of session is called in a sentence ("long run"); a kind a newer build adds reads "session". */
export function briefKindName(kind: SessionKind, units: Units): string {
  const id: TemplateId = Object.hasOwn(BRIEF_KIND_IDS, kind)
    ? BRIEF_KIND_IDS[kind]
    : 'brief.kind-other'
  return render(TEMPLATES[id], {}, units)
}

export interface RenderedKeySession {
  /** "Sat 31 Oct: long run, 1 h 45 min." */
  line: string
  /** The targets the hero shows, lead first (`targetRows`). */
  targets: TargetRow[]
  /** "Readiness can only make this session easier on the day, never harder." */
  readiness: string
}

/** The next key session, or null for a week of easy running (`briefKeyNone`). */
export function briefKeySession(
  key: BriefKeySession | null,
  units: Units,
): RenderedKeySession | null {
  if (key === null) return null
  const slots = {
    day: { kind: 'date', iso: key.date, style: 'weekday' } as const,
    what: briefKindName(key.kind, units),
    length: minutes(key.durationMin),
  }
  const line =
    key.distanceM !== null && key.distanceM > 0
      ? render(
          BRIEF_TEMPLATES['brief.key-session-distance'],
          { ...slots, distance: { kind: 'distance', m: key.distanceM } as const },
          units,
        )
      : render(BRIEF_TEMPLATES['brief.key-session'], slots, units)
  return {
    line,
    // The key session is on a day ahead, whatever the brief's own day: no note says "today".
    targets: targetRows(key.target, units, 'other'),
    readiness: briefText('brief.key-readiness', units),
  }
}

// ---------------------------------------------------------------------------------------------
// The whole brief
// ---------------------------------------------------------------------------------------------

export interface RenderedBrief {
  title: string
  headline: string[]
  context: string[]
  changes: RenderedChanges & { heading: string }
  noticed: { heading: string; items: RenderedNoticed[]; empty: string | null }
  key: { heading: string; session: RenderedKeySession | null; none: string | null }
}

/** Every sentence of a brief, in the order the page shows them. */
export function renderBrief(
  brief: { facts: BriefFacts; provisional: boolean },
  units: Units,
): RenderedBrief {
  const { facts, provisional } = brief
  const items = briefNoticed(facts, units)
  const session = briefKeySession(facts.keySession, units)
  return {
    title: briefWeekLabel(facts.weekStart, units),
    headline: briefHeadline(facts, units),
    context: briefContext(facts, units),
    changes: {
      heading: briefText('brief.heading-changed', units),
      ...briefChanges(facts, provisional, units),
    },
    noticed: {
      heading: briefText('brief.heading-noticed', units),
      items,
      empty: items.length === 0 ? briefText('brief.noticed-empty', units) : null,
    },
    key: {
      heading: briefText('brief.heading-key', units),
      session,
      none: session === null ? briefText('brief.key-none', units) : null,
    },
  }
}

/** Every string of a rendered brief, for the lint. */
export function renderedBriefTexts(rendered: RenderedBrief): string[] {
  const session = rendered.key.session
  return [
    rendered.title,
    ...rendered.headline,
    ...rendered.context,
    rendered.changes.heading,
    rendered.changes.text,
    ...rendered.changes.causes,
    rendered.noticed.heading,
    ...rendered.noticed.items.map((item) => item.text),
    ...(rendered.noticed.empty === null ? [] : [rendered.noticed.empty]),
    rendered.key.heading,
    ...(session === null
      ? []
      : [
          session.line,
          session.readiness,
          ...session.targets.flatMap((row) => [
            row.term,
            row.value,
            ...(row.note ? [row.note] : []),
          ]),
        ]),
    ...(rendered.key.none === null ? [] : [rendered.key.none]),
  ]
}

/**
 * Today's brief line (design 8.6): how many sessions the update changed, and the next key session.
 * `changeCount` and `nextKey` are the fields of `GET /api/briefs`.
 */
export function renderBriefLine(
  item: { changeCount: number; nextKey: { date: string; kind: SessionKind } | null },
  units: Units,
): string {
  const { changeCount, nextKey } = item
  const size = changeCount <= 0 ? 'none' : changeCount === 1 ? 'one' : 'many'
  if (nextKey === null) {
    const id = {
      none: 'brief.line-none-no-key',
      one: 'brief.line-one-no-key',
      many: 'brief.line-many-no-key',
    } as const
    return size === 'many'
      ? render(BRIEF_TEMPLATES[id.many], { n: count(changeCount) }, units)
      : briefText(id[size], units)
  }
  const slots = {
    day: { kind: 'weekday', iso: nextKey.date, style: 'long' } as const,
    what: briefKindName(nextKey.kind, units),
  }
  return size === 'many'
    ? render(BRIEF_TEMPLATES['brief.line-many'], { ...slots, n: count(changeCount) }, units)
    : render(BRIEF_TEMPLATES[size === 'one' ? 'brief.line-one' : 'brief.line-none'], slots, units)
}
