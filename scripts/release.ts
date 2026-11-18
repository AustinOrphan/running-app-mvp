import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { isMainModule } from './isMain.ts'

// RI1 (decision D8): the server runs a version tag, not main. `npm run release -- <version>`
// checks that the tree is ready, prints what the tag would carry (the commits and the migrations
// since the last tag) and writes a draft "what changed" note. It runs no `git tag` and no
// `git push`: it prints both commands for the owner. It changes no tracked file.

const HELP = `Usage: npm run release -- <version> [--from <ref>] [--out <dir>]

Prepares the release tag v<version>. <version> must equal "version" in package.json, which the
server shows in Settings, in the deep health answer and in its start-up line; raise it in a
reviewed change before releasing.

Checks that the working tree is clean, that HEAD is main (and equals origin/main when that ref
exists) and that the tag does not exist yet. Prints the commits since the last v* tag, lists
every migration added since then with a summary of its SQL, writes a draft note to
release-notes/v<version>.md (gitignored) and prints the git tag and git push commands for you to
run. Nothing is tagged or pushed by this script.

  --from <ref>  Compare with this ref instead of the newest v* tag.
  --out <dir>   Write the note under this folder instead of release-notes/.`

const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/

/** Runs git in `cwd` and returns its trimmed output; throws with git's message on failure. */
export function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
}

function gitOrNull(cwd: string, args: string[]): string | null {
  try {
    return git(cwd, args)
  } catch {
    return null
  }
}

/** The newest `v*` tag reachable from HEAD, or null when there is none. */
export function lastTag(cwd: string): string | null {
  const tag = gitOrNull(cwd, ['describe', '--tags', '--abbrev=0', '--match', 'v*'])
  return tag === null || tag === '' ? null : tag
}

/** The first-parent history after `since` (all of it when null), one `<hash> <subject>` per line. */
export function commitsSince(cwd: string, since: string | null): string[] {
  const range = since === null ? ['HEAD'] : [`${since}..HEAD`]
  const out = git(cwd, ['log', '--first-parent', '--format=%h %s', ...range])
  return out === '' ? [] : out.split('\n')
}

/** The `migration.sql` paths added after `since` (all of them when null), oldest name first. */
export function migrationFilesSince(cwd: string, since: string | null): string[] {
  const out =
    since === null
      ? git(cwd, ['ls-tree', '-r', '--name-only', 'HEAD', '--', 'prisma/migrations'])
      : git(cwd, [
          'diff',
          '--name-only',
          '--diff-filter=A',
          `${since}..HEAD`,
          '--',
          'prisma/migrations',
        ])
  return out
    .split('\n')
    .filter((path) => /^prisma\/migrations\/[^/]+\/migration\.sql$/.test(path))
    .sort()
}

export interface SqlSummary {
  ddl: string[]
  dml: string[]
  /** Statements that remove structure or rows; a rollback of the image alone cannot restore them. */
  destructive: string[]
}

const NAME = String.raw`["\`]?(\w+)["\`]?`

function count(list: string[]): string[] {
  const tally = new Map<string, number>()
  for (const item of list) tally.set(item, (tally.get(item) ?? 0) + 1)
  return [...tally].map(([item, n]) => (n === 1 ? item : `${item} (x${String(n)})`))
}

/**
 * A short account of a migration's SQL. Prisma's SQLite "redefine" of a table (create `new_X`,
 * copy, drop `X`, rename) is one line, `REDEFINE TABLE X`; its copy statement is not listed as a
 * separate insert.
 */
