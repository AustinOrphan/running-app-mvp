import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'

// A row that opens or closes something is a tap: 44 px tall at least. jsdom has no layout, so the
// sizes are read from the stylesheets, as the layout rules of the Strength page are
// (`strength.test.tsx`); the e2e specs measure the rows in a browser.

const sheet = (file: string) => readFileSync(join(process.cwd(), 'web', file), 'utf8')

/** The declarations of the first rule with this selector. */
function rule(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const found = new RegExp(`${escaped} \\{([^}]*)\\}`).exec(css)
  if (found === null) throw new Error(`No rule for ${selector}`)
  return found[1]!
}

describe('the disclosure rows of the Plan page', () => {
  const css = sheet('pages/PlanPage.module.css')

  test('the summaries of the panels are 44 px: a 28 px serif line with 8 px above and below', () => {
    const summary = rule(css, '.panel summary')
    expect(summary).toMatch(/line-height: var\(--lh-lg\);/)
    expect(summary).toMatch(/padding-block: var\(--space-2\);/)
  })

  test('"Show each one" is 44 px: a 22 px line with the rest of the height split above and below', () => {
    const summary = rule(css, '.warningDetails summary')
    expect(summary).toMatch(/line-height: var\(--lh-sm\);/)
    expect(summary).toMatch(/padding-block: calc\(\(2\.75rem - var\(--lh-sm\)\) \/ 2\);/)
  })

  test('"Earlier weeks" is a 44 px row', () => {
    expect(rule(css, '.earlierToggle')).toMatch(/min-height: 2\.75rem;/)
  })
})
