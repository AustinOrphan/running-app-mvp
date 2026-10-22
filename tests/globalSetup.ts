import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { TestProject } from 'vitest/node'

declare module 'vitest' {
  export interface ProvidedContext {
    templateDbPath: string
  }
}

/**
 * Applies the migrations once to a template SQLite file. Each API test file copies it, so no
 * file pays for a migration run and no two files share a database.
 */
export default function setup(project: TestProject): () => void {
  const dir = mkdtempSync(join(tmpdir(), 'rl-template-'))
  const templatePath = join(dir, 'template.db')
  execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
    env: { ...process.env, DATABASE_URL: `file:${templatePath}` },
    stdio: 'pipe',
  })
  project.provide('templateDbPath', templatePath)
  return () => {
    rmSync(dir, { recursive: true, force: true })
  }
}
