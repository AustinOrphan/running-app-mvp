import { describe, expect, test } from 'vitest'
import { assertCleanCopy } from '../../../shared/copy/lint.ts'
import { renderFact } from '../../../shared/copy/templates.ts'
import {
  bandOwnsIllness,
  bandWindows,
  isOpen,
  openWindows,
  windowDay,
  windowVerdict,
} from '../../../shared/domain/windowDay.ts'
import { illnessDays, illnessGate } from '../../../shared/engine/disruption.ts'
import type { DisruptionWindow } from '../../../shared/engine/types.ts'
import type { DisruptionPhase, ReadinessVerdict } from '../../../shared/types.ts'
import { windowOf } from '../engine/disruption-fixtures.ts'
import { wellnessDay } from '../engine/e8-fixtures.ts'

const phase = (value: DisruptionPhase, id: string = value) => ({ id, phase: value })

const READY: ReadinessVerdict = { code: 'ready', template: 'today.verdict.ready', slots: {} }

describe('which windows are open', () => {
  test.each([
    ['resting', true],
    ['rest-gate', true],
    ['limited', true],
    ['easy-only', true],
    ['returning', true],
    ['upcoming', false],
    ['done', false],
  ] as const)('a window %s is open: %s', (value, open) => {
    expect(isOpen(phase(value))).toBe(open)
  })

  test('openWindows keeps the open ones in the order given', () => {
    const windows = [
      phase('done', 'a'),
      phase('limited', 'b'),
      phase('upcoming', 'c'),
      phase('resting', 'd'),
    ]
    expect(openWindows(windows).map((window) => window.id)).toEqual(['b', 'd'])
  })
})

describe('the windows of the band', () => {
  test('lists every open window, not the first alone, in the order given', () => {
    const windows = [
      phase('resting', 'illness'),
      phase('upcoming', 'trip'),
      phase('limited', 'calf'),
    ]
    expect(bandWindows(windows).map((window) => window.id)).toEqual(['illness', 'calf'])
  })

  test('with none open it is the next window ahead, and only that one', () => {
    const windows = [phase('upcoming', 'first'), phase('upcoming', 'second')]
    expect(bandWindows(windows).map((window) => window.id)).toEqual(['first'])
  })

  test('with nothing open or ahead it is empty', () => {
    expect(bandWindows([])).toEqual([])
    expect(bandWindows([phase('done')])).toEqual([])
  })
})

describe('what the open windows make of the day', () => {
  test('the strictest state wins: rest, then limited running, then easy, then the return', () => {
    expect(windowDay([phase('returning'), phase('easy-only'), phase('limited')])).toBe('limited')
    expect(windowDay([phase('returning'), phase('easy-only')])).toBe('easy')
    expect(windowDay([phase('returning')])).toBe('return')
    expect(windowDay([phase('limited'), phase('rest-gate')])).toBe('rest')
    expect(windowDay([phase('resting')])).toBe('rest')
  })

  test('a window ahead or over makes nothing of the day', () => {
    expect(windowDay([])).toBeNull()
    expect(windowDay([phase('upcoming'), phase('done')])).toBeNull()
  })
})

describe('the verdict under a window', () => {
  test.each([
    ['resting', 'window-rest', 'A rest day of the window.'],
    ['rest-gate', 'window-rest', 'A rest day of the window.'],
    ['limited', 'window-limited', 'A day of limited running.'],
    ['easy-only', 'window-easy', 'Easy running only today.'],
    ['returning', 'window-return', 'A day of the return week.'],
  ] as const)('"Ready as planned." in a window %s names the day', (value, code, sentence) => {
    const verdict = windowVerdict(READY, [phase(value)])
    expect(verdict?.code).toBe(code)
    const text = renderFact(verdict!, 'km')
    expect(text).toBe(sentence)
    expect(text).not.toMatch(/Ready as planned/)
    assertCleanCopy(text, code)
  })

  test('a verdict that already says something else is left as it is', () => {
    for (const code of [
      'low-stays',
      'low-plan-stays',
      'easy',
      'rest',
      'lighter-week',
      'no-signals',
    ] as const) {
      const verdict: ReadinessVerdict = { code, template: `today.verdict.${code}`, slots: {} }
      expect(windowVerdict(verdict, [phase('resting')])).toBe(verdict)
    }
  })

  test('with no window open, or no verdict, nothing changes', () => {
    expect(windowVerdict(READY, [])).toBe(READY)
    expect(windowVerdict(READY, [phase('upcoming'), phase('done')])?.code).toBe('ready')
    expect(windowVerdict(null, [phase('resting')])).toBeNull()
  })
})

describe('when the band states the illness', () => {
  const win = (startDate: string, endDate: string) => windowOf({ startDate, endDate })
  const gates = (day: string, windows: DisruptionWindow[], checkins: string[] = []) => ({
    gate: illnessGate(
      illnessDays({
        wellness: checkins.map((date) => wellnessDay(date, { illness: true })),
        disruptions: windows,
      }),
      day,
    ),
    windowGate: illnessGate(illnessDays({ wellness: [], disruptions: windows }), day),
  })

  test('an illness window alone holds the gate the band states', () => {
    for (const day of ['2026-10-21', '2026-10-23', '2026-10-24', '2026-10-25']) {
      const { gate, windowGate } = gates(day, [win('2026-10-20', '2026-10-23')])
      expect(gate.phase, day).not.toBe('clear')
      expect(bandOwnsIllness(gate, windowGate), day).toBe(true)
    }
  })

  test('a check-in that reports illness inside the window adds nothing the band does not say', () => {
    const { gate, windowGate } = gates(
      '2026-10-22',
      [win('2026-10-20', '2026-10-23')],
      ['2026-10-22'],
    )
    expect(bandOwnsIllness(gate, windowGate)).toBe(true)
  })

  test('a check-in after the window moves the gate past the band, so the note stays', () => {
    const { gate, windowGate } = gates(
      '2026-10-24',
      [win('2026-10-20', '2026-10-23')],
      ['2026-10-24'],
    )
    expect(gate.phase).toBe('rest')
    expect(bandOwnsIllness(gate, windowGate)).toBe(false)
  })

  test('a check-in with no window is not the band', () => {
    const { gate, windowGate } = gates('2026-10-24', [], ['2026-10-24'])
    expect(gate.phase).toBe('rest')
    expect(bandOwnsIllness(gate, windowGate)).toBe(false)
  })

  test('no gate at all is nothing to state', () => {
    const { gate, windowGate } = gates('2026-12-24', [win('2026-10-20', '2026-10-23')])
    expect(gate.phase).toBe('clear')
    expect(bandOwnsIllness(gate, windowGate)).toBe(false)
  })

  test('a window that is not for illness holds no illness gate', () => {
    const { gate, windowGate } = gates('2026-10-22', [
      windowOf({ reason: 'niggle', startDate: '2026-10-20', endDate: '2026-10-23' }),
    ])
    expect(gate.phase).toBe('clear')
    expect(bandOwnsIllness(gate, windowGate)).toBe(false)
  })
})
