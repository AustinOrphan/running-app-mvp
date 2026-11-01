import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, posix, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import config from '../../../vitest.config.ts'
import { SWEEP_FILES, SWEEP_TIMEOUT_MS } from '../../vitestProjects.ts'

/**
 * The `sweep` project of `vitest.config.ts` (the list in `tests/vitestProjects.ts`): the long
 * engine files, which set one test timeout in the project and which CI runs in its own jobs. A file
 * under `tests/unit/engine` that calls `vi.setConfig({ testTimeout ... })` and is not in that list
 * has grown a private timeout instead: it is long, and belongs in the project, where the CI split
 * and the shards can see it. This test names such a file.
 */

const ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const ENGINE = 'tests/unit/engine'

/** A call that sets the test timeout of the running file: `vi.setConfig({ ..., testTimeout: ... })`. */
const SETS_TIMEOUT = /\b(?:vi|vitest)\s*\.\s*setConfig\s*\(\s*\{[^}]*\btestTimeout\b/

/** Whether `source` sets the test timeout of its file; lines that open with a comment are skipped. */
function setsTestTimeout(source: string): boolean {
  const code = source
    .split('\n')
    .filter((line) => !/^\s*(?:\/\/|\/\*|\*)/.test(line))
    .join('\n')
  return SETS_TIMEOUT.test(code)
}

/** The repo-relative paths of the `.ts` files under `dir`, whatever their depth. */
function sourceFiles(dir: string): string[] {
  return readdirSync(join(ROOT, dir), { recursive: true, encoding: 'utf8' })
    .filter((path) => path.endsWith('.ts'))
    .map((path) => posix.join(dir, path.split(sep).join(posix.sep)))
}

type ProjectConfig = {
  name?: string
  include?: string[]
  exclude?: string[]
  testTimeout?: number
}
const projects = ((config.test?.projects ?? []) as Array<{ test?: ProjectConfig }>).flatMap((p) =>
  p.test === undefined ? [] : [p.test],
)
const named = (name: string): ProjectConfig | undefined => projects.find((p) => p.name === name)

describe('a long engine file goes into the sweep project', () => {
  test('no file under tests/unit/engine sets its own test timeout outside the sweep list', () => {
    const files = sourceFiles(ENGINE)
    // a scan that finds no files, or too few, passes for nothing
    expect(files.length).toBeGreaterThan(50)
    const offenders = files.filter(
      (file) =>
        !SWEEP_FILES.includes(file) && setsTestTimeout(readFileSync(join(ROOT, file), 'utf8')),
    )
    expect(
      offenders,
      'add these files to SWEEP_FILES in tests/vitestProjects.ts instead of setting a timeout in them',
    ).toEqual([])
  })

  test('the sweep list names engine test files that exist, once each', () => {
    expect(SWEEP_FILES.length).toBeGreaterThan(0)
    expect(new Set(SWEEP_FILES).size).toBe(SWEEP_FILES.length)
    for (const file of SWEEP_FILES) {
      expect(file.startsWith(`${ENGINE}/`) && file.endsWith('.test.ts'), file).toBe(true)
      expect(existsSync(join(ROOT, file)), file).toBe(true)
    }
  })

  test('the config runs exactly that list in the sweep project, with the one timeout', () => {
    const sweep = named('sweep')
    expect(sweep?.include).toEqual([...SWEEP_FILES])
    expect(sweep?.testTimeout).toBe(SWEEP_TIMEOUT_MS)
    // the server project leaves the sweep files to the sweep project, so a file is never run twice
    expect(named('server')?.exclude).toEqual(expect.arrayContaining([...SWEEP_FILES]))
  })

  test('catches a timeout set in the call forms a file would use, and only those', () => {
    expect(setsTestTimeout('vi.setConfig({ testTimeout: 60_000 })')).toBe(true)
    expect(setsTestTimeout('vi.setConfig({ testTimeout: 2 * BUDGET_MS })')).toBe(true)
    expect(setsTestTimeout('vi.setConfig( {\n  testTimeout: 900_000,\n} )')).toBe(true)
    expect(setsTestTimeout('vi.setConfig({ retry: 1, testTimeout: 5_000 })')).toBe(true)
    expect(setsTestTimeout('vitest.setConfig({ testTimeout: 1 })')).toBe(true)
    // a timeout on one test, another option, and a comment that names the call are not it
    expect(setsTestTimeout("it('x', () => {}, 120_000)")).toBe(false)
    expect(setsTestTimeout('vi.setConfig({ retry: 1 })')).toBe(false)
    expect(setsTestTimeout('// vi.setConfig({ testTimeout: 60_000 })')).toBe(false)
    expect(setsTestTimeout(' * vi.setConfig({ testTimeout: 60_000 })')).toBe(false)
  })
})
