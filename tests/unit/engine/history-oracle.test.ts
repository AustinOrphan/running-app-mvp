// Steady is today's engine byte for byte [rules g-8, proposal section 5.1]: the plan of every runner
// of the oracle, with the load setting absent and set to steady, is the plan the engine built before
// the rebuild zone existed (`history-oracle.ts`). The same holds for each plan of the weekly re-plan
// chains, and of the chains in which every week is run above its plan: at steady a week run above
// its plan lifts nothing after it, whatever the response of rule g-8 does at the other positions.
// The method preset `default` is the same engine (rule P1): the plan of every runner and of the
// weekly re-plan chains, with `options.method` set to it, is the plan the digests hold.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildPlan } from '../../../shared/engine/index.ts'
import type { EngineInput } from '../../../shared/engine/types.ts'
import { at } from './history-fixtures.ts'
import {
  ORACLE_CHAINS,
  OVERSHOT_CHAINS,
  oracleInputs,
  overshotKey,
  planDigest,
} from './history-oracle.ts'
import { replanSteps } from './replan-steps.ts'

const golden = JSON.parse(
  readFileSync(join(import.meta.dirname, 'history-oracle.json'), 'utf8'),
) as Record<string, string>

describe('steady equals the engine before the rebuild zone', () => {
  const inputs = oracleInputs()

  it('has a digest for every runner and every plan of the chains, and no other', () => {
    const chains = ORACLE_CHAINS.flatMap((id) =>
      replanSteps(id).map((_, i) => `chain ${id} ${String(i)}`),
    )
    const overshot = OVERSHOT_CHAINS.flatMap((chain) =>
      replanSteps(chain.id, chain).map((_, i) => overshotKey(chain, i)),
    )
    expect(Object.keys(golden).sort()).toEqual(
      [...inputs.map((c) => c.name), ...chains, ...overshot].sort(),
    )
  })

  it.each(inputs.map((c) => [c.name, c] as const))('%s', (name, c) => {
    expect(planDigest(buildPlan(c.input)), 'option absent').toBe(golden[name])
    expect(planDigest(buildPlan(at(c.input, 'steady'))), 'steady').toBe(golden[name])
  })

  it.each(ORACLE_CHAINS)('the weekly re-plans of %s', (id) => {
    replanSteps(id).forEach((step, i) => {
      expect(planDigest(step.draft), `step ${String(i)}`).toBe(golden[`chain ${id} ${String(i)}`])
    })
  })

  it.each(OVERSHOT_CHAINS)(
    'the weekly re-plans of $id with every week run $scale times its plan, with the option absent and at steady',
    (chain) => {
      const absent = replanSteps(chain.id, chain)
      const steady = replanSteps(chain.id, { ...chain, loadAppetite: 'steady' })
      expect(steady).toHaveLength(absent.length)
      absent.forEach((step, i) => {
        expect(planDigest(step.draft), `absent ${String(i)}`).toBe(golden[overshotKey(chain, i)])
        expect(planDigest(steady[i]!.draft), `steady ${String(i)}`).toBe(
          golden[overshotKey(chain, i)],
        )
      })
    },
  )
})

describe("the default method preset is today's engine byte for byte [rule P1]", () => {
  const inputs = oracleInputs()
  const withDefault = (input: EngineInput): EngineInput => ({
    ...input,
    options: { ...input.options, method: 'default' },
  })

  it.each(inputs.map((c) => [c.name, c] as const))(
    '%s, with the method set to default',
    (name, c) => {
      expect(planDigest(buildPlan(withDefault(c.input)))).toBe(golden[name])
    },
  )

  it.each(ORACLE_CHAINS)('the weekly re-plans of %s, with the method set to default', (id) => {
    const steps = replanSteps(id, { method: 'default' })
    expect(steps).toHaveLength(replanSteps(id).length)
    steps.forEach((step, i) => {
      expect(step.input.options.method, `step ${String(i)}`).toBe('default')
      expect(planDigest(step.draft), `step ${String(i)}`).toBe(golden[`chain ${id} ${String(i)}`])
    })
  })
})
