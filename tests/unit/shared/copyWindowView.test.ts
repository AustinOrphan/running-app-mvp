import { describe, expect, it } from 'vitest'
import { lintText } from '../../../shared/copy/lint.ts'
import { TEMPLATES } from '../../../shared/copy/templates.ts'
import {
  WINDOW_VIEW_TEMPLATES,
  betterWords,
  isHealthWindow,
  notFullEntryWords,
  offlineLine,
  raceDayLine,
  removeInsteadLabel,
  restPromptWords,
  runningTimeLine,
  stalePreviewLine,
  windowBannerLine,
  type BannerWindow,
} from '../../../shared/copy/windowView.ts'
import { P } from '../../../shared/engine/params/index.ts'
import type { DisruptionPhase, DisruptionReason, Units } from '../../../shared/types.ts'

const base: BannerWindow = {
  reason: 'illness-above-neck',
  mode: 'rest',
  phase: 'resting',
  startDate: '2026-10-22',
  endDate: '2026-10-24',
  maxRunMin: null,
  runFrom: '2026-10-26',
  qualityFrom: '2026-10-29',
  returnWeekMin: null,
}

const line = (over: Partial<BannerWindow>, units: Units = 'km') =>
  windowBannerLine({ ...base, ...over }, units)

describe('the window view templates', () => {
  it('are registered, so the shared lint test renders each one', () => {
    for (const id of Object.keys(WINDOW_VIEW_TEMPLATES) as Array<
      keyof typeof WINDOW_VIEW_TEMPLATES
    >) {
      expect(TEMPLATES[id], id).toBe(WINDOW_VIEW_TEMPLATES[id])
      expect(id.startsWith('window-view.'), id).toBe(true)
    }
  })

  it('hold no slot that reads differently in kilometres and in miles', () => {
    const unitBound = ['pace', 'speed', 'distance', 'climb']
    for (const [id, template] of Object.entries(WINDOW_VIEW_TEMPLATES)) {
      for (const [slot, kind] of Object.entries(template.slots)) {
        expect(unitBound, `${id} slot ${slot}`).not.toContain(kind)
      }
    }
  })
})

