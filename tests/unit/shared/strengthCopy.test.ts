import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { COPY_MAX_CHARS } from '../../../shared/copy/limits.ts'
import { lintText } from '../../../shared/copy/lint.ts'
import {
  describeParamRange,
  describeParamValue,
  isMappedUnit,
} from '../../../shared/copy/paramUnits.ts'
import { countPhrase } from '../../../shared/copy/quantity.ts'
import {
  STRENGTH_TEMPLATES,
  type StrengthTemplateId,
} from '../../../shared/copy/strengthTemplates.ts'
import {
  placeholdersOf,
  render,
  sampleSlots,
  type Template,
} from '../../../shared/copy/template.ts'
import { TEMPLATES, renderFact } from '../../../shared/copy/templates.ts'
import { EXERCISES } from '../../../shared/domain/strengthLibrary.ts'
import { toGrams } from '../../../shared/domain/weight.ts'
import { allParams, P } from '../../../shared/engine/params/index.ts'
import type { Quantity } from '../../../shared/engine/types.ts'
import type { StrengthTemplate, Units, WeightUnit } from '../../../shared/types.ts'

const ids = Object.keys(STRENGTH_TEMPLATES) as StrengthTemplateId[]
const UNITS: Units[] = ['km', 'mi']
const WEIGHT_UNITS: WeightUnit[] = ['lb', 'kg']

const count = (n: number): Quantity => ({ kind: 'count', n })
const percent = (pct: number): Quantity => ({ kind: 'percent', pct })

/** The sentence of a strength template for the slots, in pounds unless asked otherwise. */
function say(
  id: StrengthTemplateId,
  slots: Record<string, Quantity | string> = {},
  weightUnit?: WeightUnit,
): string {
  return render(STRENGTH_TEMPLATES[id] as Template, slots as never, 'km', weightUnit)
}

/** The rendered name of an exercise, as a caller fills the `{exercise}` slot. */
const name = (id: (typeof EXERCISES)[number]['id']): string => say(`strength.name.${id}`)

describe('the registry', () => {
  it('spreads every strength template into the one registry the lint test renders', () => {
    expect(ids.length).toBeGreaterThan(100)
    for (const id of ids) {
      expect(id, id).toMatch(/^strength\./)
      expect(TEMPLATES[id], id).toBe(STRENGTH_TEMPLATES[id])
    }
  })

  it('holds a name and a cue for each of the 25 exercises', () => {
    expect(ids.filter((id) => id.startsWith('strength.name.'))).toHaveLength(25)
    expect(ids.filter((id) => id.startsWith('strength.cue.'))).toHaveLength(25)
    for (const e of EXERCISES) {
      expect(ids, e.id).toContain(`strength.name.${e.id}`)
      expect(ids, e.id).toContain(`strength.cue.${e.id}`)
    }
  })

  it('names each template of a session, as the type lists them', () => {
    // a Record, so a template added to the type fails to compile here until it has a name
    const words: Record<StrengthTemplate, string> = {
      'ramp-in': 'ramp-in',
      heavy: 'heavy',
      'lighter-week': 'lighter week',
      maintenance: 'maintenance',
      taper: 'taper',
      return: 'return',
    }
    const keys = Object.keys(words) as StrengthTemplate[]
    expect(ids.filter((id) => id.startsWith('strength.template.')).sort()).toEqual(
      keys.map((key) => `strength.template.${key}`).sort(),
    )
    for (const key of keys) expect(say(`strength.template.${key}`), key).toBe(words[key])
  })
})

