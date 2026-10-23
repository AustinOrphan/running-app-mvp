import { afterEach, describe, expect, test, vi } from 'vitest'
import {
  CopyError,
  FALLBACK_TEXT,
  placeholdersOf,
  render,
  sampleSlots,
  tpl,
  type Template,
} from '../../../shared/copy/template.ts'
import {
  renderFact,
  TEMPLATES,
  UNKNOWN_FACT_TEXT,
  type TemplateId,
} from '../../../shared/copy/templates.ts'
import type { InputFact, Quantity } from '../../../shared/engine/types.ts'

afterEach(() => {
  vi.unstubAllEnvs()
})

const LIMIT = tpl('Heart rate: under {limit} for {span}.', { limit: 'bpm', span: 'duration' })
const RUN = tpl(
  'The longest run of the last 30 days was {distance} on {date}.',
  { distance: 'distance', date: 'date' },
  { fallback: 'The longest recent run is not available.' },
)
const QUOTE = tpl('The service said: {message}', { message: 'text' }, { shape: 'label' })

describe('tpl and render', () => {
  test('fills each slot in the runner s units', () => {
    const distance: Quantity = { kind: 'distance', m: 18300 }
    const date: Quantity = { kind: 'date', iso: '2026-10-17', style: 'weekday' }
    expect(render(RUN, { distance, date }, 'km')).toBe(
      'The longest run of the last 30 days was 18.3 km on Sat 17 Oct.',
    )
    expect(render(RUN, { distance, date }, 'mi')).toBe(
      'The longest run of the last 30 days was 11.4 mi on Sat 17 Oct.',
    )
  })

  test('a slot can appear twice, and a template can have none', () => {
    const twice = tpl('{n} and {n} again.', { n: 'count' })
    expect(render(twice, { n: { kind: 'count', n: 2 } }, 'km')).toBe('2 and 2 again.')
    const none = tpl('Ready as planned.')
    expect(render(none, {}, 'km')).toBe('Ready as planned.')
    expect(placeholdersOf(none.text)).toEqual([])
    expect(placeholdersOf(twice.text)).toEqual(['n'])
  })

  test('text slots are inserted verbatim and are not expanded again', () => {
    expect(render(QUOTE, { message: 'Rate limit {limit} reached' }, 'km')).toBe(
      'The service said: Rate limit {limit} reached',
    )
  })

  test('the default shape is a sentence and the default fallback is generic', () => {
    expect(RUN.shape).toBe('sentence')
    expect(QUOTE.shape).toBe('label')
    expect(LIMIT.fallback).toBe(FALLBACK_TEXT)
  })

  test('a missing, mistyped or unusable slot throws in tests', () => {
    const limit: Quantity = { kind: 'bpm', bpm: 149 }
    const span: Quantity = { kind: 'duration', sec: 2700 }
    const loose = LIMIT as Template
    expect(() => render(loose, { limit }, 'km')).toThrow(CopyError)
    expect(() => render(loose, { limit, span: { kind: 'distance', m: 5 } }, 'km')).toThrow(/span/)
    expect(() =>
      render(loose, { limit, span: { kind: 'duration', sec: Number.NaN } }, 'km'),
    ).toThrow(/span/)
    expect(() => render(loose, { limit, span: 'forty-five minutes' }, 'km')).toThrow(/span/)
    expect(() => render(loose, { limit, span, extra: 'x' }, 'km')).toThrow(/extra/)
    expect(() =>
      render(QUOTE as Template, { message: undefined as unknown as string }, 'km'),
    ).toThrow(/message/)
  })

  test('a placeholder with no declared slot throws in tests', () => {
    const broken = {
      text: 'Pace {pace}.',
      slots: {},
      fallback: 'No pace.',
      shape: 'sentence',
    } as const
    expect(() => render(broken, {}, 'km')).toThrow(/pace/)
  })

  test('in production the fallback is rendered, never undefined or NaN', () => {
    vi.stubEnv('NODE_ENV', 'production')
    const limit: Quantity = { kind: 'bpm', bpm: 149 }
    const loose = RUN as Template
    expect(render(loose, {}, 'km')).toBe('The longest recent run is not available.')
    expect(
      render(
        loose,
        {
          distance: { kind: 'distance', m: Number.NaN },
          date: { kind: 'date', iso: '2026-10-17' },
        },
        'km',
      ),
    ).toBe('The longest recent run is not available.')
    expect(render(LIMIT as Template, { limit }, 'km')).toBe(FALLBACK_TEXT)
    const broken = {
      text: 'Pace {pace}.',
      slots: {},
      fallback: 'No pace.',
      shape: 'sentence',
    } as const
    expect(render(broken, {}, 'km')).toBe('No pace.')
  })

  test('in production an unused slot value does not hide a good sentence', () => {
    vi.stubEnv('NODE_ENV', 'production')
    const loose = RUN as Template
    const distance: Quantity = { kind: 'distance', m: 5000 }
    const date: Quantity = { kind: 'date', iso: '2026-10-17' }
    expect(render(loose, { distance, date, extra: 'x' }, 'km')).toBe(
      'The longest run of the last 30 days was 5 km on 17 Oct.',
    )
  })

  test('sampleSlots gives every declared slot a valid value of its kind', () => {
    for (const template of [LIMIT, RUN, QUOTE]) {
      const samples = sampleSlots(template)
      expect(Object.keys(samples).sort()).toEqual(Object.keys(template.slots).sort())
      expect(render(template as Template, samples, 'mi')).not.toMatch(/\{|NaN|undefined/)
    }
  })
})

describe('compile-time slot checks', () => {
  test('render rejects an undeclared slot, a missing slot and a wrong Quantity kind', () => {
    const limit: Quantity & { kind: 'bpm' } = { kind: 'bpm', bpm: 149 }
    const span: Quantity & { kind: 'duration' } = { kind: 'duration', sec: 2700 }

    // The line without a directive below proves the typed call compiles.
    expect(render(LIMIT, { limit, span }, 'km')).toBe('Heart rate: under 149 bpm for 45 min.')

    // @ts-expect-error `extra` is not a declared slot
    expect(() => render(LIMIT, { limit, span, extra: span }, 'km')).toThrow(CopyError)
    // @ts-expect-error `span` is declared and missing
    expect(() => render(LIMIT, { limit }, 'km')).toThrow(CopyError)
    // @ts-expect-error `limit` is a bpm slot and gets a distance
    expect(() => render(LIMIT, { limit: { kind: 'distance', m: 1 }, span }, 'km')).toThrow(
      CopyError,
    )
    // @ts-expect-error a text slot takes a string, not a quantity
    expect(() => render(QUOTE, { message: span }, 'km')).toThrow(CopyError)
    // @ts-expect-error a quantity slot does not take a string
    expect(() => render(LIMIT, { limit: '149 bpm', span }, 'km')).toThrow(CopyError)
    // @ts-expect-error a template with no slots takes no values
    expect(() => render(tpl('Ready.'), { n: 'x' }, 'km')).toThrow(CopyError)
  })

  test('tpl rejects a placeholder without a slot and a slot without a placeholder', () => {
    // @ts-expect-error `{b}` has no declared slot
    tpl('{a} and {b}.', { a: 'pace' })
    // @ts-expect-error `b` is declared and never used
    tpl('Only {a}.', { a: 'pace', b: 'pace' })
    // @ts-expect-error a placeholder with no slots at all
    tpl('Pace {a}.')
    // @ts-expect-error an unknown slot kind
    tpl('Pace {a}.', { a: 'velocity' })
    expect(tpl('Pace {a}.', { a: 'pace' }).slots).toEqual({ a: 'pace' })
  })
})

describe('the template registry', () => {
  test('is not empty and every id is a lower-case dotted name', () => {
    const ids = Object.keys(TEMPLATES)
    expect(ids.length).toBeGreaterThan(0)
    for (const id of ids) expect(id).toMatch(/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/)
  })

  test('renderFact renders a stored fact from its template id and slots', () => {
    const id: TemplateId = 'why.no-parameter'
    const fact: InputFact = {
      id: 'f1',
      template: id,
      slots: { rule: 'zz-9' },
      rule: 'zz-9',
      sources: [],
      moreSources: 0,
      state: 'used',
    }
    expect(renderFact(fact, 'km')).toBe('No parameter is recorded for zz-9.')
    // A JSON round trip changes nothing: the fact is data.
    expect(renderFact(JSON.parse(JSON.stringify(fact)) as InputFact, 'mi')).toBe(
      'No parameter is recorded for zz-9.',
    )
  })

  test('renderFact throws in tests for an unknown template or a bad slot', () => {
    const base: InputFact = {
      id: 'f1',
      template: 'why.no-parameter',
      slots: { rule: 'zz-9' },
      rule: 'zz-9',
      sources: [],
      moreSources: 0,
      state: 'used',
    }
    expect(() => renderFact({ ...base, template: 'no.such.template' }, 'km')).toThrow(CopyError)
    expect(() => renderFact({ ...base, template: 'toString' }, 'km')).toThrow(CopyError)
    expect(() => renderFact({ ...base, slots: {} }, 'km')).toThrow(/rule/)
    expect(() => renderFact({ ...base, slots: { rule: { kind: 'count', n: 1 } } }, 'km')).toThrow(
      /rule/,
    )
  })

  test('renderFact throws a CopyError in tests when the slots are not an object', () => {
    const base: InputFact = {
      id: 'f1',
      template: 'why.no-parameter',
      slots: { rule: 'zz-9' },
      rule: 'zz-9',
      sources: [],
      moreSources: 0,
      state: 'used',
    }
    for (const slots of [null, undefined, 'zz-9', ['zz-9']]) {
      const fact = { ...base, slots } as unknown as InputFact
      expect(() => renderFact(fact, 'km'), String(slots)).toThrow(CopyError)
      expect(() => renderFact(fact, 'km'), String(slots)).toThrow(/slots must be an object/)
    }
  })

  test('renderFact renders the template fallback or a neutral line in production', () => {
    vi.stubEnv('NODE_ENV', 'production')
    const base: InputFact = {
      id: 'f1',
      template: 'why.no-parameter',
      slots: {},
      rule: 'zz-9',
      sources: [],
      moreSources: 0,
      state: 'used',
    }
    expect(renderFact(base, 'km')).toBe(TEMPLATES['why.no-parameter'].fallback)
    expect(renderFact({ ...base, template: 'no.such.template' }, 'km')).toBe(UNKNOWN_FACT_TEXT)
  })

  test('renderFact renders the template fallback in production when the slots are not an object', () => {
    vi.stubEnv('NODE_ENV', 'production')
    const base: InputFact = {
      id: 'f1',
      template: 'why.no-parameter',
      slots: { rule: 'zz-9' },
      rule: 'zz-9',
      sources: [],
      moreSources: 0,
      state: 'used',
    }
    for (const slots of [null, undefined, 'zz-9', ['zz-9']]) {
      const fact = { ...base, slots } as unknown as InputFact
      expect(renderFact(fact, 'km'), String(slots)).toBe(TEMPLATES['why.no-parameter'].fallback)
    }
    // A template with no slots of its own falls back too: the record is bad, not the template.
    expect(render(tpl('Ready.'), null as never, 'km')).toBe(FALLBACK_TEXT)
    expect(render(RUN as Template, undefined as never, 'km')).toBe(
      'The longest recent run is not available.',
    )
  })
})
