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
      'Heat days count from runs at 25 °C or more, runs in extra layers or a warm room, or a hot bath or sauna after an easy run.',
    )
    // a heat threshold reads in °C with miles too, as the other heat rules do (`quantityParts`)
    expect(render(TEMPLATES['heat.note.counts'], slots, 'mi')).toContain('runs at 25 °C or more')
  })

  it('offers three marks, none first, with the owner labels', () => {
    expect(HEAT_MARK_OPTIONS.map((o) => o.value)).toEqual([null, 'overdressed', 'passive'])
    expect(HEAT_MARK_OPTIONS.map((o) => say(o.label))).toEqual([
      'None',
      'Ran overdressed or in a warm room',
      'Hot bath or sauna after',
    ])
  })

  it('keeps the safety lines to the five the owner named, the last asking a clinician', () => {
    const lines = HEAT_SAFETY_LINES.map((id) => say(id))
    expect(lines).toEqual([
      'Drink before and after.',
      'Start shorter than you think you need to.',
      'Do not do it alone at first.',
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
  })

  it('is an option and never a target: nothing counts days or says one is missing', () => {
    const ids = [
      'heat.mark.hint',
      'heat.note.counts',
      'heat.note.option',
      ...HEAT_SAFETY_LINES,
      'explain.i8-counts',
      'explain.i8-safety',
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
