import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, posix, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

/**
 * The evaluation harness (the plan report and the plan metrics, proposal section 5) describes plans
 * and gates nothing. A figure there must never reach the engine, the server, the app or a script:
 * a plateau metric that the generator imports would turn a description into a target. So no file
 * under `shared/`, `server/`, `web/` or `scripts/` may import from `tests/reports/` or the plan
 * metrics. `tests/` itself may, and does: the report and its tests import the matrix fixtures and
 * the sweeps.
 *
 * The scan also refuses any import of a path under `tests/` from those directories, since the
 * harness will grow files there (the simulator of task H2) that this list cannot name yet.
 */

const ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const SCANNED = ['shared', 'server', 'web', 'scripts']
const SOURCE = /\.[cm]?[jt]sx?$/

/** The harness: a directory when it ends with a slash, else one module (with or without `.ts`). */
export const HARNESS = ['tests/reports/', 'tests/unit/engine/plan-metrics.ts'] as const

const FROM = /\bfrom\s*(['"])(.+?)\1/g
const SIDE_EFFECT = /\bimport\s*(['"])(.+?)\1/g
const DYNAMIC = /\b(?:import(?:\.meta\.glob)?|require)\s*\(\s*(['"`])(.+?)\1/g

/**
 * The specifiers a source file imports: static imports and re-exports (`from '...'`), imports with
 * no binding, dynamic `import()`, Vite's `import.meta.glob()` and `require()`. Lines that open
 * with a comment marker are skipped; the scan reads a line that merely mentions an import in a
 * trailing comment as an import, so a false alarm is loud and a missed import is not hidden.
 */
export function specifiersIn(source: string): string[] {
  const code = source
    .split('\n')
    .filter((line) => !/^\s*(?:\/\/|\/\*|\*)/.test(line))
    .join('\n')
  return [FROM, SIDE_EFFECT, DYNAMIC].flatMap((pattern) =>
    [...code.matchAll(pattern)].map((match) => match[2]!),
  )
}

/** The repo-relative path a specifier points at, or null for a package or a `node:` module. */
export function resolvedPath(file: string, specifier: string): string | null {
  if (specifier.startsWith('.')) {
    return relative(ROOT, resolve(ROOT, dirname(file), specifier))
      .split(sep)
      .join(posix.sep)
  }
  if (specifier.startsWith('/')) return relative(ROOT, specifier).split(sep).join(posix.sep)
  // a path from the repository root, as an alias would write it
  return specifier.startsWith('tests/') ? specifier : null
}

const withoutExtension = (path: string): string => path.replace(/\.[cm]?[jt]sx?$/, '')

/** Whether a repo-relative path is part of the harness. */
export function isHarness(path: string): boolean {
  return HARNESS.some((entry) =>
    entry.endsWith('/')
      ? path.startsWith(entry)
      : withoutExtension(path) === withoutExtension(entry),
  )
}

/** Imports in `source` (a file at repo-relative `file`) that `refused` says no to. */
export function offendingImports(
  file: string,
  source: string,
  refused: (path: string) => boolean,
): string[] {
  return specifiersIn(source).flatMap((specifier) => {
    const path = resolvedPath(file, specifier)
    return path !== null && refused(path) ? [`${file} imports ${specifier}`] : []
  })
}

function sourceFiles(dir: string): string[] {
  return readdirSync(join(ROOT, dir), { recursive: true, encoding: 'utf8' })
    .filter((path) => SOURCE.test(path) && !path.split(sep).includes('node_modules'))
    .map((path) => posix.join(dir, path.split(sep).join(posix.sep)))
}

const files = SCANNED.flatMap(sourceFiles)
const readSource = (file: string): string => readFileSync(join(ROOT, file), 'utf8')

describe('the evaluation harness stays out of the product', () => {
  test('nothing under shared/, server/, web/ or scripts/ imports the report or the plan metrics', () => {
    // a scan that finds no files, or too few, passes for nothing
    expect(files.length).toBeGreaterThan(200)
    for (const dir of SCANNED)
      expect(
        files.some((f) => f.startsWith(`${dir}/`)),
        dir,
      ).toBe(true)
    const offences = files.flatMap((file) => offendingImports(file, readSource(file), isHarness))
    expect(offences).toEqual([])
  })

  test('nothing under those directories imports anything under tests/', () => {
    const underTests = (path: string) => path === 'tests' || path.startsWith('tests/')
    const offences = files.flatMap((file) => offendingImports(file, readSource(file), underTests))
    expect(offences).toEqual([])
  })

  test('the harness files exist where the scan looks for them', () => {
    for (const entry of [...HARNESS, 'tests/reports/plan-report.ts', 'tests/reports/bands.ts']) {
      expect(existsSync(join(ROOT, entry)), entry).toBe(true)
    }
  })

  test('catches a static import, a re-export, a side-effect import, a dynamic import and a require', () => {
    const from = (file: string, line: string) => offendingImports(file, line, isHarness)
    expect(from('server/a.ts', "import { x } from '../tests/reports/plan-report.ts'")).toEqual([
      'server/a.ts imports ../tests/reports/plan-report.ts',
    ])
    expect(
      from(
        'shared/engine/a.ts',
        "import type { Figure } from '../../tests/unit/engine/plan-metrics.ts'",
      ),
    ).toHaveLength(1)
    expect(from('web/pages/a.tsx', "export * from '../../tests/reports/bands.ts'")).toHaveLength(1)
    expect(from('scripts/a.ts', "import '../tests/reports/plan-report.ts'")).toHaveLength(1)
    expect(
      from('scripts/a.ts', "const m = await import('../tests/reports/plan-report.ts')"),
    ).toHaveLength(1)
    expect(from('scripts/a.ts', "const m = require('../tests/reports/bands.ts')")).toHaveLength(1)
    expect(from('web/a.ts', "const m = import.meta.glob('../tests/reports/*.ts')")).toHaveLength(1)
  })

  test('catches an import over several lines, one without the extension and one from the root', () => {
    const multi = [
      'import {',
      '  describePlan,',
      '  type Figure,',
      "} from '../../tests/unit/engine/plan-metrics.ts'",
    ].join('\n')
    expect(offendingImports('shared/engine/a.ts', multi, isHarness)).toHaveLength(1)
    expect(
      offendingImports(
        'shared/engine/a.ts',
        "import x from '../../tests/unit/engine/plan-metrics'",
        isHarness,
      ),
    ).toHaveLength(1)
    expect(
      offendingImports('server/a.ts', "import x from 'tests/reports/bands.ts'", isHarness),
    ).toHaveLength(1)
  })

  test('lets an import of the product, of a package, and a comment that names the harness, through', () => {
    const clean = [
      "import { addDays } from '../../shared/dates.ts'",
      "import { z } from 'zod'",
      "import { readFileSync } from 'node:fs'",
      '// import { describePlan } from "../tests/unit/engine/plan-metrics.ts"',
      ' * import x from "../tests/reports/plan-report.ts"',
      '/* import y from "../tests/reports/bands.ts" */',
    ].join('\n')
    expect(offendingImports('server/a.ts', clean, isHarness)).toEqual([])
    // a sibling of the harness is not the harness
    expect(isHarness('tests/unit/engine/plan-metrics.test.ts')).toBe(false)
    expect(isHarness('tests/reporting/other.ts')).toBe(false)
    expect(isHarness('tests/reports/bands.ts')).toBe(true)
    expect(isHarness('tests/unit/engine/plan-metrics.ts')).toBe(true)
  })

  test('refuses any path under tests/ in the broader scan, from any depth', () => {
    const underTests = (path: string) => path === 'tests' || path.startsWith('tests/')
    expect(
      offendingImports(
        'web/pages/a.ts',
        "import x from '../../tests/fixtures/fit/buildFit.ts'",
        underTests,
      ),
    ).toHaveLength(1)
    expect(offendingImports('web/pages/a.ts', "import x from '../b.ts'", underTests)).toEqual([])
    // a path that leaves the repository is not under tests/
    expect(
      offendingImports('web/pages/a.ts', "import x from '../../../tests/x.ts'", underTests),
    ).toEqual([])
  })
})