describe('every strength template', () => {
  it.each(ids)('%s declares exactly the slots its text uses', (id) => {
    const template: Template = STRENGTH_TEMPLATES[id]
    expect(Object.keys(template.slots).sort(), id).toEqual(placeholdersOf(template.text).sort())
    expect(placeholdersOf(template.fallback), `${id} fallback`).toEqual([])
  })

  it.each(ids)(
    '%s renders within 160 characters, clean and finished, in both distance units and both weight units',
    (id) => {
      const template: Template = STRENGTH_TEMPLATES[id]
      for (const units of UNITS) {
        for (const weightUnit of WEIGHT_UNITS) {
          const text = render(template, sampleSlots(template), units, weightUnit)
          expect(lintText(text), `${id}: ${text}`).toEqual([])
          expect(text.length, `${id}: ${text}`).toBeLessThanOrEqual(COPY_MAX_CHARS)
          expect(text, id).not.toMatch(/\{|\}|NaN|undefined|null/)
          if (template.shape === 'sentence') expect(text, id).toMatch(/\.$/)
        }
      }
      expect(lintText(template.fallback), `${id} fallback`).toEqual([])
      expect(template.fallback.length, `${id} fallback`).toBeLessThanOrEqual(COPY_MAX_CHARS)
    },
  )

  it('is a sentence ending in a full stop wherever it is not a label', () => {
    for (const id of ids) {
      const template: Template = STRENGTH_TEMPLATES[id]
      if (template.shape === 'sentence') {
        expect(template.text, id).toMatch(/\.$/)
        expect(template.fallback, id).toMatch(/\.$/)
      }
    }
    // the cues, the notes and the reasons are all sentences; the names are labels
    for (const id of ids) {
      const template: Template = STRENGTH_TEMPLATES[id]
      const isSentence = /^strength\.(?:cue|note|reason)\./.test(id)
      if (isSentence) expect(template.shape, id).toBe('sentence')
      if (id.startsWith('strength.name.')) expect(template.shape, id).toBe('label')
    }
  })

  it('puts no digit in a text: every number is a slot', () => {
    for (const id of ids) {
      const template: Template = STRENGTH_TEMPLATES[id]
      expect(template.text, id).not.toMatch(/\d/)
      expect(template.fallback, id).not.toMatch(/\d/)
    }
  })

  it('never says "you" or "your": the strength copy is addressed to nobody in particular', () => {
    for (const id of ids) {
      const template: Template = STRENGTH_TEMPLATES[id]
      expect(`${template.text} ${template.fallback}`, id).not.toMatch(/\byou(?:r|rs|rself)?\b/i)
    }
  })

  it('keeps clear of the gym vocabulary of design 11.6', () => {
    const never =
      /\b(?:PR|PRs|personal best|personal record|PB|failure|failed|fail|to failure|missed|miss|crush|smash|deload|streak|badge|trophy|required|progressive overload|level up|complete workout|max out|no pain, no gain|1RM|one-rep max|behind|lazy)\b|!/i
    for (const id of ids) {
      const template: Template = STRENGTH_TEMPLATES[id]
      expect(`${template.text} ${template.fallback}`, id).not.toMatch(never)
    }
  })

  it('claims no benefit beyond design 4.5: no race time, no injury figure, no VO2max', () => {
    for (const id of ids) {
      const { text } = STRENGTH_TEMPLATES[id] as Template
      expect(text, id).not.toMatch(/VO2|threshold|faster|injur|prevent|protect/i)
    }
    // the one place race time appears says the sentence makes no claim about it
    expect(ids.filter((id) => /race time/.test((STRENGTH_TEMPLATES[id] as Template).text))).toEqual(
      ['strength.benefit'],
    )
  })
})

