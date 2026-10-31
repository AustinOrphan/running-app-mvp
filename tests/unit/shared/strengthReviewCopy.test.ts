import { describe, expect, it } from 'vitest'
import { lintText } from '../../../shared/copy/lint.ts'
import { countPhrase, numberWord } from '../../../shared/copy/quantity.ts'
import {
  STRENGTH_REVIEW_TEMPLATES,
  type StrengthReviewTemplateId,
} from '../../../shared/copy/strengthReview.ts'
import { STRENGTH_PAGE_TEMPLATES } from '../../../shared/copy/strengthPage.ts'
import { STRENGTH_TEMPLATES } from '../../../shared/copy/strengthTemplates.ts'
import { type Template } from '../../../shared/copy/template.ts'
import { TEMPLATES } from '../../../shared/copy/templates.ts'
import { formatLoad, toGrams } from '../../../shared/domain/weight.ts'
import { P } from '../../../shared/engine/params/index.ts'
import { pageWords } from '../../../web/components/strength/strengthPageText.ts'

const ids = Object.keys(STRENGTH_REVIEW_TEMPLATES) as StrengthReviewTemplateId[]
const words = pageWords('km', 'lb')

describe('the strength Review and prompt templates (design 12.2, 12.4)', () => {
  it('are spread into the one registry the lint test renders, and shadow no other template', () => {
    expect(ids.length).toBeGreaterThan(5)
    for (const id of ids) {
      expect(TEMPLATES[id], id).toBe(STRENGTH_REVIEW_TEMPLATES[id])
      expect(Object.keys(STRENGTH_TEMPLATES), id).not.toContain(id)
      expect(Object.keys(STRENGTH_PAGE_TEMPLATES), id).not.toContain(id)
    }
  })

  it('put no digit in a text: every number is a slot or a word built from a Param', () => {
    for (const id of ids) {
      const template: Template = STRENGTH_REVIEW_TEMPLATES[id]
      expect(template.text, id).not.toMatch(/\d/)
      expect(template.fallback, id).not.toMatch(/\d/)
    }
  })

  it('never say "you" or "your", and pass the G5 lint in text and fallback', () => {
    for (const id of ids) {
      const template: Template = STRENGTH_REVIEW_TEMPLATES[id]
      const text = `${template.text} ${template.fallback}`
      expect(text, id).not.toMatch(/\byou(?:r|rs|rself)?\b/i)
      expect(lintText(text), id).toEqual([])
    }
  })

  it('end a sentence in a full stop or a question mark', () => {
    for (const id of ids) {
      const template: Template = STRENGTH_REVIEW_TEMPLATES[id]
      if (template.shape === 'sentence') {
        expect(template.text, id).toMatch(/[.?]$/)
        expect(template.fallback, id).toMatch(/[.?]$/)
      }
    }
  })
})

describe('the words of the Review lines', () => {
  it('say a lift that moved with its two loads in the weight unit', () => {
    const slots = {
      exercise: 'Back squat',
      from: { kind: 'load', g: toGrams(110, 'lb') },
      to: { kind: 'load', g: toGrams(115, 'lb') },
    } as const
    expect(words.say('strength.review.moved', slots)).toBe('Back squat 110 lb to 115 lb')
    const kilograms = pageWords('km', 'kg')
    expect(kilograms.say('strength.review.moved', slots)).toBe(
      `Back squat ${formatLoad(toGrams(110, 'lb'), 'kg')} to ${formatLoad(toGrams(115, 'lb'), 'kg')}`,
    )
  })

  it('say a load that went down in the same words, with no judgement', () => {
    const text = words.say('strength.review.moved', {
      exercise: 'Dumbbell Romanian deadlift',
      from: { kind: 'load', g: toGrams(40, 'lb') },
      to: { kind: 'load', g: toGrams(35, 'lb') },
    })
    expect(text).toBe('Dumbbell Romanian deadlift 40 lb to 35 lb')
  })
})

describe('the words of the count prompt', () => {
  const planned = P.flib.strengthPerWeek.value
  const line = (count: number) =>
    words.say('strength.count.line', {
      planned: numberWord(count).replace(/^./, (c) => c.toUpperCase()),
      fewer: numberWord(1),
    })

  it('read as the design words them, with the plan count as a word', () => {
    expect(planned).toBe(2)
    expect(line(planned)).toBe('Two a week is the plan; one fits a busy stretch too.')
    expect(words.say('strength.count.ask', { fewer: numberWord(1) })).toBe('Plan one a week?')
    expect(words.say('strength.count.plan', { n: { kind: 'count', n: 1 } })).toBe('Plan 1 a week')
    expect(words.say('strength.count.later')).toBe('Not now')
  })

  it('spell a count in words up to ten, and in digits from there', () => {
    expect([0, 1, 2, 10].map(numberWord)).toEqual(['zero', 'one', 'two', 'ten'])
    expect([11, 40, -1, 2.5].map(numberWord)).toEqual(['11', '40', '-1', '2.5'])
    expect(countPhrase(2, 'strength session')).toBe('two strength sessions')
    expect(countPhrase(1, 'strength session')).toBe('one strength session')
  })

  it('follow the count when the plan asks for another', () => {
    expect(line(3)).toBe('Three a week is the plan; one fits a busy stretch too.')
    expect(line(12)).toBe('12 a week is the plan; one fits a busy stretch too.')
  })

  it('say when the change takes effect and how long the question waits, with words from the counts', () => {
    expect(
      words.say('strength.count.planned', { sessions: countPhrase(1, 'strength session') }),
    ).toBe('From the next weekly update the plan asks for one strength session a week.')
    expect(words.say('strength.count.kept', { weeks: countPhrase(4, 'week') })).toBe(
      'Nothing changes. The question stays away for four weeks.',
    )
    // with nowhere to keep the answer no wait is promised
    expect(words.say('strength.count.not-kept')).toBe(
      'Nothing changes. This browser could not keep the answer, so the question may come back.',
    )
    expect(words.say('strength.count.not-kept')).not.toMatch(/week/)
    expect(words.say('strength.count.error')).toBe('The choice was not saved. Try again.')
  })

  it('never calls a week short, behind or missed', () => {
    for (const id of ids) {
      const { text } = STRENGTH_REVIEW_TEMPLATES[id]
      expect(text, id).not.toMatch(/\b(?:behind|missed?|short|fail\w*|streak|lazy|catch up)\b/i)
    }
  })
})

describe('the note on a week with more sessions than planned', () => {
  it('states the range of flib.strengthPerWeek, so a change of the Param changes the sentence', () => {
    const [lo, hi] = P.flib.strengthPerWeek.range ?? [0, 0]
    expect([lo, hi]).toEqual([2, 3])
    const count = (n: number) => ({ kind: 'count', n }) as const
    expect(
      words.say('strength.over.more', {
        logged: count(3),
        planned: count(2),
        lo: count(lo),
        hi: count(hi),
      }),
    ).toBe(
      '3 sessions logged; the plan asks for 2. More does not add to the block. The research range is 2 to 3 a week.',
    )
  })

  it('stays within the length every strength sentence keeps', () => {
    const count = (n: number) => ({ kind: 'count', n }) as const
    const text = words.say('strength.over.more', {
      logged: count(12),
      planned: count(12),
      lo: count(12),
      hi: count(12),
    })
    expect(text.length).toBeLessThanOrEqual(160)
  })
})
