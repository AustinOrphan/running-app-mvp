import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { describe, expect, test } from 'vitest'

// The charting library is about 390 kB (the `charts` chunk). A page that draws a chart takes it
// from `web/components/charts/lazyCharts.tsx`, which loads it with import(). One static import of
// recharts, or of a file that imports it, anywhere the entry reaches puts the chunk back in every
// first load, and the dynamic imports then save nothing. This follows every static import from the
// entry and fails on the first path that gets to recharts.

const WEB = join(process.cwd(), 'web')
const CHARTS = ['WeeklyHoursChart', 'MonthlyHoursChart', 'StreamChart', 'PredictionTrackChart']

/** The module specifiers an `import` or `export ... from` statement loads when the app runs. */
function staticSpecifiers(source: string): string[] {
  const found: string[] = []
  const statement = /^(?:import|export)\s+(type\s+)?([\w*{},\s]+?)\s+from\s+'([^']+)'$/gm
  for (const match of source.matchAll(statement)) {
    const [, typeOnly, clause = '', path = ''] = match
    if (typeOnly !== undefined) continue
    const names = clause.replace(/[{}]/g, ',').split(',')
    const allTypes = names.every((name) => name.trim() === '' || /^type\s/.test(name.trim()))
    if (!allTypes) found.push(path)
  }
  return found
}

function resolveRelative(from: string, specifier: string): string | null {
  const target = join(dirname(from), specifier)
  return /\.tsx?$/.test(target) && existsSync(target) ? target : null
}

/** The first chain of static imports from `entry` to the charting library, if there is one. */
function pathToRecharts(entry: string): string[] | null {
  const seen = new Set<string>()
  const walk = (file: string, chain: string[]): string[] | null => {
    if (seen.has(file)) return null
    seen.add(file)
    const here = [...chain, relative(WEB, file)]
    for (const specifier of staticSpecifiers(readFileSync(file, 'utf8'))) {
      if (specifier === 'recharts' || specifier.startsWith('recharts/')) return [...here, specifier]
      if (!specifier.startsWith('.')) continue
      const next = resolveRelative(file, specifier)
      const found = next === null ? null : walk(next, here)
      if (found !== null) return found
    }
    return null
  }
  return walk(entry, [])
}

describe('the charting library', () => {
  test('is not reached by any static import from the entry', () => {
    expect(pathToRecharts(join(WEB, 'main.tsx'))).toBeNull()
  })

  test.each(CHARTS)('is reached from %s, so the scan above can see a chart', (chart) => {
    expect(pathToRecharts(join(WEB, 'components/charts', `${chart}.tsx`))).not.toBeNull()
  })

  test.each(CHARTS)('is loaded for %s by an import() in lazyCharts.tsx', (chart) => {
    const text = readFileSync(join(WEB, 'components/charts/lazyCharts.tsx'), 'utf8')
    expect(text).toContain(`import('./${chart}.tsx')`)
  })
})
