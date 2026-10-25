// The sentences of the load setting [rules g-8, proposal 4.6]: the three positions with their
// hints and the trade-off line on the Generate form, what the Plan page says about the position
// in effect and why a chosen one does not apply, and the focus of a week in the rebuild zone. A
// step and the age of the cap are read from the Params (`positionStep`, `a9.noviceFlagAgeMin`),
// never written here, and the page reads the position in effect from the plan payload
// (`PlanWithSessions.load`), never from its own sums.
//
// Ids are `load.<name>`; the set is spread into `TEMPLATES`.
import type { LoadHold, LoadPosition } from '../engine/loadSetting.ts'
import { positionStep } from '../engine/loadSetting.ts'
import { P } from '../engine/params/index.ts'
import { LOAD_APPETITES, type LoadAppetite } from '../engine/types.ts'
import type { Units } from '../types.ts'
import { countPhrase } from './quantity.ts'
import { render, tpl, type Template } from './template.ts'

export const LOAD_TEMPLATES = {
  // The field and its three positions.
  'load.field': tpl('Load', {}, { shape: 'label' }),
  'load.name.steady': tpl('Steady', {}, { shape: 'label' }),
  'load.name.standard': tpl('Standard', {}, { shape: 'label' }),
  'load.name.upper': tpl('Upper band', {}, { shape: 'label' }),

  // The hint under the chosen position.
  'load.hint.steady': tpl("Adds up to {pct} a week, the plan's usual step.", { pct: 'percent' }),
  'load.hint.standard': tpl(
    'Adds up to {pct} a week while rebuilding toward a level held in the last {weeks} weeks.',
    { pct: 'percent', weeks: 'count' },
  ),
  'load.hint.standard-response': tpl(
    'Weeks run above the plan raise the starting point of the next week, within the same limits.',
  ),
  'load.hint.upper': tpl(
    'Adds up to {pct} a week while rebuilding, the most the plan allows ({ceiling} over two weeks). Long runs and recovery weeks keep their usual rules.',
    { pct: 'percent', ceiling: 'percent' },
  ),
  'load.hint.upper-age': tpl('At age {age} or over, Upper band is held at Standard.', {
    age: 'count',
  }),

  // The trade-off, shown with the choice. The sentences are kept apart so that each one stays a
  // glance long.
  'load.tradeoff.speed': tpl('A faster step brings the earlier weekly level back sooner.'),
  'load.tradeoff.studies': tpl(
    'Studies comparing weekly increases found no clear difference in injuries between steps of about 10% and about 24%.',
  ),
  'load.tradeoff.unknown': tpl(
    'They followed mostly new runners, and none followed a return after a break, so the effect here is not known.',
  ),
  'load.tradeoff.cautious': tpl('Staying with {pct} is the more cautious choice.', {
    pct: 'percent',
  }),

  // The Plan page: the position in effect, and why the chosen one does not apply.
  'load.panel.title': tpl('Load setting', {}, { shape: 'label' }),
  'load.panel.set': tpl(
    'The plan was set to {position}.',
    { position: 'text' },
    { fallback: 'The plan was set to another position.' },
  ),
  'load.held': tpl(
    'The steady step applies for now: {reason}.',
    { reason: 'text' },
    { fallback: 'The steady step applies for now.' },
  ),
  'load.capped': tpl('The setting is held at Standard: age {age} or over.', { age: 'count' }),

  // The focus of a plan week in the rebuild zone, on the week table.
  'load.focus': tpl(
    'Rebuilding toward {minutes} a week',
    { minutes: 'minutes' },
    { shape: 'label', fallback: 'Rebuilding' },
  ),

  // The reasons a position is held at steady, as the end of "applies for now: ...".
  'load.hold.recent-injury': tpl('a recent injury is on file', {}, { shape: 'label' }),
  'load.hold.bone-stress': tpl('an earlier bone stress injury is on file', {}, { shape: 'label' }),
  'load.hold.bsi-factors': tpl(
    'at least {factors} for bone stress injury apply',
    { factors: 'text' },
    { shape: 'label', fallback: 'risk factors for bone stress injury apply' },
  ),
  'load.hold.reds-hold': tpl(
    'flags from the energy availability screening hold progression',
    {},
    { shape: 'label' },
  ),
  'load.hold.bone-pain': tpl('focal bone pain holds progression', {}, { shape: 'label' }),
  'load.hold.rest-window': tpl('a rest window is active', {}, { shape: 'label' }),
  'load.hold.post-race': tpl('the plan is in the weeks after a race', {}, { shape: 'label' }),
  'load.hold.low-frequency': tpl(
    'recent weeks held fewer than {runs} a week',
    { runs: 'text' },
    { shape: 'label', fallback: 'recent weeks held few runs' },
  ),
} satisfies Record<string, Template>