describe('the cues, the notes and the safety line', () => {
  it('words the back squat as design 7.6 does', () => {
    expect(say('strength.cue.back-squat')).toBe(
      'Bar on the upper back, feet about shoulder width, sit back and down until the thighs are about parallel, and stand up.',
    )
  })

  it('words the safety line as design 7.6 does', () => {
    expect(say('strength.safety')).toBe(
      'Stop a set if anything hurts or form changes. Learn barbell lifts from a coach before adding load.',
    )
  })

  it('takes the lowering seconds from the Param, not from the words', () => {
    const seconds = count(P.f7.lowerSeconds.value)
    expect(say('strength.note.lower-stand', { seconds })).toBe(
      `Lower over ${String(P.f7.lowerSeconds.value)} seconds, then stand up without a pause.`,
    )
    expect(say('strength.note.lower-return', { seconds })).toBe(
      `Lower over ${String(P.f7.lowerSeconds.value)} seconds, then return without a pause.`,
    )
    expect(say('strength.note.calf', { seconds })).toBe(
      `Lower over ${String(P.f7.lowerSeconds.value)} seconds to a full stretch, pause briefly, then rise.`,
    )
    expect(describeParamValue(P.f7.lowerSeconds, 'km')).toBe(`${String(P.f7.lowerSeconds.value)} s`)
  })

  it('words the jump and trunk notes as design 7.6 does, with no height, no depth and no tempo', () => {
    expect(say('strength.note.plyo')).toBe(
      'Land softly and leave the ground quickly. Stop the set when contacts get slower.',
    )
    expect(say('strength.note.controlled')).toBe('Move slowly and stay in control.')
  })

  it('has a cue of at most two sentences for each exercise, with no number', () => {
    for (const e of EXERCISES) {
      const cue = say(e.cue)
      const sentences = cue.split(/(?<=\.)\s+/)
      expect(sentences.length, cue).toBeLessThanOrEqual(2)
      expect(cue, e.id).not.toMatch(/\d/)
    }
  })

  it('names the 25 exercises as the design does', () => {
    expect(EXERCISES.map((e) => say(e.name))).toEqual([
      'Back squat',
      'Leg press',
      'Goblet squat',
      'Split squat',
      'Step-up',
      'Tempo squat',
      'Single-leg box squat',
      'Romanian deadlift',
      'Dumbbell Romanian deadlift',
      'Kettlebell Romanian deadlift',
      'Leg curl',
      'Hip thrust (glute bridge)',
      'Single-leg Romanian deadlift',
      'Standing calf raise',
      'Bent-knee calf raise',
      'Single-leg calf raise',
      'Pogo hops',
      'Line hops',
      'Squat jumps',
      'Single-leg hops in place',
      'Side plank',
      'Dead bug',
      'Banded lateral walk',
      'Pallof press',
      'Farmer carry',
    ])
  })
})

