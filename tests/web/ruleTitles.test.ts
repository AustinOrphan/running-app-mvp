import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { buildPlan } from '../../shared/engine/index.ts'
import { lintText } from '../../shared/copy/lint.ts'
import { allParams, paramsForRule } from '../../shared/engine/params/index.ts'
import { RULE_TITLES, ruleTitle } from '../../web/components/ruleTitles.ts'
import { athletes } from '../unit/engine/matrix-fixtures.ts'

const ENGINE_DIR = join(process.cwd(), 'shared', 'engine')
/** A rule id as the engine spells it: `g-1`, `H4`, `F-lib`, `n-4`, `m-age`, `design-4.2`. */
const RULE_ID = /^(?:[A-Za-z]-?\d{1,2}|F-lib|m-(?:age|sex)|design-[\w.]+)$/
const NOT_RULES = new Set(['z1', 'z2', 'z3'])

/** Every string literal in the engine sources that is spelled like a rule id. */
function literalIds(): Set<string> {
  const ids = new Set<string>()
  const files = [
    ...readdirSync(ENGINE_DIR).map((name) => name),
    ...readdirSync(join(ENGINE_DIR, 'params')).map((name) => `params/${name}`),
  ].filter((name) => name.endsWith('.ts'))
  for (const name of files) {
    const text = readFileSync(join(ENGINE_DIR, name), 'utf8')
    for (const match of text.matchAll(/'([^'\s]+)'/g)) {
      const id = match[1]!
      if (RULE_ID.test(id) && !NOT_RULES.has(id)) ids.add(id)
    }
  }
  return ids
}

function emittedIds(): Set<string> {
  const ids = new Set<string>()
  for (const p of allParams()) ids.add(p.rule)
  for (const id of literalIds()) ids.add(id)
  for (const athlete of athletes()) {
    const plan = buildPlan(athlete.input)
    for (const w of [...plan.warnings, ...plan.feasibility.notes]) {
      w.rules.forEach((r) => ids.add(r))
    }
    for (const c of plan.checklist) c.rules.forEach((r) => ids.add(r))
    for (const s of plan.sessions) s.rules.forEach((r) => ids.add(r))
  }
  return ids
}

describe('RULE_TITLES', () => {
  test('every rule id the engine emits has a title', () => {
    const missing = [...emittedIds()].filter((id) => ruleTitle(id) === null).sort()
    expect(missing).toEqual([])
  })

  test('names the rules the engine cites most', () => {
    expect(ruleTitle('g-1')).toBe('Session spike guard')
    expect(ruleTitle('F-lib')).toBe('Session library')
    expect(ruleTitle('G1')).toBe('Deterministic core')
    expect(ruleTitle('J5')).toBe('Weekly decision')
  })

  test('titles the back-test rule by what the runner sees, and its Params resolve to it', () => {
    expect(RULE_TITLES['L7']).toBe('Prediction track record')
    expect(ruleTitle('l7')).toBe('Prediction track record')
    expect(ruleTitle('L6')).toBe('Minimum prediction band')
    for (const p of paramsForRule('L7')) expect(ruleTitle(p.rule), p.id).not.toBeNull()
  })

  test('titles the disruption rule, and its Params resolve to it', () => {
    expect(RULE_TITLES['J9']).toBe('Rest windows and returns')
    expect(ruleTitle('j9')).toBe('Rest windows and returns')
    expect(paramsForRule('J9')).toHaveLength(3)
    for (const p of paramsForRule('J9')) expect(ruleTitle(p.rule), p.id).not.toBeNull()
  })

  test('titles the standout thresholds by what the runner sees, and their Params resolve to it', () => {
    expect(RULE_TITLES['design-explain']).toBe('What stood out on a run')
    expect(ruleTitle('DESIGN-EXPLAIN')).toBe('What stood out on a run')
    const params = paramsForRule('design-explain')
    expect(params.map((p) => p.id)).toEqual([
      'standout.longestLookbackWeeks',
      'standout.gradeNoteMinPct',
      'standout.driftDeltaPp',
      'standout.hrDeltaMinBpm',
    ])
    for (const p of params) expect(ruleTitle(p.rule), p.id).toBe('What stood out on a run')
  })

  test('tells g-1 from G1, ignoring case but not hyphens', () => {
    expect(ruleTitle('g-1')).not.toBe(ruleTitle('G1'))
    expect(ruleTitle('G-1')).toBe('Session spike guard')
    expect(ruleTitle('g1')).toBe('Deterministic core')
    expect(ruleTitle('f-LIB')).toBe('Session library')
    expect(ruleTitle('k1')).toBe('Taper length')
    // K-1 is not an id the engine uses.
    expect(ruleTitle('K-1')).toBeNull()
    expect(ruleTitle('zz-9')).toBeNull()
  })

  test('every title passes the G5 lint', () => {
    const problems = Object.entries(RULE_TITLES).flatMap(([id, title]) =>
      lintText(title).map(
        (hit) => `${id}: "${hit.match}" (${hit.rule}) in ${JSON.stringify(title)}`,
      ),
    )
    expect(problems).toEqual([])
  })

  test('has no raw id as a title', () => {
    for (const [id, title] of Object.entries(RULE_TITLES)) {
      expect(title, id).not.toMatch(/^[A-Za-z]-?\d+$/)
      expect(title.length, id).toBeGreaterThan(2)
    }
  })
})
