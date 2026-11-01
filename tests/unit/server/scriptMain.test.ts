import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'

/**
 * A script started through a symlinked path must run: `process.argv[1]` keeps the path as typed
 * while the module URL is the real path, and a guard that compared them as given made the script
 * do nothing and exit 0, which `npm run db:migrate` would take for a finished backup.
 */

const ROOT = resolve(import.meta.dirname, '../../..')
const TSX = resolve(ROOT, 'node_modules/tsx/dist/cli.mjs')

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'rl-main-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

// Each case starts a node process with tsx, which takes seconds on a loaded runner: the explicit
// 90 s timeout on the cases below is for that process start, not for any work of the scripts.
describe('the main-module guard of the backup scripts', () => {
  for (const [script, usage] of [
    ['backup', 'Usage: npm run backup'],
    ['restore', 'Usage: npm run restore'],
  ] as const) {
    test(`${script}: runs when started through a symlink to the file`, () => {
      const link = join(dir, `${script}.ts`)
      symlinkSync(resolve(ROOT, `scripts/${script}.ts`), link)

      const result = spawnSync(process.execPath, [TSX, link, '--help'], {
        cwd: ROOT,
        encoding: 'utf8',
        timeout: 60_000,
      })

      expect(result.stderr).toBe('')
      expect(result.stdout).toContain(usage)
      expect(result.status).toBe(0)
    }, 90_000)

    test(`${script}: runs when started by its real path`, () => {
      const result = spawnSync(
        process.execPath,
        [TSX, resolve(ROOT, `scripts/${script}.ts`), '--help'],
        {
          cwd: ROOT,
          encoding: 'utf8',
          timeout: 60_000,
        },
      )

      expect(result.stdout).toContain(usage)
    }, 90_000)
  }
})
