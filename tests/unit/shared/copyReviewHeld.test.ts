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
