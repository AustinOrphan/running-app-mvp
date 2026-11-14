import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

/**
 * The hour-by-hour read-out of the long runs is display only (rules T1 and A7, batch DR1, ADR 0005):
 * no engine module reads it, and only the Trends service that builds it, the shared types of the
 * payload and the panel that draws it import the module.
 */

const ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const SCANNED = ['server', 'shared', 'web']

function sourceFiles(dir: string): string[] {
  return readdirSync(join(ROOT, dir), { recursive: true, encoding: 'utf8' })
    .filter((path) => /\.(ts|tsx)$/.test(path))
    .map((path) => `${dir}/${path}`)
}

const FILES = SCANNED.flatMap(sourceFiles)

/** The files that import (or re-export from) the module at `target`, found by resolving each path. */
function importers(target: string): string[] {
  const wanted = resolve(ROOT, target)
  return FILES.filter((file) => {
    const text = readFileSync(join(ROOT, file), 'utf8')
    return [...text.matchAll(/\bfrom\s+['"](\.[^'"]*)['"]/g)].some(
      (match) => resolve(ROOT, dirname(file), match[1]!) === wanted,
    )
  }).sort()
}

describe('who reads the hour-by-hour read-out', () => {
  const importing = importers('shared/domain/durabilityByHour.ts')

  test('nothing in shared/engine imports it', () => {
    expect(importing.filter((file) => file.startsWith('shared/engine/'))).toEqual([])
  })

  test('only the Trends service, its route, the web hook and the panel import it', () => {
    expect(importing).toEqual([
      'server/routes/trendsDurability.ts',
      'server/services/trendsDurability.ts',
      'web/api/trends.ts',
      'web/components/trends/DurabilityPanel.tsx',
    ])
  })

  test('no scheduler, plan, publish or brief module reads the route or the service', () => {
    const readers = importers('server/services/trendsDurability.ts').concat(
      importers('server/routes/trendsDurability.ts'),
    )
    expect(readers.sort()).toEqual(['server/app.ts', 'server/routes/trendsDurability.ts'])
  })
})
