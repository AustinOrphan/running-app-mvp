import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'

// A chart is drawn once at its `initialDimension` (640 px) before `ResponsiveContainer` has
// measured the box it stands in, and the box is a phone's 328 px or less. Unclipped, that first
// frame makes the page 296 px wider than the window until the measurement lands, which a loaded CI
// runner showed to the Stats e2e (`06-narrow-viewport.spec.ts`). jsdom has no layout, so the
// stylesheet is read.
const CHARTS = join(process.cwd(), 'web/components/charts')

const drawn = readdirSync(CHARTS)
  .filter((file) => file.endsWith('Chart.tsx'))
  .filter((file) => readFileSync(join(CHARTS, file), 'utf8').includes('<ResponsiveContainer'))
  .map((file) => file.replace(/\.tsx$/, ''))
  .sort()

describe('the box of a chart that measures itself', () => {
  test('is found for every chart the app draws', () => {
    expect(drawn).toEqual([
      'MonthlyHoursChart',
      'PredictionTrackChart',
      'StreamChart',
      'WeeklyHoursChart',
    ])
  })

  test.each(drawn)('%s wraps the container in a box that clips', (name) => {
    const source = readFileSync(join(CHARTS, `${name}.tsx`), 'utf8')
    expect(source).toMatch(/className=\{styles\.chart\}>\s*<ResponsiveContainer/)
    const css = readFileSync(join(CHARTS, `${name}.module.css`), 'utf8')
    const rule = /\.chart\s*\{([^}]*)\}/.exec(css)?.[1] ?? ''
    expect(rule).toMatch(/overflow:\s*hidden/)
  })
})