export function summarizeSql(sql: string): SqlSummary {
  const statements = sql
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n')
    .split(/;\s*(?:\n|$)/)
    .map((statement) => statement.trim())
    .filter((statement) => statement !== '')
  const redefined = new Set<string>()
  for (const statement of statements) {
    const match = new RegExp(`^CREATE TABLE ${NAME}`, 'i').exec(statement)
    if (match?.[1]?.startsWith('new_') === true) redefined.add(match[1].slice('new_'.length))
  }
  const ddl: string[] = []
  const dml: string[] = []
  const destructive: string[] = []
  for (const name of redefined) {
    ddl.push(`REDEFINE TABLE ${name}`)
    destructive.push(`REDEFINE TABLE ${name} (rows are copied into a new table)`)
  }
  const first = (re: string, statement: string) => new RegExp(re, 'i').exec(statement)
  for (const statement of statements) {
    if (/^PRAGMA\b/i.test(statement)) continue
    let m: RegExpExecArray | null
    if ((m = first(`^CREATE TABLE ${NAME}`, statement))) {
      if (!m[1]?.startsWith('new_')) ddl.push(`CREATE TABLE ${m[1] ?? ''}`)
    } else if ((m = first(`^INSERT INTO ${NAME}`, statement))) {
      if (!m[1]?.startsWith('new_')) dml.push(`INSERT INTO ${m[1] ?? ''}`)
    } else if ((m = first(`^UPDATE ${NAME}`, statement))) {
      dml.push(`UPDATE ${m[1] ?? ''}`)
    } else if ((m = first(`^DELETE FROM ${NAME}`, statement))) {
      dml.push(`DELETE FROM ${m[1] ?? ''}`)
      destructive.push(`DELETE FROM ${m[1] ?? ''}`)
    } else if ((m = first(`^DROP TABLE ${NAME}`, statement))) {
      if (!redefined.has(m[1] ?? '')) {
        ddl.push(`DROP TABLE ${m[1] ?? ''}`)
        destructive.push(`DROP TABLE ${m[1] ?? ''}`)
      }
    } else if ((m = first(`^ALTER TABLE ${NAME} RENAME TO ${NAME}`, statement))) {
      if (!m[1]?.startsWith('new_')) ddl.push(`RENAME TABLE ${m[1] ?? ''} TO ${m[2] ?? ''}`)
    } else if ((m = first(`^ALTER TABLE ${NAME} ADD COLUMN ${NAME}`, statement))) {
      ddl.push(`ADD COLUMN ${m[1] ?? ''}.${m[2] ?? ''}`)
    } else if ((m = first(`^ALTER TABLE ${NAME} DROP COLUMN ${NAME}`, statement))) {
      ddl.push(`DROP COLUMN ${m[1] ?? ''}.${m[2] ?? ''}`)
      destructive.push(`DROP COLUMN ${m[1] ?? ''}.${m[2] ?? ''}`)
    } else if ((m = first(`^CREATE (?:UNIQUE )?INDEX ${NAME} ON ${NAME}`, statement))) {
      ddl.push(`CREATE INDEX on ${m[2] ?? ''}`)
    } else if ((m = first(`^DROP INDEX ${NAME}`, statement))) {
      ddl.push(`DROP INDEX ${m[1] ?? ''}`)
    } else {
      ddl.push(`OTHER: ${statement.slice(0, 60).replace(/\s+/g, ' ')}`)
    }
  }
  return { ddl: count(ddl), dml: count(dml), destructive: count(destructive) }
}

export interface MigrationEntry {
  folder: string
  file: string
  summary: SqlSummary
}

/** Every migration added since `since`, read from HEAD, with its SQL summarised. */
export function migrationsSince(cwd: string, since: string | null): MigrationEntry[] {
  return migrationFilesSince(cwd, since).map((file) => ({
    folder: file.split('/')[2] ?? file,
    file,
    summary: summarizeSql(git(cwd, ['show', `HEAD:${file}`])),
  }))
}

/** Why the tree is not ready for `version`, one reason per entry; empty when it is. */
export function readinessProblems(cwd: string, version: string): string[] {
  const problems: string[] = []
  if (!SEMVER.test(version)) problems.push(`"${version}" is not a version such as 2.1.0.`)
  if (git(cwd, ['status', '--porcelain']) !== '') problems.push('The working tree is not clean.')
  const branch = git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD'])
  if (branch !== 'main') problems.push(`HEAD is on "${branch}", not main.`)
  const remote = gitOrNull(cwd, ['rev-parse', 'origin/main'])
  if (remote !== null && remote !== git(cwd, ['rev-parse', 'HEAD'])) {
    problems.push('main is not at origin/main; fetch and fast-forward first.')
  }
  let packageVersion: string | undefined
  try {
    packageVersion = (
      JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf8')) as {
        version?: string
      }
    ).version
  } catch {
    problems.push('package.json could not be read.')
  }
  if (packageVersion !== undefined && packageVersion !== version) {
    problems.push(
      `package.json says ${packageVersion}; set "version" to ${version} in a reviewed change first.`,
    )
  }
  if (gitOrNull(cwd, ['rev-parse', '--verify', '--quiet', `refs/tags/v${version}`]) !== null) {
    problems.push(`The tag v${version} already exists.`)
  }
  return problems
}

