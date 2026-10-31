import { describe, expect, it } from 'vitest'
import {
  STRENGTH_PAGE_TEMPLATES,
  type StrengthPageTemplateId,
} from '../../../shared/copy/strengthPage.ts'
import { STRENGTH_TEMPLATES } from '../../../shared/copy/strengthTemplates.ts'
import { type Template } from '../../../shared/copy/template.ts'
import { TEMPLATES } from '../../../shared/copy/templates.ts'
import { EXERCISES } from '../../../shared/domain/strengthLibrary.ts'
import type {
  EquipmentKind,
  Slot,
  StrengthBlockView,
  StrengthLogMode,
  StrengthSettings,
  StrengthTemplate,
} from '../../../shared/types.ts'
import { pageWords } from '../../../web/components/strength/strengthPageText.ts'

const ids = Object.keys(STRENGTH_PAGE_TEMPLATES) as StrengthPageTemplateId[]
const words = pageWords('km', 'lb')

describe('the Strength page templates (design 6, 11.3, 11.6)', () => {
  it('are spread into the one registry the lint test renders, and none shadows a template of the logging sheet', () => {
    expect(ids.length).toBeGreaterThan(100)
    for (const id of ids) {
      expect(id, id).toMatch(/^strength\.page\./)
      expect(TEMPLATES[id], id).toBe(STRENGTH_PAGE_TEMPLATES[id])
      expect(Object.keys(STRENGTH_TEMPLATES), id).not.toContain(id)
    }
  })

  it('put no digit in a text: every number is a slot', () => {
    for (const id of ids) {
      const template: Template = STRENGTH_PAGE_TEMPLATES[id]
      expect(template.text, id).not.toMatch(/\d/)
      expect(template.fallback, id).not.toMatch(/\d/)
    }
  })

  it('never say "you" or "your": the strength copy is addressed to nobody in particular', () => {
    for (const id of ids) {
      const template: Template = STRENGTH_PAGE_TEMPLATES[id]
      expect(`${template.text} ${template.fallback}`, id).not.toMatch(/\byou(?:r|rs|rself)?\b/i)
    }
  })

  it('is a sentence ending in a full stop wherever it is not a label', () => {
    for (const id of ids) {
      const template: Template = STRENGTH_PAGE_TEMPLATES[id]
      if (template.shape === 'sentence') {
        expect(template.text, id).toMatch(/\.$/)
        expect(template.fallback, id).toMatch(/\.$/)
      }
    }
  })

  it('call a figure an estimate wherever the estimated maximum is named, and never a test or a record', () => {
    const named = ids.filter((id) => /maximum/i.test(STRENGTH_PAGE_TEMPLATES[id].text))
    expect(named.length).toBeGreaterThan(3)
    for (const id of named) {
      const { text } = STRENGTH_PAGE_TEMPLATES[id]
      expect(text, id).not.toMatch(/\b(?:1RM|one-rep|record|personal best|PR)\b/)
    }
    // the sentence that says what it is: worked out, not tested
    expect(STRENGTH_PAGE_TEMPLATES['strength.page.estimate-note'].text).toMatch(/not tested/)
    expect(STRENGTH_PAGE_TEMPLATES['strength.page.anchor-estimate'].text).toMatch(/not tested/)
  })

  it('states no injury figure and no chance of one (G5)', () => {
    for (const id of ids) {
      const { text } = STRENGTH_PAGE_TEMPLATES[id]
      expect(text, id).not.toMatch(/injur(?:y|ies)? (?:risk|probability|chance|odds)/i)
    }
  })
})

describe('the words of the page', () => {
  it('name each item of the equipment, each slot, each level and each mode', () => {
    // Records, so a value added to a type fails to compile here until it has a name
    const kinds: Record<EquipmentKind, string> = {
      barbell: 'Barbell, plates and a rack',
      dumbbells: 'Dumbbells',
      kettlebells: 'Kettlebells',
      bands: 'Bands',
      step: 'A step or box',
      'leg-press': 'Leg press',
      'calf-machine': 'Calf raise machine',
      'leg-curl': 'Leg curl machine',
    }
    for (const [kind, name] of Object.entries(kinds)) {
      expect(words.kind(kind as EquipmentKind), kind).toBe(name)
    }
    const slots: Record<Slot, string> = {
      knee: 'Squats and steps',
      hip: 'Hinges and bridges',
      calf: 'Calf raises',
      plyo: 'Jumps',
      trunk: 'Trunk and hips',
    }
    for (const [slot, name] of Object.entries(slots)) {
      expect(words.slot(slot as Slot), slot).toBe(name)
    }
    const levels: Record<StrengthSettings['level'], string> = {
      new: 'New',
      some: 'Some',
      experienced: 'Experienced',
    }
    for (const [level, name] of Object.entries(levels)) {
      expect(words.level(level as StrengthSettings['level']), level).toBe(name)
      expect(words.levelHint(level as StrengthSettings['level']), level).toMatch(/\.$/)
    }
    const modes: Record<StrengthLogMode, string> = {
      normal: 'Normal',
      'lighter-day': 'Lighter day',
      'lighter-week': 'Lighter week',
      taper: 'Taper',
      return: 'Return',
    }
    for (const [mode, name] of Object.entries(modes)) {
      expect(words.mode(mode as StrengthLogMode), mode).toBe(name)
    }
  })

  it('says where the week stands and what follows for each template of a week, with the length of the ramp-in as a word', () => {
    const block = (template: StrengthTemplate, week: number): StrengthBlockView => ({
      week,
      of: 12,
      rampInWeeks: 3,
      template,
    })
    expect(words.position(block('heavy', 6))).toBe('Week 6 of 12, heavy')
    expect(words.position(block('lighter-week', 4))).toBe('Week 4 of 12, lighter week')
    expect(words.follows(block('ramp-in', 2))).toBe(
      'The ramp-in lasts three weeks. Heavy work follows to week 12, then maintenance; the taper keeps a light session each week.',
    )
    expect(words.follows({ ...block('ramp-in', 2), rampInWeeks: 4 })).toContain('four weeks')
    expect(words.follows(block('heavy', 6))).toBe(
      'Heavy work runs to week 12. Maintenance follows; the taper keeps a light session each week.',
    )
    const every: StrengthTemplate[] = [
      'ramp-in',
      'heavy',
      'lighter-week',
      'maintenance',
      'taper',
      'return',
    ]
    const lines = every.map((template) => words.follows(block(template, 3)))
    expect(new Set(lines).size).toBe(every.length)
    for (const line of lines) expect(line).toMatch(/\.$/)
  })

  it('names every exercise of the catalogue the page can show', () => {
    for (const exercise of EXERCISES) {
      expect(words.name(exercise.id), exercise.id).not.toBe(exercise.id)
    }
  })
})
