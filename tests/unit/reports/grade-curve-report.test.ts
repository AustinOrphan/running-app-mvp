// The grade-curve report (rule I13, report only): it renders, it is deterministic, and it prints
// the six scenarios. No digest is pinned: the figures follow the Params and the report gates nothing.
import { describe, expect, it } from 'vitest'
import { renderReport, SCENARIOS } from '../../reports/grade-curve-report.ts'

describe('the grade-curve report', () => {
  const text = renderReport()

  it('has a heading for each of the six scenarios and one band table each', () => {
    expect(SCENARIOS).toHaveLength(6)
    for (const scenario of SCENARIOS) expect(text).toContain(`## ${scenario.name}`)
    expect(text.match(/^## /gm)).toHaveLength(6)
    expect(text.match(/^\| Grade band/gm)).toHaveLength(6)
  })

  it('is the same text twice and names the steep ends', () => {
    expect(renderReport()).toBe(text)
    expect(text).toContain('steep-end')
  })
})
