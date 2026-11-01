import { existsSync, readFileSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import { describe, expect, test } from 'vitest'

/**
 * `npm run db:migrate` runs `scripts/backup.ts` before `prisma migrate deploy`, on a clone where
 * `prisma generate` may not have run, so neither backup script may load the generated client
 * (`server/db.ts` does, and so does anything that imports `@prisma/client`).
 */

const ROOT = resolve(import.meta.dirname, '../../..')
const STATIC_IMPORT = /^\s*(?:import|export)\s+(?!type\b)(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]/gm
const DYNAMIC_IMPORT = /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g

/** The module specifiers a file loads at run time (type-only imports are erased and not listed). */
function specifiersOf(file: string): string[] {
  const text = readFileSync(file, 'utf8')
  return [...text.matchAll(STATIC_IMPORT), ...text.matchAll(DYNAMIC_IMPORT)].map(
    (match) => match[1] ?? '',
  )
}

/** Every file reachable from `entry` through relative imports, and every package they name. */
function graphOf(entry: string): { files: string[]; packages: string[] } {
  const files = new Set<string>()
  const packages = new Set<string>()
  const queue = [entry]
  while (queue.length > 0) {
    const file = queue.pop() as string
    if (files.has(file)) continue
    files.add(file)
    for (const specifier of specifiersOf(file)) {
      if (specifier.startsWith('.')) {
        const next = resolve(dirname(file), specifier)
        if (!existsSync(next)) throw new Error(`${relative(ROOT, file)} imports ${specifier}`)
        queue.push(next)
      } else if (!specifier.startsWith('node:')) {
        packages.add(specifier)
      }
    }
  }
  return { files: [...files].map((file) => relative(ROOT, file)).sort(), packages: [...packages] }
}

function reachesPrisma(graph: { files: string[]; packages: string[] }): string[] {
  return [
    ...graph.packages.filter((name) => name === 'prisma' || name.startsWith('@prisma/')),
    ...graph.files.filter((file) => file.split('/').includes('generated')),
    ...graph.files.filter((file) => file === 'server/db.ts'),
  ]
}

describe('the backup scripts load no Prisma client', () => {
  for (const script of ['scripts/backup.ts', 'scripts/restore.ts']) {
    test(`${script}: its imports reach neither @prisma/*, generated/ nor server/db.ts`, () => {
      const graph = graphOf(resolve(ROOT, script))
      // The walk found the code it is meant to guard, so an empty result is not a pass by accident.
      expect(graph.files).toContain('server/dbPath.ts')
      expect(graph.files).toContain('server/services/backup.ts')
      expect(graph.packages).toContain('better-sqlite3')
      expect(reachesPrisma(graph)).toEqual([])
    })
  }

  test('the walk does see the generated client from a file that imports it', () => {
    expect(reachesPrisma(graphOf(resolve(ROOT, 'server/db.ts')))).not.toEqual([])
  })
})
