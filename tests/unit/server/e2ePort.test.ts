import { describe, expect, test } from 'vitest'
import { e2ePortFor } from '../../e2e/env.ts'

function expectInRange(port: number): void {
  expect(Number.isInteger(port)).toBe(true)
  expect(port).toBeGreaterThanOrEqual(3101)
  expect(port).toBeLessThanOrEqual(3500)
}

describe('e2ePortFor', () => {
  test('gives two checkouts different ports within 3101-3500', () => {
    const a = e2ePortFor('/work/running-app-mvp/.claude/worktrees/agent-a1b2c3')
    const b = e2ePortFor('/work/running-app-mvp/.claude/worktrees/agent-d4e5f6')
    expect(a).not.toBe(b)
    expectInRange(a)
    expectInRange(b)
  })

  test('stays within 3101-3500 for many paths', () => {
    for (let i = 0; i < 500; i += 1) {
      expectInRange(e2ePortFor(`/work/checkout-${i}`))
    }
  })

  test('returns the same port for the same path, with or without a trailing slash', () => {
    expect(e2ePortFor('/work/checkout')).toBe(e2ePortFor('/work/checkout'))
    expect(e2ePortFor('/work/checkout/')).toBe(e2ePortFor('/work/checkout'))
  })
})
