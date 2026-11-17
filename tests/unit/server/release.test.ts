import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
  buildNote,
  commitsSince,
  lastTag,
  migrationsSince,
  readinessProblems,
  summarizeSql,
  tagCommands,
} from '../../../scripts/release.ts'
import { APP_VERSION, logListening, readAppVersion } from '../../../server/version.ts'

// RI1: the release script against a temporary git repository, the version reader and the
// start-up line.

let repo: string

function git(...args: string[]): string {
  return execFileSync('git', args, {
    cwd: repo,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'Test',
      GIT_AUTHOR_EMAIL: 'test@example.com',
      GIT_COMMITTER_NAME: 'Test',
      GIT_COMMITTER_EMAIL: 'test@example.com',
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_CONFIG_SYSTEM: '/dev/null',
    },
  }).trim()
}

function write(path: string, text: string): void {
  mkdirSync(dirname(join(repo, path)), { recursive: true })
  writeFileSync(join(repo, path), text)
}

function commit(message: string): void {
  git('add', '-A')
  git('commit', '-q', '-m', message)
}

const ADD_COLUMN = 'ALTER TABLE "Plan" ADD COLUMN "note" TEXT;\n'
const REDEFINE = `-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Run" ("id" TEXT NOT NULL PRIMARY KEY, "km" REAL);
INSERT INTO "new_Run" ("id", "km") SELECT "id", "km" FROM "Run";
DROP TABLE "Run";
ALTER TABLE "new_Run" RENAME TO "Run";
CREATE INDEX "Run_km_idx" ON "Run"("km");
PRAGMA foreign_keys=ON;
`

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'rl-release-'))
  git('init', '-q', '-b', 'main')
  write('package.json', JSON.stringify({ name: 'running-app', version: '1.0.0' }))
  write('prisma/migrations/20260101000000_init/migration.sql', 'CREATE TABLE "Plan" ("id" TEXT);\n')
  commit('chore: first')
  git('tag', '-a', 'v1.0.0', '-m', 'one')
})

afterEach(() => {
  rmSync(repo, { recursive: true, force: true })
})

describe('the migration listing', () => {
  test('lists only the migrations added since the last tag, each with its SQL summary', () => {
    write('prisma/migrations/20260201000000_note/migration.sql', ADD_COLUMN)
    write('prisma/migrations/20260202000000_run/migration.sql', REDEFINE)
    write('prisma/migrations/migration_lock.toml', 'provider = "sqlite"\n')
    write('web/x.ts', 'export {}\n')
    commit('feat: a change')

    expect(lastTag(repo)).toBe('v1.0.0')
    const entries = migrationsSince(repo, lastTag(repo))
    expect(entries.map((e) => e.file)).toEqual([
      'prisma/migrations/20260201000000_note/migration.sql',
      'prisma/migrations/20260202000000_run/migration.sql',
    ])
    expect(entries[0]?.summary).toEqual({ ddl: ['ADD COLUMN Plan.note'], dml: [], destructive: [] })
    expect(entries[1]?.summary.ddl).toEqual(['REDEFINE TABLE Run', 'CREATE INDEX on Run'])
    expect(entries[1]?.summary.dml).toEqual([])
    expect(entries[1]?.summary.destructive).toHaveLength(1)
    expect(commitsSince(repo, 'v1.0.0')).toHaveLength(1)
  })

  test('lists none when nothing was added, and all of them when there is no tag', () => {
    write('web/x.ts', 'export {}\n')
    commit('feat: no schema')
    expect(migrationsSince(repo, 'v1.0.0')).toEqual([])
    expect(migrationsSince(repo, null).map((e) => e.folder)).toEqual(['20260101000000_init'])
    expect(
      buildNote({
        version: '1.1.0',
        since: 'v1.0.0',
        date: '2026-11-17',
        commits: [],
        migrations: [],
      }),
    ).toContain('No migration is added: run the previous image tag (v1.0.0)')
  })

  test('summarises statements: DML, drops and deletes are named and flagged', () => {
    const summary = summarizeSql(`-- note
INSERT INTO "Plan" ("id") VALUES ('a');
UPDATE "Plan" SET "id" = 'b';
DELETE FROM "Plan" WHERE "id" = 'c';
DROP TABLE "Old";
CREATE UNIQUE INDEX "Plan_id_key" ON "Plan"("id");
`)
    expect(summary.dml).toEqual(['INSERT INTO Plan', 'UPDATE Plan', 'DELETE FROM Plan'])
    expect(summary.ddl).toEqual(['DROP TABLE Old', 'CREATE INDEX on Plan'])
    expect(summary.destructive).toEqual(['DELETE FROM Plan', 'DROP TABLE Old'])
  })

  test('the note names the migrations and says how to roll back', () => {
    write('prisma/migrations/20260201000000_note/migration.sql', ADD_COLUMN)
    commit('feat: schema')
    const note = buildNote({
      version: '1.1.0',
      since: 'v1.0.0',
      date: '2026-11-17',
      commits: commitsSince(repo, 'v1.0.0'),
      migrations: migrationsSince(repo, 'v1.0.0'),
    })
    expect(note).toContain('# Release v1.1.0')
    expect(note).toContain('prisma/migrations/20260201000000_note/migration.sql')
    expect(note).toContain('ADD COLUMN Plan.note')
    expect(note).toContain('Rolling back the image alone is opt-in')
    expect(note).toContain('Restore the oldest `pre-migrate` backup')
  })
})

describe('the readiness checks', () => {
  test('passes on a clean main whose package.json matches', () => {
    expect(readinessProblems(repo, '1.1.0')).toEqual([
      'package.json says 1.0.0; set "version" to 1.1.0 in a reviewed change first.',
    ])
    write('package.json', JSON.stringify({ name: 'running-app', version: '1.1.0' }))
    commit('chore: bump')
    expect(readinessProblems(repo, '1.1.0')).toEqual([])
  })

  test('refuses a dirty tree, another branch and an existing tag', () => {
    write('stray.txt', 'x')
    expect(readinessProblems(repo, '1.0.0')).toEqual([
      'The working tree is not clean.',
      'The tag v1.0.0 already exists.',
    ])
    git('add', '-A')
    git('checkout', '-q', '-b', 'feature')
    expect(readinessProblems(repo, '1.0.0')).toContain('HEAD is on "feature", not main.')
    expect(readinessProblems(repo, 'next')).toContain('"next" is not a version such as 2.1.0.')
  })

  test('prints the tag and push commands and runs neither', () => {
    expect(tagCommands('1.1.0', 'release-notes/v1.1.0.md')).toEqual([
      'git tag -a v1.1.0 -F release-notes/v1.1.0.md --cleanup=verbatim',
      'git push origin v1.1.0',
    ])
    expect(git('tag', '--list')).toBe('v1.0.0')
  })
})

describe('the version the server knows', () => {
  test('reads the nearest package.json above a folder', () => {
    write('a/b/file.txt', '')
    expect(readAppVersion(join(repo, 'a/b'))).toBe('1.0.0')
    expect(readAppVersion()).toBe(APP_VERSION)
    expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+/)
  })

  test('the start-up line carries the port and the version', () => {
    const info = vi.fn()
    logListening({ info }, 3001)
    expect(info).toHaveBeenCalledWith({ port: 3001, version: APP_VERSION }, 'server listening')
  })
})
