import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, posix, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import config from '../../../vitest.config.ts'
import { MOCKED_FILES, SWEEP_FILES, SWEEP_TIMEOUT_MS } from '../../vitestProjects.ts'

/**
 * The file lists of two projects of `vitest.config.ts` (`tests/vitestProjects.ts`).
 *
 * `sweep`: the long engine files, which set one test timeout in the project and which CI runs in
 * its own jobs. A file under `tests/unit/engine` that calls `vi.setConfig({ testTimeout ... })` and
 * is not in that list has grown a private timeout instead: it is long, and belongs in the project,
 * where the CI split and the shards can see it.
 *
 * `mocked`: the files of `tests/unit/engine` and `tests/unit/shared` that replace a module with
 * `vi.mock()`. The other files there, but the sweep files, run without isolation in the `pure`
 * project, in a worker that they share, where a mock fails other files in an order that depends on
 * the machine. A file that mocks a module and is in neither list is named here, and the test says
 * where to put it.
 */

const ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const ENGINE = 'tests/unit/engine'
const SHARED = 'tests/unit/shared'

/** A call that sets the test timeout of the running file: `vi.setConfig({ ..., testTimeout: ... })`. */
const SETS_TIMEOUT = /\b(?:vi|vitest)\s*\.\s*setConfig\s*\(\s*\{[^}]*\btestTimeout\b/

/** A call that replaces a module: `vi.mock(...)` or `vi.doMock(...)`. */
const MOCKS_MODULE = /\b(?:vi|vitest)\s*\.\s*(?:mock|doMock)\s*\(/

/** `source` without the lines that open with a comment marker. */
function withoutComments(source: string): string {
  return source
    .split('\n')
    .filter((line) => !/^\s*(?:\/\/|\/\*|\*)/.test(line))
    .join('\n')
}

/** Whether `source` sets the test timeout of its file. */
function setsTestTimeout(source: string): boolean {
  return SETS_TIMEOUT.test(withoutComments(source))
}

/** Whether `source` replaces a module. */
function mocksModule(source: string): boolean {
  return MOCKS_MODULE.test(withoutComments(source))
}

/** The repo-relative paths of the `.ts` files under `dir`, whatever their depth. */
function sourceFiles(dir: string): string[] {
  return readdirSync(join(ROOT, dir), { recursive: true, encoding: 'utf8' })
    .filter((path) => path.endsWith('.ts'))
    .map((path) => posix.join(dir, path.split(sep).join(posix.sep)))
}

const read = (file: string): string => readFileSync(join(ROOT, file), 'utf8')

type ProjectConfig = {
  name?: string
  include?: string[]
  exclude?: string[]
  isolate?: boolean
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
      (file) => !SWEEP_FILES.includes(file) && setsTestTimeout(read(file)),
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
    // the other engine files run in `pure`, which leaves the sweep files to the sweep project
    expect(named('pure')?.exclude).toEqual(expect.arrayContaining([...SWEEP_FILES]))
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

describe('a file that mocks a module keeps its worker', () => {
  test('every file under tests/unit/engine and tests/unit/shared that mocks a module is in the mocked or the sweep list', () => {
    const files = [...sourceFiles(ENGINE), ...sourceFiles(SHARED)]
    expect(files.length).toBeGreaterThan(100)
    // the sweep project keeps isolation, so a sweep file may mock a module
    const offenders = files.filter(
      (file) =>
        !MOCKED_FILES.includes(file) && !SWEEP_FILES.includes(file) && mocksModule(read(file)),
    )
    expect(
      offenders,
      'add these files to MOCKED_FILES in tests/vitestProjects.ts: without a worker of their own a mock fails other files',
    ).toEqual([])
  })

  test('the mocked list names test files that exist, once each, and none of them is a sweep file', () => {
    expect(MOCKED_FILES.length).toBeGreaterThan(0)
    expect(new Set(MOCKED_FILES).size).toBe(MOCKED_FILES.length)
    for (const file of MOCKED_FILES) {
      expect(
        (file.startsWith(`${ENGINE}/`) || file.startsWith(`${SHARED}/`)) &&
          file.endsWith('.test.ts'),
        file,
      ).toBe(true)
      expect(existsSync(join(ROOT, file)), file).toBe(true)
      expect(SWEEP_FILES, file).not.toContain(file)
      // a listed file that no longer mocks anything can go back to the shared workers
      expect(mocksModule(read(file)), `${file} mocks no module`).toBe(true)
    }
  })

  test('the config shares workers in the pure project only', () => {
    expect(named('mocked')?.include).toEqual([...MOCKED_FILES])
    expect(named('pure')?.exclude).toEqual(expect.arrayContaining([...MOCKED_FILES]))
    expect(named('pure')?.isolate).toBe(false)
    // every other project keeps the default, a worker per file: the mocked files for their mocks,
    // the sweep files because sharing gained them nothing, `server` and `web` for their module state
    for (const name of ['mocked', 'sweep', 'server', 'web']) {
      expect(named(name), name).toBeDefined()
      expect(named(name)?.isolate ?? true, name).toBe(true)
    }
  })

  test('catches vi.mock and vi.doMock, and not a comment or a spy', () => {
    expect(mocksModule("vi.mock('../x.ts', () => ({}))")).toBe(true)
    expect(mocksModule("await vi.doMock('../x.ts')")).toBe(true)
    expect(mocksModule("vitest.mock('../x.ts')")).toBe(true)
    expect(mocksModule("// vi.mock('../x.ts')")).toBe(false)
    expect(mocksModule("vi.spyOn(Intl, 'DateTimeFormat')")).toBe(false)
    expect(mocksModule('const mock = vi.fn()')).toBe(false)
  })
})
