// "What stood out" as the page reads it: the stored facts of a run turned into sentences in the
// runner's units, each with the name its Why button carries and the rules the Why opens on. The
// facts are chosen by `shared/engine/standout.ts`; the words are `standoutTemplates.ts`.
import type { InputFact } from '../engine/types.ts'
import type { Units } from '../types.ts'
import { STANDOUT_KINDS, STANDOUT_SUBJECT_IDS, type StandoutKind } from './standoutTemplates.ts'
import { render } from './template.ts'
import { renderFact, TEMPLATES } from './templates.ts'

/**
 * `GET /api/activities/:id/standout`: at most `STANDOUT_MAX_CARDS` facts in the order a run shows
 * them, and how many more findings were left out. A fact keeps its template id and slots; the page
 * renders the sentence (`renderStandouts`) in the runner's units.
 */
export interface StandoutView {
  items: InputFact[]
  more: number
}

/** The rule that holds the standout thresholds; every finding's Why also opens on it. */
export const STANDOUT_RULE = 'design-explain'

/** The finding a fact stands for: the last part of its id (`a8.hr-higher`), or null if unknown. */
export function standoutKindOf(fact: Pick<InputFact, 'id'>): StandoutKind | null {
  const kind = fact.id.slice(fact.id.lastIndexOf('.') + 1)
  return (STANDOUT_KINDS as readonly string[]).includes(kind) ? (kind as StandoutKind) : null
}

export interface RenderedStandout {
  id: string
  /** The sentence. */
  text: string
  /** What the Why button names: "heart rate", "longest run". */
  subject: string
  /** The rules the Why opens on: the finding's own, then the one that holds the thresholds. */
  rules: string[]
}

export function renderStandouts(view: StandoutView, units: Units): RenderedStandout[] {
  return view.items.map((fact) => {
    const kind = standoutKindOf(fact)
    const subject = render(
      TEMPLATES[kind === null ? 'standout.heading' : STANDOUT_SUBJECT_IDS[kind]],
      {},
      units,
    )
    return {
      id: fact.id,
      text: renderFact(fact, units),
      subject: subject.toLowerCase(),
      rules: [...new Set([fact.rule, STANDOUT_RULE])],
    }
  })
}