describe('the sentences of design 11.6', () => {
  const squat = name('back-squat')
  const [repsLo, repsHi] = P.flib.heavyReps.range ?? [0, 0]
  const topSets = P.flib.heavySets.range?.[1] ?? 0
  const [rirLo, rirHi] = P.f7.heavyRir.value

  it('says why the load goes up one step', () => {
    expect(say('strength.reason.increase', { exercise: squat, top: count(repsHi) })).toBe(
      `Every set of Back squat reached ${String(repsHi)} reps with reps left, so the load goes up one step.`,
    )
  })

  it('says why it goes up two steps, with the reps left of the Param', () => {
    expect(
      say('strength.reason.increase-two', {
        exercise: squat,
        top: count(repsHi),
        rir: count(P.f8.bigStepRir.value),
      }),
    ).toBe(
      `Every set of Back squat reached ${String(repsHi)} reps with ${String(P.f8.bigStepRir.value)} or more reps left, so the load goes up two steps.`,
    )
  })

  it('says that a missing count holds the load', () => {
    expect(say('strength.reason.hold-unrecorded')).toBe(
      'The count of reps left was not recorded, so the load holds.',
    )
  })

  it('says why the load comes down: a set short of the range, never "failed"', () => {
    const slots = { set: count(3), exercise: squat, lo: count(repsLo), hi: count(repsHi) }
    expect(say('strength.reason.reduce', { ...slots, count: count(2) })).toBe(
      `Set 3 of Back squat ended at 2 reps, below the ${String(repsLo)} to ${String(repsHi)} range, so the load comes down one step.`,
    )
    // one rep has its own template, so the sentence never reads "1 reps"
    expect(say('strength.reason.reduce-one', slots)).toBe(
      `Set 3 of Back squat ended at one rep, below the ${String(repsLo)} to ${String(repsHi)} range, so the load comes down one step.`,
    )
    expect(say('strength.reason.reduce', { ...slots, count: count(0) })).toContain(
      'ended at 0 reps',
    )
  })

  it('says why a lighter day has one set fewer, with the Param doing the counting', () => {
    const sets = countPhrase(P.f9.lowReadinessSetsCut.value, 'set')
    expect(say('strength.reason.lighter-day', { sets })).toBe(
      'Readiness is lower than usual today, so each lift has one set fewer at a lighter load.',
    )
    expect(
      say('strength.lighter-today', { sets, pct: percent(P.f9.lowReadinessLoadPct.value) }),
    ).toBe('Lighter today: one set fewer and 10% less. The usual load is one tap away.')
    // a different Param would change the sentence, not leave "one" in it
    expect(say('strength.reason.lighter-day', { sets: countPhrase(2, 'set') })).toContain(
      'two sets fewer',
    )
  })

  it('writes a workout row as design 11.1 shows it', () => {
    const slots = {
      exercise: squat,
      sets: count(topSets),
      lo: count(repsLo),
      hi: count(repsHi),
      load: { kind: 'load', g: toGrams(110, 'lb') } as const,
      rirLo: count(rirLo),
      rirHi: count(rirHi),
    }
    expect(say('strength.hero.workout-row', slots)).toBe(
      `Back squat: ${String(topSets)} x ${String(repsLo)} to ${String(repsHi)}, 110 lb, leave ${String(rirLo)} to ${String(rirHi)}.`,
    )
    expect(say('strength.hero.workout-row', slots, 'kg')).toBe(
      `Back squat: ${String(topSets)} x ${String(repsLo)} to ${String(repsHi)}, 50 kg, leave ${String(rirLo)} to ${String(rirHi)}.`,
    )
    const { load: _load, ...bodyweight } = slots
    expect(say('strength.hero.workout-row-bodyweight', bodyweight)).toBe(
      `Back squat: ${String(topSets)} x ${String(repsLo)} to ${String(repsHi)}, leave ${String(rirLo)} to ${String(rirHi)}.`,
    )
    expect(
      say('strength.hero.plyo-row', {
        movement: say('strength.name.pogo-hop'),
        contacts: count(P.f7.maintenancePlyoContacts.value),
      }),
    ).toBe(`Pogo hops, ${String(P.f7.maintenancePlyoContacts.value)} contacts.`)
    expect(
      say('strength.hero.trunk-row', {
        movements: `${name('side-plank')} and ${name('dead-bug').toLowerCase()}`,
        sets: count(P.f7.trunkSets.value),
      }),
    ).toBe(`Side plank and dead bug, ${String(P.f7.trunkSets.value)} sets.`)
  })

  it('reads the same grams in the runner’s weight unit, so a change of unit reaches old logs', () => {
    const load = { kind: 'load', g: toGrams(115, 'lb') } as const
    expect(say('strength.reason.hold-step', { load, pct: percent(15) })).toContain('from 115 lb')
    expect(say('strength.reason.hold-step', { load, pct: percent(15) }, 'kg')).toContain(
      'from 52.25 kg',
    )
  })

  it('renders a stored fact from grams, so a change of unit reaches old logs', () => {
    const fact = {
      template: 'strength.reason.hold-step',
      slots: { load: { kind: 'load', g: 49895 }, pct: percent(P.f8.maxStepPct.value) },
    } as const
    expect(renderFact(fact, 'km')).toBe(
      'The next step up from 110 lb would be more than 15% of the load, so the load holds.',
    )
    expect(renderFact(fact, 'km', 'lb')).toBe(renderFact(fact, 'mi'))
    expect(renderFact(fact, 'km', 'kg')).toBe(
      'The next step up from 50 kg would be more than 15% of the load, so the load holds.',
    )
  })

  it('states the benefit with the numbers of its Param, as small, after a full block, with no claim about race time', () => {
    const [lo, hi] = P.f7.expectedBenefitPct.value
    const sentence = say('strength.benefit', { lo: count(lo), hi: percent(hi) })
    expect(sentence).toBe(
      'Strength work may lower the oxygen cost of running by about 2 to 4% after a full block. That is small, and it says nothing about race time.',
    )
    // the three qualifiers of design 4.5 and ADR 0014 stay in the one sentence
    expect(sentence).toMatch(/\bmay lower\b/)
    expect(sentence).toContain('after a full block')
    expect(sentence).toMatch(/\bThat is small\b/)
    expect(sentence).toContain('says nothing about race time')
    expect(sentence.length).toBeLessThanOrEqual(COPY_MAX_CHARS)
    expect(lintText(sentence)).toEqual([])
    // the sentence and the registry read the range the same way
    expect(sentence).toContain(describeParamValue(P.f7.expectedBenefitPct, 'km'))
    expect(describeParamValue(P.f7.expectedBenefitPct, 'mi')).toBe(
      describeParamValue(P.f7.expectedBenefitPct, 'km'),
    )
    expect(P.f7.expectedBenefitPct.grade).toBe('A')
  })

  it('takes the separation hours from rule F4', () => {
    expect(say('strength.separation', { hours: count(P.f4.strengthSeparationHours.value) })).toBe(
      'Lift at least 3 hours before or after a run.',
    )
  })

  it('shows the estimated maximum only as an estimate, beside the heavy floor', () => {
    expect(say('strength.max-label')).toBe('Estimated maximum, from submaximal sets')
    expect(
      say('strength.max-share', {
        pct: percent(83),
        floor: percent(P.flib.heavyMinPct1rm.value),
      }),
    ).toBe('About 83% of the estimated maximum; heavy work asks for 80% or more.')
    const withMax = ids.filter((id) => /maximum/.test((STRENGTH_TEMPLATES[id] as Template).text))
    expect(withMax.every((id) => !id.startsWith('strength.hero.'))).toBe(true)
  })

  it('reads the return, the variation and the first load from their Params', () => {
    expect(
      say('strength.reason.return', {
        exercise: squat,
        days: count(P.f8.layoffDays.value),
        share: { kind: 'share', fraction: P.f8.layoffLoadFraction.value },
      }),
    ).toBe(
      'The last session of Back squat was 28 days ago, so the load comes back to about 90% of the last working load.',
    )
    expect(
      say('strength.reason.variation', {
        exercise: name('goblet-squat'),
        sessions: count(P.f8.ceilingSessions.value),
        next: name('split-squat'),
      }),
    ).toBe(
      'Goblet squat stayed at the top of the range for 3 sessions with no usable step, so the next movement is Split squat.',
    )
    expect(
      say('strength.reason.start-anchor', {
        exercise: squat,
        pct: percent(P.f8.startPctOf1rm.value),
      }),
    ).toBe('Back squat has no sets logged yet, so it starts at 70% of the estimated maximum.')
    expect(
      say('strength.reason.hold-ceiling', { pct: percent(P.flib.heavyMinPct1rm.range?.[1] ?? 0) }),
    ).toBe('The next step would pass 90% of the estimated maximum, so the load holds.')
    expect(
      say('strength.reason.hold-step', {
        load: { kind: 'load', g: toGrams(50, 'lb') },
        pct: percent(P.f8.maxStepPct.value),
      }),
    ).toBe('The next step up from 50 lb would be more than 15% of the load, so the load holds.')
  })

  it('counts the sets of a lighter week and of the taper from the Param', () => {
    const sets = countPhrase(P.f7.maintenanceSets.value, 'set')
    expect(say('strength.reason.lighter-week', { sets })).toBe(
      'This is a lighter week, so each lift has two sets at the usual load.',
    )
    expect(say('strength.reason.taper', { sets })).toBe(
      'The taper keeps the lead lift and the calf raise at the usual load, with two sets of each.',
    )
  })

  it('heads a session as design 9.1 does', () => {
    expect(
      say('strength.heading', { template: say('strength.template.heavy'), variant: 'A' }),
    ).toBe('Strength, heavy A')
  })

  it('uses the words of the vocabulary table', () => {
    expect(
      [
        'strength.label.suggested',
        'strength.label.reps-left',
        'strength.label.reps-left-first',
        'strength.label.short-of-range',
        'strength.label.heaviest-set',
        'strength.label.lighter-day',
        'strength.label.up-one-step',
        'strength.label.load-holds',
        'strength.label.log-sets',
        'strength.label.add-sets',
      ].map((id) => say(id as StrengthTemplateId)),
    ).toEqual([
      'Suggested',
      'Reps left',
      'Reps left in reserve',
      'Short of the range',
      'Heaviest set',
      'Lighter day',
      'Up one step',
      'The load holds',
      'Log sets',
      'Add the sets',
    ])
  })

  it('says what a load means beside the field', () => {
    expect(
      ['total-with-bar', 'stack', 'one-implement', 'added'].map((basis) =>
        say(`strength.basis.${basis}` as StrengthTemplateId),
      ),
    ).toEqual([
      'Total, including the bar',
      'Stack or plate total',
      'Weight of one dumbbell or kettlebell',
      'Added weight',
    ])
  })
})

