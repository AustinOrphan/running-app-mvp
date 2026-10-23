import { describe, expect, test } from 'vitest'
import { COPY_MAX_CHARS } from '../../../shared/copy/limits.ts'
import { assertCleanCopy, G5_BANNED, lintText } from '../../../shared/copy/lint.ts'
import {
  FALLBACK_TEXT,
  placeholdersOf,
  render,
  sampleSlots,
  type Template,
} from '../../../shared/copy/template.ts'
import { TEMPLATES, UNKNOWN_FACT_TEXT } from '../../../shared/copy/templates.ts'
import { allParams } from '../../../shared/engine/params/index.ts'
import type { Units } from '../../../shared/types.ts'

const matches = (text: string) => lintText(text).map((hit) => hit.match)

describe('G5_BANNED', () => {
  test('is exactly the list of the phase 3a design, section 4.5', () => {
    expect([...G5_BANNED.words]).toEqual([
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
    ])
    expect([...G5_BANNED.caseSensitiveWords]).toEqual(['PB', 'PR', 'red'])
    expect([...G5_BANNED.characters]).toEqual(['!'])
  })
})

describe('lintText', () => {
  test.each(G5_BANNED.words)('"%s" is flagged as a whole word in any case', (word) => {
    const upper = word.toUpperCase()
    const title = word.charAt(0).toUpperCase() + word.slice(1)
    for (const form of [word, upper, title]) {
      expect(matches(`Pace ${form} here.`), form).toEqual([form])
      expect(matches(`${form}.`), form).toEqual([form])
    }
  })

  test.each(G5_BANNED.words)('"%s" is not flagged inside a longer word', (word) => {
    expect(lintText(`Pre${word}ing and ${word}ness.`)).toEqual([])
  })

  test('the plain word "record" and the screening name RED-S pass', () => {
    for (const text of [
      'Prediction track record.',
      'Record result.',
      'Your record of runs.',
      'RED-S signs are checked in every check-in.',
      'REDs signs are checked.',
      'Relative energy deficiency (RED-S).',
    ]) {
      expect(lintText(text), text).toEqual([])
    }
  })

  test('PB and PR are banned in capitals only, lowercase red likewise', () => {
    expect(matches('A new PB today.')).toEqual(['PB'])
    expect(matches('A new PR today.')).toEqual(['PR'])
    expect(matches('Shown in red.')).toEqual(['red'])
    expect(matches('personal record')).toEqual(['personal record'])
    expect(matches('Personal best')).toEqual(['Personal best'])
    for (const text of [
      'pb pr',
      'Pr',
      'Red',
      'RED',
      'hundred',
      'tired',
      'PRs',
      'PBs',
      'Predicted',
    ]) {
      expect(lintText(text), text).toEqual([])
    }
  })

  test('an exclamation mark is flagged', () => {
    expect(matches('Well done!')).toEqual(['!'])
  })

  test('injury-probability wording is flagged', () => {
    for (const text of [
      'Your injury risk is high.',
      'A 30% chance of injury this week.',
      'The risk of getting injured rises.',
      'You are likely to get injured.',
      'Injury probability: 12%.',
    ]) {
      expect(lintText(text), text).not.toEqual([])
    }
    for (const text of ['Hold the long run after an injury.', 'Injury return levels.']) {
      expect(lintText(text), text).toEqual([])
    }
  })

  test('reports each hit once, in order of position, with its position', () => {
    const hits = lintText('You missed a session. Do not skip, badge!')
    expect(hits.map((hit) => hit.match)).toEqual(['missed', 'badge', '!'])
    expect(hits.map((hit) => hit.index)).toEqual([4, 35, 40])
  })

  test('empty text is clean', () => {
    expect(lintText('')).toEqual([])
  })
})

describe('assertCleanCopy', () => {
  test('passes clean text and names every hit and the place in a failure', () => {
    expect(() => {
      assertCleanCopy('Ready as planned.')
    }).not.toThrow()
    expect(() => {
      assertCleanCopy('You are behind. Streak!', 'the Today card')
    }).toThrow(/the Today card.*"behind".*"Streak".*"!"/s)
  })
})

describe('every registered template', () => {
  const ids = Object.keys(TEMPLATES) as Array<keyof typeof TEMPLATES>
  const units: Units[] = ['km', 'mi']

  test('there are templates to check', () => {
    expect(ids.length).toBeGreaterThan(0)
  })

  test.each(ids)('%s declares exactly the slots its text uses', (id) => {
    const template: Template = TEMPLATES[id]
    expect(Object.keys(template.slots).sort(), id).toEqual(placeholdersOf(template.text).sort())
    expect(placeholdersOf(template.fallback), `${id} fallback`).toEqual([])
  })

  test.each(ids)('%s renders clean, short and finished in both unit systems', (id) => {
    const template: Template = TEMPLATES[id]
    for (const system of units) {
      const text = render(template, sampleSlots(template), system)
      expect(lintText(text), `${id}: ${text}`).toEqual([])
      expect(text.length, `${id}: ${text}`).toBeLessThanOrEqual(COPY_MAX_CHARS)
      expect(text, id).not.toMatch(/\{|\}|NaN|undefined|null/)
      expect(text, id).not.toMatch(/\d{4}-\d{2}-\d{2}/)
      if (template.shape === 'sentence') expect(text, id).toMatch(/[.?]$/)
    }
  })

  test.each(ids)('%s has a fallback that is itself clean, short and finished', (id) => {
    const { fallback, shape } = TEMPLATES[id] as Template
    expect(lintText(fallback), `${id}: ${fallback}`).toEqual([])
    expect(fallback.length, id).toBeLessThanOrEqual(COPY_MAX_CHARS)
    if (shape === 'sentence') expect(fallback, id).toMatch(/[.?]$/)
  })

  test('the generic fallbacks are clean too', () => {
    for (const text of [FALLBACK_TEXT, UNKNOWN_FACT_TEXT]) {
      expect(lintText(text), text).toEqual([])
      expect(text).toMatch(/\.$/)
    }
  })
})

// The why drawer shows a parameter's note as app-authored copy, so the registry is linted the way
// the templates are: a note added later is covered without an edit here.
describe('every parameter note', () => {
  const notes = allParams().flatMap((p) =>
    p.note === undefined ? [] : [{ id: p.id, note: p.note }],
  )

  test('there are notes to check', () => {
    expect(notes.length).toBeGreaterThan(300)
  })

  test('passes the G5 lint', () => {
    const problems = notes.flatMap(({ id, note }) =>
      lintText(note).map((hit) => `${id}: "${hit.match}" (${hit.rule}) in ${JSON.stringify(note)}`),
    )
    expect(problems).toEqual([])
  })
})
