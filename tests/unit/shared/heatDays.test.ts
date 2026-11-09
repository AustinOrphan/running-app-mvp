import { describe, expect, it } from 'vitest'
import { HEAT_MARK_OPTIONS, HEAT_SAFETY_LINES } from '../../../shared/copy/heatDays.ts'
import { lintText } from '../../../shared/copy/lint.ts'
import { render } from '../../../shared/copy/template.ts'
import { TEMPLATES } from '../../../shared/copy/templates.ts'

const say = (id: keyof typeof TEMPLATES, units: 'km' | 'mi' = 'km') =>
  render(TEMPLATES[id] as never, {}, units)

describe('heat day copy (rule I8, HT1)', () => {
  it('says what counts in the owner words, in the runner units', () => {
    const slots = { temp: { kind: 'temp', c: 25 } } as const
    expect(render(TEMPLATES['heat.note.counts'], slots, 'km')).toBe(
      'Heat days count from runs at 25 °C or more, outdoors or in a warm room, or a hot bath or sauna after an easy run.',
    )
    // a heat threshold reads in °C with miles too, as the other heat rules do (`quantityParts`)
    expect(render(TEMPLATES['heat.note.counts'], slots, 'mi')).toContain('runs at 25 °C or more')
  })

  it('offers three marks, none first, with the owner labels', () => {
    expect(HEAT_MARK_OPTIONS.map((o) => o.value)).toEqual([null, 'warm-room', 'passive'])
    expect(
      HEAT_MARK_OPTIONS.map((o) =>
        o.value === 'warm-room'
          ? render(TEMPLATES['heat.mark.warm-room'], { temp: { kind: 'temp', c: 25 } }, 'km')
          : say(o.label as 'heat.mark.none'),
      ),
    ).toEqual(['None', 'Ran in a warm room (25 °C or more)', 'Hot bath or sauna after'])
  })

  it('states the dose studied and keeps the safety lines, the last asking a clinician', () => {
    expect(say('heat.dose')).toBe(
      'The trials used about 40 minutes in water at about 40 °C, or about 30 minutes in a sauna, straight after an easy run, on consecutive days.',
    )
    expect(say('explain.i8-dose')).toBe(say('heat.dose'))
    expect(HEAT_SAFETY_LINES.map((id) => say(id))).toEqual([
      'Drink before and after.',
      'Start shorter than that.',
      'Do not go hotter than that.',
      'Not after a hard or long run, or a run in the heat.',
      'Not when you are unwell, feverish or dehydrated.',
      'No alcohol before or during.',
      'Do not do it alone at first.',
      'Stand up slowly afterwards.',
      'Get out if you feel dizzy, sick or confused.',
      'Skip it with a heart or blood-pressure condition, in pregnancy, or on medicines that change how you handle heat, and ask a clinician.',
    ])
  })

  it('writes the Explain sentences with the same words as Today', () => {
    const slots = { temp: { kind: 'temp', c: 25 } } as const
    expect(render(TEMPLATES['explain.i8-counts'], slots, 'km')).toBe(
      render(TEMPLATES['heat.note.counts'], slots, 'km'),
    )
    expect(say('explain.i8-safety-ask')).toBe(say('heat.safe.clinician'))
    const safety = say('explain.i8-safety').toLowerCase()
    for (const phrase of ['drink before and after', 'start shorter', 'alone at first', 'dizzy']) {
      expect(safety).toContain(phrase)
    }
    const more = say('explain.i8-safety-more').toLowerCase()
    for (const phrase of ['hotter', 'hard or long run', 'unwell', 'alcohol', 'stand up slowly']) {
      expect(more).toContain(phrase)
    }
  })

  it('is an option and never a target: nothing counts days or says one is missing', () => {
    const ids = [
      'heat.mark.hint',
      'heat.note.counts',
      'heat.note.option',
      'heat.dose',
      ...HEAT_SAFETY_LINES,
      'explain.i8-counts',
      'explain.i8-dose',
      'explain.i8-safety',
      'explain.i8-safety-more',
      'explain.i8-safety-ask',
    ] as const
    for (const id of ids) {
      const text = id.endsWith('counts')
        ? render(TEMPLATES[id] as never, { temp: { kind: 'temp', c: 25 } } as never, 'km')
        : say(id)
      expect(lintText(text), id).toEqual([])
      expect(text, id).not.toMatch(/\b(behind|missing|left|remaining|target of|goal of)\b/i)
    }
  })
})
