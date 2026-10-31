import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, test } from 'vitest'

// The sheets that open on a tap are loaded on demand (`web/components/lazySheets.tsx`). One static
// import of a sheet file anywhere else puts its code back in the entry chunk, so this scans for it.

const WEB = join(process.cwd(), 'web')
const SHEETS = [
  'components/today/CheckinSheet.tsx',
  'components/today/DoneSheet.tsx',
  'components/fuel/FuelLogSheet.tsx',
  'components/strength/StrengthSheet.tsx',
  'components/strength/SetupSheets.tsx',
  'components/disruption/NotFullSheet.tsx',
  'components/disruption/ReplanSheet.tsx',
  'components/disruption/WindowActionSheet.tsx',
  'pages/RaceResultSheet.tsx',
]

/** `import ... from '<path>'` statements of a file: whether they are type-only, and the path. */
function imports(source: string): Array<{ typeOnly: boolean; path: string }> {
  const found: Array<{ typeOnly: boolean; path: string }> = []
  for (const match of source.matchAll(/^import\s+(type\s+)?[\w*{},\s]+?\s+from\s+'([^']+)'$/gm)) {
    found.push({ typeOnly: match[1] !== undefined, path: match[2] ?? '' })
  }
  return found
}

describe('the sheets that open on a tap', () => {
  const files = readdirSync(WEB, { recursive: true, encoding: 'utf8' })
    .filter((name) => /\.tsx?$/.test(name))
    .map((name) => join(WEB, name))

  test('are imported as values by lazySheets.tsx alone, and by it only through import()', () => {
    const offenders: string[] = []
    for (const file of files) {
      const text = readFileSync(file, 'utf8')
      for (const { typeOnly, path } of imports(text)) {
        if (typeOnly || !path.startsWith('.')) continue
        const target = relative(WEB, join(file, '..', path))
        if (SHEETS.includes(target)) offenders.push(`${relative(WEB, file)} imports ${target}`)
      }
    }
    expect(offenders).toEqual([])
  })

  test('are each loaded by an import() in lazySheets.tsx', () => {
    const text = readFileSync(join(WEB, 'components/lazySheets.tsx'), 'utf8')
    for (const sheet of SHEETS) {
      const name = sheet.split('/').pop() ?? sheet
      expect(text, name).toMatch(
        new RegExp(`import\\('[./]+[\\w/]*${name.replace('.', '\\.')}'\\)`),
      )
    }
  })
})