describe('shared/copy/strengthTemplates.ts', () => {
  /** The source with its comments removed, so a figure in a comment is not counted. */
  const code = readFileSync(
    join(import.meta.dirname, '../../../shared/copy/strengthTemplates.ts'),
    'utf8',
  )
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`])\/\/.*$/gm, '$1')

  it('has no figure inside a string of its copy', () => {
    const literals = [
      ...code.matchAll(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g),
    ].map((match) => match[0])
    expect(literals.length).toBeGreaterThan(200)
    // the template ids carry no digit either; the only strings with a digit would be a figure
    expect(literals.filter((literal) => /\d/.test(literal))).toEqual([])
  })
})

describe('the Params of rules F7 to F9 in the drawer', () => {
  const strength = allParams().filter((p) => /^(?:f7|f8|f9)\./.test(p.id))

  it('covers every Param of the three groups', () => {
    expect(strength.length).toBe(
      Object.keys(P.f7).length + Object.keys(P.f8).length + Object.keys(P.f9).length,
    )
  })

  it('maps the unit of each, so the registry test can read it', () => {
    for (const p of strength) {
      if (p.unit !== undefined) expect(isMappedUnit(p.unit), `${p.id}: ${p.unit}`).toBe(true)
    }
  })

  it('reads each in plain words in both unit systems, with no raw ids, braces or dashes', () => {
    for (const p of strength) {
      for (const units of UNITS) {
        const text = describeParamValue(p, units)
        expect(text, `${p.id}: ${text}`).not.toMatch(/NaN|undefined|null|\[object|\{|\}|—|"/)
        expect(lintText(text), p.id).toEqual([])
        const range = describeParamRange(p, units)
        if (range !== null) expect(range, p.id).not.toMatch(/NaN|undefined|null|\{|\}|—/)
      }
    }
  })

  it('reads the doses as the design states them', () => {
    const read = (p: Parameters<typeof describeParamValue>[0]) => describeParamValue(p, 'km')
    expect(read(P.f7.blockSessionMin)).toBe('40 min')
    expect(read(P.f7.maintenanceSessionMin)).toBe('25 min')
    expect(read(P.f7.rampInReps)).toBe('6 to 8 repetitions')
    expect(read(P.f7.rampInSets)).toBe('2 to 3 sets')
    expect(read(P.f7.easyRir)).toBe('3 repetitions in reserve')
    expect(read(P.f7.heavyRir)).toBe('1 to 3 repetitions in reserve')
    expect(read(P.f7.plyoStartContacts)).toBe('40 contacts')
    expect(read(P.f7.reducedPlyoShare)).toBe('50%')
    expect(read(P.f7.expectedBenefitPct)).toBe('2 to 4%')
    expect(read(P.f8.progressMinRir)).toBe('1 repetition in reserve')
    expect(read(P.f8.maxStepPct)).toBe('15%')
    expect(read(P.f8.ceilingSessions)).toBe('3 sessions in a row')
    expect(read(P.f8.layoffDays)).toBe('28 days')
    expect(read(P.f8.layoffLoadFraction)).toBe('90%')
    expect(read(P.f8.startPctOf1rm)).toBe('70% of one-repetition maximum')
    expect(read(P.f9.lowReadinessLoadPct)).toBe('10%')
    expect(read(P.f9.lowReadinessSetsCut)).toBe('1 set')
  })

  it('reads the table of first loads by exercise name and as shares of body weight', () => {
    const text = describeParamValue(P.f8.startFractionBodyweight, 'km')
    expect(text.startsWith('Shares of body weight: Back squat 35%, Leg press 50%')).toBe(true)
    expect(text).toContain('Single-leg box squat 0%')
    expect(text).toContain('Hip thrust (glute bridge) 30%')
    expect(text).not.toMatch(/back-squat|[{}"]/)
    expect(describeParamValue(P.f8.startFractionBodyweight, 'mi')).toBe(text)
    expect(describeParamRange(P.f8.startFractionBodyweight, 'km')).toBeNull()
  })
})