describe('windowBannerLine', () => {
  it('words each phase the way the design does', () => {
    expect(line({})).toBe('Resting for illness until Sat 24 Oct.')
    expect(line({ phase: 'rest-gate' })).toBe(
      'One symptom-free day first, then easy running from Mon 26 Oct.',
    )
    expect(line({ phase: 'easy-only' })).toBe(
      'Easy running only until Wed 28 Oct. Hard sessions return on Thu 29 Oct.',
    )
    expect(line({ reason: 'travel', mode: 'limited', maxRunMin: 30, phase: 'limited' })).toBe(
      'Travelling: runs up to 30 min until Sat 24 Oct.',
    )
    expect(line({ phase: 'returning', returnWeekMin: 240 })).toBe('Return week: up to 4.0 h.')
  })

  it('reads the n-3 wait from the Params, not from a number in the text', () => {
    expect(P.n3.illnessSymptomFreeDays.value).toBe(1)
    expect(line({ phase: 'rest-gate' })).toMatch(/^One symptom-free day first/)
  })

  it('names a reason in its own words when the window rests', () => {
    const rest = (reason: DisruptionReason) => line({ reason })
    expect(rest('illness-below-neck')).toBe('Resting for illness until Sat 24 Oct.')
    expect(rest('niggle')).toBe('Resting for a niggle until Sat 24 Oct.')
    expect(rest('travel')).toBe('No running while travelling until Sat 24 Oct.')
    expect(rest('short-on-time')).toBe('No running while short on time until Sat 24 Oct.')
  })

  it('says the return week is a gentler build when no cap is known', () => {
    expect(line({ phase: 'returning' })).toBe(
      'Return week: a gentler build back to the planned week.',
    )
  })

  it('reads a limited window with no cap as the rest it is held as', () => {
    expect(line({ mode: 'limited', phase: 'limited', maxRunMin: null, reason: 'travel' })).toBe(
      'No running while travelling until Sat 24 Oct.',
    )
  })

  it('is empty for a window that is over, and announces one that has not started', () => {
    expect(line({ phase: 'done' })).toBe('')
    expect(line({ phase: 'upcoming', startDate: '2026-10-27', endDate: '2026-10-29' })).toBe(
      'A window starts on Tue 27 Oct and lasts until Thu 29 Oct.',
    )
  })

  it('writes clean copy for every phase and reason, in both units', () => {
    const phases: DisruptionPhase[] = [
      'upcoming',
      'resting',
      'rest-gate',
      'easy-only',
      'limited',
      'returning',
      'done',
    ]
    const reasons: DisruptionReason[] = [
      'illness-above-neck',
      'illness-below-neck',
      'niggle',
      'short-on-time',
      'travel',
    ]
    for (const units of ['km', 'mi'] as const) {
      for (const phase of phases) {
        for (const reason of reasons) {
          const text = line(
            { phase, reason, mode: 'limited', maxRunMin: 45, returnWeekMin: 200 },
            units,
          )
          expect(lintText(text), `${phase} ${reason}`).toEqual([])
          expect(text).not.toMatch(/undefined|NaN|\{/)
        }
      }
    }
  })
})

describe('the preview lines', () => {
  it('writes a total of running time as hours with one decimal, the unit of a week', () => {
    expect(runningTimeLine({ before: 1218, after: 1044 }, 'km')).toContain('20.3 h becomes 17.4 h')
    expect(runningTimeLine({ before: 0, after: 0 }, 'km')).toContain('stays at 0.0 h')
    expect(runningTimeLine({ before: 980.4, after: 980.4 }, 'km')).toContain('stays at 16.3 h')
  })

  it('says time taken away is not added back, and only then', () => {
    expect(runningTimeLine({ before: 1240, after: 1020 }, 'km')).toBe(
      'Running time over the next four weeks: 20.7 h becomes 17.0 h. The minutes you rest are not added back.',
    )
    expect(runningTimeLine({ before: 1020, after: 1240 }, 'km')).toBe(
      'Running time over the next four weeks: 17.0 h becomes 20.7 h.',
    )
    expect(runningTimeLine({ before: 900, after: 900 }, 'km')).toBe(
      'Running time over the next four weeks stays at 15.0 h.',
    )
  })

  it('has fixed words for the race day, a replaced preview, a lost connection and the removal', () => {
    expect(raceDayLine('km')).toBe(
      'The window includes race day. The plan keeps the race; whether to start is your decision.',
    )
    expect(stalePreviewLine('mi')).toBe(
      'The plan changed while you were reading. This is the new preview.',
    )
    expect(offlineLine('km')).toBe('You are offline. Nothing was changed.')
    expect(removeInsteadLabel('km')).toBe('Remove this rest window instead')
    for (const text of [
      raceDayLine('km'),
      stalePreviewLine('km'),
      offlineLine('km'),
      removeInsteadLabel('km'),
    ]) {
      expect(lintText(text)).toEqual([])
    }
  })
})

describe('the action that ends a window yesterday', () => {
  const REASONS: DisruptionReason[] = [
    'illness-above-neck',
    'illness-below-neck',
    'niggle',
    'short-on-time',
    'travel',
  ]

  it('is a health window for an illness or a niggle, and no other', () => {
    expect(REASONS.filter(isHealthWindow)).toEqual([
      'illness-above-neck',
      'illness-below-neck',
      'niggle',
    ])
  })

  it('is better for a health window and finishing early for any other, with its own sentence', () => {
    for (const reason of REASONS) {
      const words = betterWords(reason, 'km')
      if (isHealthWindow(reason)) {
        expect(words.title, reason).toBe("I'm better")
        expect(words.intro, reason).toBe(
          'The window ends yesterday. The return is sized from the days you rested.',
        )
      } else {
        expect(words.title, reason).toBe('Finish early')
        expect(words.intro, reason).toBe('The window ends yesterday. The plan picks up from today.')
      }
      expect(lintText(words.intro), reason).toEqual([])
      expect(betterWords(reason, 'mi'), reason).toEqual(words)
    }
  })
})

describe('the offer on Today and the entry in the Not today sheet', () => {
  it('asks the question of the design and gives two answers', () => {
    const words = restPromptWords('km')
    expect(words).toEqual({
      ask: 'Set a rest window and a return plan?',
      yes: 'Set one up',
      later: 'Not now',
    })
    expect(restPromptWords('mi')).toEqual(words)
    for (const text of Object.values(words)) expect(lintText(text), text).toEqual([])
  })

  it('names the entry for the sheet it opens and says who it is for', () => {
    const words = notFullEntryWords('km')
    expect(words.label).toBe('Not 100%')
    expect(words.hint).toBe('Tell the plan if you are ill, hurt, short on time or travelling.')
    expect(notFullEntryWords('mi')).toEqual(words)
    for (const text of Object.values(words)) expect(lintText(text), text).toEqual([])
  })
})