const T = LOAD_TEMPLATES

/** Percentages and counts read the same in either unit system. */
const UNITS: Units = 'km'

/** The positions in the order the form offers them. */
export const LOAD_POSITIONS: readonly LoadAppetite[] = LOAD_APPETITES

/** A fraction as a percentage to one decimal ("14%" for 0.1402, "12%" for 0.12). */
const percent = (fraction: number) =>
  ({ kind: 'percent', pct: Math.round(fraction * 1000) / 10 }) as const

const count = (n: number) => ({ kind: 'count', n }) as const

/** The label of a position: "Steady", "Standard", "Upper band". */
export function loadName(position: LoadAppetite): string {
  return render(T[`load.name.${position}`], {}, UNITS)
}

/** The label of the field. */
export function loadFieldLabel(): string {
  return render(T['load.field'], {}, UNITS)
}

/** The heading of the Plan page's panel. */
export function loadPanelTitle(): string {
  return render(T['load.panel.title'], {}, UNITS)
}

/**
 * The hint of a position, a sentence to a line: what the step is, and for Standard the response to
 * weeks run above the plan. Every figure is a Param.
 */
export function loadHintLines(position: LoadAppetite): string[] {
  const pct = percent(positionStep(position))
  switch (position) {
    case 'steady':
      return [render(T['load.hint.steady'], { pct }, UNITS)]
    case 'standard':
      return [
        render(T['load.hint.standard'], { pct, weeks: count(P.g8.creditWindowWeeks.value) }, UNITS),
        render(T['load.hint.standard-response'], {}, UNITS),
      ]
    case 'upper':
      return [
        render(
          T['load.hint.upper'],
          { pct, ceiling: percent(P.g2.rampCeilingTwoWeeks.value) },
          UNITS,
        ),
      ]
  }
}

/** The age at which Upper band is held at Standard, stated next to the choice on the form. */
export function loadAgeRule(): string {
  return render(T['load.hint.upper-age'], { age: count(P.a9.noviceFlagAgeMin.value) }, UNITS)
}

/** The trade-off shown with the choice, as one paragraph. */
export function loadTradeoff(): string {
  return [
    render(T['load.tradeoff.speed'], {}, UNITS),
    render(T['load.tradeoff.studies'], {}, UNITS),
    render(T['load.tradeoff.unknown'], {}, UNITS),
    render(T['load.tradeoff.cautious'], { pct: percent(positionStep('steady')) }, UNITS),
  ].join(' ')
}

/**
 * The focus of a plan week that uses the rebuild zone: what it rebuilds toward, the ceiling `R` in
 * whole minutes. Only the weeks the checklist counts as zone weeks carry it.
 */
export function loadFocus(ceilingMin: number): string {
  return render(
    T['load.focus'],
    { minutes: { kind: 'minutes', min: Math.round(ceilingMin) } },
    UNITS,
  )
}

/** Why a position is held at steady, as the end of "The steady step applies for now: ...". */
export function loadHoldReason(hold: LoadHold): string {
  switch (hold) {
    case 'recent-injury':
    case 'bone-stress':
    case 'reds-hold':
    case 'bone-pain':
    case 'rest-window':
    case 'post-race':
      return render(T[`load.hold.${hold}`], {}, UNITS)
    case 'bsi-factors':
      return render(
        T['load.hold.bsi-factors'],
        { factors: countPhrase(P.g3.bsiFactorsForCap.value, 'risk factor') },
        UNITS,
      )
    case 'low-frequency':
      return render(
        T['load.hold.low-frequency'],
        { runs: countPhrase(P.a5.lowFrequencyRunsPerWeek.value, 'run') },
        UNITS,
      )
  }
}

/** What the Plan page says about the position in effect. */
export interface LoadPanelText {
  /** The position in effect: "Steady", "Standard", "Upper band". */
  name: string
  /** The hint of that position, a sentence to a line. */
  hint: string[]
  /**
   * Why the position chosen for the plan does not apply, with the choice named first; empty when it
   * applies as chosen.
   */
  reason: string[]
}

/** The text of the Plan page's panel for the position the plan payload names. */
export function loadPanelText(load: LoadPosition): LoadPanelText {
  const lines: string[] = []
  if (load.held !== null) {
    lines.push(
      render(T['load.panel.set'], { position: loadName(load.requested) }, UNITS),
      render(T['load.held'], { reason: loadHoldReason(load.held) }, UNITS),
    )
  } else if (load.ageCapped) {
    lines.push(
      render(T['load.panel.set'], { position: loadName(load.requested) }, UNITS),
      render(T['load.capped'], { age: count(P.a9.noviceFlagAgeMin.value) }, UNITS),
    )
  }
  return { name: loadName(load.position), hint: loadHintLines(load.position), reason: lines }
}