export interface NoteInput {
  version: string
  since: string | null
  date: string
  commits: string[]
  migrations: MigrationEntry[]
}

function migrationLines(entry: MigrationEntry): string[] {
  const { ddl, dml, destructive } = entry.summary
  const lines = [`### ${entry.folder}`, '', `File: \`${entry.file}\``, '']
  lines.push(`- DDL: ${ddl.length > 0 ? ddl.join('; ') : 'none'}`)
  lines.push(`- DML: ${dml.length > 0 ? dml.join('; ') : 'none'}`)
  if (destructive.length > 0) lines.push(`- Destructive: ${destructive.join('; ')}`)
  lines.push('')
  return lines
}

/** The draft note: the commits, the migrations, the owner's blank, and how to roll back. */
export function buildNote(input: NoteInput): string {
  const { version, since, date, commits, migrations } = input
  const lines = [
    `# Release v${version}`,
    '',
    `Drafted ${date}. Commits since ${since ?? 'the start of the history'}.`,
    '',
    '## What changed',
    '',
    '(Write for the testers: what is new, what moved, what to look at. Delete this line.)',
    '',
    '## Commits',
    '',
    ...(commits.length > 0 ? commits.map((c) => `- ${c}`) : ['- none']),
    '',
    '## Migrations',
    '',
  ]
  if (migrations.length === 0) lines.push('None.', '')
  for (const entry of migrations) lines.push(...migrationLines(entry))
  lines.push(
    '## Roll back',
    '',
    'Rolling back the image alone is opt-in, and only with the migration list above read:',
    '',
    ...(migrations.length === 0
      ? [
          `- No migration is added: run the previous image tag${since === null ? '' : ` (${since})`} on the same data volume. Nothing else changes.`,
        ]
      : [
          '- A migration is added: the previous image does not know the new schema. Restore the oldest `pre-migrate` backup of this update first (README, "Roll back"), then run the previous image tag. Data entered since the update is lost.',
          '- Only when every entry above is additive (CREATE and ADD COLUMN, no Destructive line) may the previous image be tried on the migrated database; nothing guarantees it works.',
        ]),
    '',
  )
  return lines.join('\n')
}

/** The two commands for the owner; the script runs neither. */
export function tagCommands(version: string, notePath: string): string[] {
  return [`git tag -a v${version} -F ${notePath} --cleanup=verbatim`, `git push origin v${version}`]
}

function main(): number {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      from: { type: 'string' },
      out: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
  })
  if (values.help === true) {
    console.log(HELP)
    return 0
  }
  const raw = positionals[0]
  if (raw === undefined || positionals.length > 1) {
    console.error(HELP)
    return 2
  }
  const version = raw.replace(/^v/, '')
  const cwd = process.cwd()
  const problems = readinessProblems(cwd, version)
  if (problems.length > 0) {
    console.error(problems.map((p) => `Not ready: ${p}`).join('\n'))
    return 1
  }
  const since = values.from ?? lastTag(cwd)
  const commits = commitsSince(cwd, since)
  const migrations = migrationsSince(cwd, since)
  console.log(`Releasing v${version}; last tag: ${since ?? 'none'}.\n`)
  console.log(`Commits since ${since ?? 'the start'} (${String(commits.length)}):`)
  console.log(commits.length > 0 ? commits.map((c) => `  ${c}`).join('\n') : '  none')
  console.log(`\nMigrations added (${String(migrations.length)}):`)
  for (const entry of migrations) {
    console.log(migrationLines(entry).slice(0, -1).join('\n').replace(/^### /, '  '))
  }
  if (migrations.length === 0) console.log('  none')

  const outDir = resolve(cwd, values.out ?? 'release-notes')
  mkdirSync(outDir, { recursive: true })
  const notePath = join(outDir, `v${version}.md`)
  writeFileSync(
    notePath,
    buildNote({
      version,
      since,
      date: new Date().toISOString().slice(0, 10),
      commits,
      migrations,
    }),
  )
  console.log(`\nDraft note: ${notePath}`)
  console.log(
    '\nBefore tagging: run `docker build .` and `npm run -s plan:report`, read both, and edit the note.',
  )
  console.log('Then run, yourself:\n')
  for (const command of tagCommands(version, notePath)) console.log(`  ${command}`)
  return 0
}

if (isMainModule(import.meta.url)) process.exitCode = main()
