// The words of the Strength page, its setup sheets and its sections, rendered from the templates in
// `shared/copy/strengthPage.ts` (and the ones the logging sheet shares, `strengthTemplates.ts`). A
// page and a sheet import from here and never type a sentence of their own, so the shared G5 lint
// covers every word, and a load reads in the runner's weight unit: one place makes every sentence
// of the page in the unit it was given.
import { countPhrase } from '../../../shared/copy/quantity.ts'
import { STRENGTH_PAGE_TEMPLATES } from '../../../shared/copy/strengthPage.ts'
import { STRENGTH_TEMPLATES } from '../../../shared/copy/strengthTemplates.ts'
import { render, type Template } from '../../../shared/copy/template.ts'
import type { Quantity } from '../../../shared/engine/types.ts'
import type {
  EquipmentKind,
  Slot,
  StrengthBlockView,
  StrengthLogMode,
  StrengthSettings,
  Units,
  WeightUnit,
} from '../../../shared/types.ts'
import { strengthWords } from './strengthText.ts'

const ALL = { ...STRENGTH_TEMPLATES, ...STRENGTH_PAGE_TEMPLATES }

/** A template of the page or of the shared strength words. */
export type PageTemplateId = keyof typeof ALL

const count = (n: number): Quantity => ({ kind: 'count', n })
const load = (g: number): Quantity => ({ kind: 'load', g })
const minutes = (min: number): Quantity => ({ kind: 'minutes', min })
const day = (iso: string, style: 'short' | 'weekday' | 'long' = 'short'): Quantity => ({
  kind: 'date',
  iso,
  style,
})

/**
 * The words of the page in the runner's units. `say` fills one template by id; the rest are the
 * sentences that take more than a template (a name chosen by a kind, the line about what follows
 * in the block) and the quantities the templates take.
 */
export function pageWords(units: Units, weightUnit: WeightUnit) {
  const base = strengthWords(units, weightUnit)

  function say(id: PageTemplateId, slots: Record<string, Quantity | string> = {}): string {
    return render(ALL[id] as Template, slots as never, units, weightUnit)
  }

  /** The name of an item of equipment: "Dumbbells". */
  function kind(equipment: EquipmentKind): string {
    return say(`strength.page.kind-${equipment}`)
  }

  /** The name of a slot of the catalogue: "Squats and steps". */
  function slot(name: Slot): string {
    return say(`strength.page.slot-${name}`)
  }

  /** The runner's lifting level in a word: "Some". */
  function level(value: StrengthSettings['level']): string {
    return say(`strength.page.level-${value}`)
  }

  /** What the level means, one sentence. */
  function levelHint(value: StrengthSettings['level']): string {
    return say(`strength.page.level-hint-${value}`)
  }

  /** How a logged session was run, in a word: "Lighter day". */
  function mode(value: StrengthLogMode): string {
    return say(`strength.page.mode-${value}`)
  }

  /** "Week 6 of 12, heavy": where the current week stands in its block. */
  function position(block: StrengthBlockView): string {
    return say('strength.page.block-position', {
      week: count(block.week),
      of: count(block.of),
      template: say(`strength.template.${block.template}`),
    })
  }

  /** What follows in the block, in one line, by the template of the current week. */
  function follows(block: StrengthBlockView): string {
    const of = count(block.of)
    switch (block.template) {
      case 'ramp-in':
        return say('strength.page.follows-ramp-in', {
          weeks: countPhrase(block.rampInWeeks, 'week'),
          of,
        })
      case 'heavy':
        return say('strength.page.follows-heavy', { of })
      case 'lighter-week':
        return say('strength.page.follows-lighter-week', { of })
      case 'taper':
        return say('strength.page.follows-taper')
      case 'return':
        return say('strength.page.follows-return', { of })
      case 'maintenance':
        return say('strength.page.follows-maintenance')
    }
  }

  return {
    ...base,
    say,
    kind,
    slot,
    level,
    levelHint,
    mode,
    position,
    follows,
    load,
    minutes,
    day,
  }
}

export type PageWords = ReturnType<typeof pageWords>
