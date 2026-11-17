import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { lintText } from '../../../shared/copy/lint.ts'
import {
  REVIEWED_ROW,
  SIGNAL_LABEL,
  SUGGESTED_ACTION_LABEL,
  signalLabels,
} from '../../../shared/copy/reviewHeld.ts'

const adapt = readFileSync(join(import.meta.dirname, '../../../shared/engine/adapt.ts'), 'utf8')

describe('reviewed weeks copy', () => {
  it('has a label for every signal code the weekly decision can write', () => {
    const codes = new Set([...adapt.matchAll(/code: '([a-z-]+)'/g)].map((m) => m[1]!))
    codes.add('break-recovery')
    expect(codes.size).toBeGreaterThan(10)
    for (const code of codes) expect(SIGNAL_LABEL, code).toHaveProperty(code)
  })

  // Each label names every cause its code has in adapt.ts: the words the label must carry, and the
  // text in adapt.ts that proves the cause exists, so a changed cause fails here.
  const CAUSES: Record<string, Array<[label: RegExp, source: string]>> = {
    'subjective-decline': [
      [/check-ins/i, 'days with a lower check-in score'],
      [/effort/i, 'sessions felt harder than expected'],
      [/fatigue/i, 'fatigue or symptoms in the weekly review'],
    ],
    'efficiency-decline': [[/heart rate/i, 'Pace at a given heart rate has slipped']],
    'sleep-efficiency-drop': [[/sleep efficiency/i, 'Sleep efficiency dropped']],
    illness: [[/illness/i, 'Illness was reported']],
    pain: [[/pain/i, 'was reported. A lighter week follows']],
    'pain-mild': [[/mild pain/i, 'Volume holds until it settles']],
    heat: [[/hot days/i, 'The first hot days of the season are coming']],
    'hrv-suppressed': [[/HRV/, 'HRV was lower than usual']],
    'completion-low': [[/planned minutes/i, 'planned minutes were run']],
    'sleep-warning': [[/sleep/i, 'Sleep averaged']],
    reds: [[/screen/i, 'energy-availability screen']],
    'persistent-suppression': [[/readiness/i, 'Readiness has stayed lower than usual']],
    'readiness-flag': [[/readiness/i, 'A readiness flag is still active']],
    disruption: [[/rest window/i, 'A rest or limited-running window']],
  }

  it.each(Object.entries(CAUSES))(
    'the label of %s matches its causes in adapt.ts',
    (code, rows) => {
      for (const [label, source] of rows) {
        expect(SIGNAL_LABEL[code], code).toMatch(label)
        expect(adapt, `${code}: ${source}`).toContain(source)
      }
    },
  )

  it('passes the copy lint and carries no number', () => {
    const words = [
      ...Object.values(SIGNAL_LABEL),
      ...Object.values(SUGGESTED_ACTION_LABEL),
      ...Object.values(REVIEWED_ROW),
    ]
    for (const text of words) {
      expect(lintText(text), text).toEqual([])
      expect(text, text).not.toMatch(/\d/)
    }
  })

  it('leaves out a code it has no label for', () => {
    expect(signalLabels([{ code: 'sleep-warning' }, { code: 'unknown' }])).toEqual(['Short sleep'])
  })
})
