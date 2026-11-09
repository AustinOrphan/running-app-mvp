import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import { fuelTargetFor, replayLadder } from '../../../shared/engine/fuel.ts'
import type { FuelContext } from '../../../shared/engine/fuel.ts'

/**
 * The race plan is derived on read and delivered nowhere (rule H14, ADR 0008 and ADR 0018): the
 * watch files, the intervals.icu events, the calendar feed and the weekly brief never import it,
 * and its sentences never reach `buildDeliverables`. The pieces that read it are the race service,
 * its route, the Today slot, the Race page, the More row and the race blocks of the web.
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

const ENGINE_ALLOWED = [
  // the engine module itself is imported by the copy, the server and the web that show it
  'server/services/racePlan.ts',
  'shared/copy/racePlan.ts',
  'shared/domain/raceProfile.ts',
  'shared/types.ts',
  'web/components/race/CheckpointSheet.tsx',
  'web/components/race/CheckpointTable.tsx',
  'web/components/race/RaceCard.tsx',
  'web/components/race/RaceSlot.tsx',
  'web/pages/RacePage.tsx',
]

const COPY_ALLOWED = [
  'shared/copy/templates.ts',
  'web/components/charts/CourseProfileChart.tsx',
  'web/components/charts/RaceProfileChart.tsx',
  'web/components/race/CheckpointSheet.tsx',
  'web/components/race/CheckpointTable.tsx',
  'web/components/race/CourseImportButton.tsx',
  'web/components/race/RaceBlocks.tsx',
  'web/components/race/RaceCard.tsx',
  'web/components/race/RaceSessionSection.tsx',
  'web/components/race/RaceSlot.tsx',
  'web/components/race/courseImport.ts',
  'web/pages/RacePage.tsx',
]

describe('who reads the race plan', () => {
  test('only the race service, the copy, the shared types and the race pieces of the web import the engine module', () => {
    expect(importers('shared/engine/racePlan.ts')).toEqual(ENGINE_ALLOWED)
  })

  test('only the template registry and the race pieces of the web import the race copy', () => {
    expect(importers('shared/copy/racePlan.ts')).toEqual(COPY_ALLOWED)
  })

  test('only the Today slot table, Today, the route and the app read the race service', () => {
    expect(importers('server/services/racePlan.ts')).toEqual([
      'server/routes/race.ts',
      'server/services/today.ts',
      'server/services/todaySlots.ts',
    ])
  })

  test('only the race plan, its copy and the shared types import the splits module', () => {
    expect(importers('shared/engine/raceSplits.ts')).toEqual([
      'shared/copy/racePlan.ts',
      'shared/engine/racePlan.ts',
      'shared/types.ts',
    ])
  })

  test('only the race service and its route read the checkpoint service, and only it touches the table', () => {
    expect(importers('server/services/raceCheckpoints.ts')).toEqual([
      'server/routes/race.ts',
      'server/services/racePlan.ts',
    ])
    const touching = FILES.filter(
      (file) =>
        file.startsWith('server/') &&
        /\.raceCheckpoint\b|\$queryRaw[^;]*RaceCheckpoint/.test(
          readFileSync(join(ROOT, file), 'utf8'),
        ),
    )
    // The full-data export hands the runner their own checkpoints; it reads the table and nothing else does.
    expect(touching).toEqual([
      'server/services/exportArchive.ts',
      'server/services/raceCheckpoints.ts',
    ])
  })

  test('nothing that delivers a session, a feed or a brief imports the plan or its copy', () => {
    const delivery = FILES.filter((file) =>
      /^(server\/providers\/|shared\/workouts\/|server\/services\/(workouts|workoutFit|publish|calendar|ics|wristItems|brief|fuelLine)\.ts$|shared\/copy\/(publish|workouts|brief\w*)\.ts$|shared\/engine\/brief\.ts$)/.test(
        file,
      ),
    )
    expect(delivery.length).toBeGreaterThan(8)
    const offences = delivery.filter((file) =>
      /racePlan|raceSplits|raceCheckpoint|RaceCheckpoint|race\.plan\.|courseSilhouette|loadRaceCourse|race\.course/.test(
        readFileSync(join(ROOT, file), 'utf8'),
      ),
    )
    expect(offences).toEqual([])
  })

  test('the race templates are named only where they are written and where a page shows them', () => {
    const named = FILES.filter((file) =>
      readFileSync(join(ROOT, file), 'utf8').includes("'race.plan."),
    ).sort()
    expect(named).toEqual(['shared/copy/racePlan.ts', 'web/components/destinations.tsx'])
  })
})

describe('the race session keeps its own fuel slot', () => {
  const ladder = replayLadder({
    settings: { optIn90: true, optInAdvanced: true, giDisease: false },
    runs: [],
    gutTrainingWeeks: [],
  })
  const ctx: FuelContext = {
    settings: { optIn90: true, optInAdvanced: true, giDisease: false },
    ladder,
    peaks: {},
  }

  test('a race session still has no fuel target: the fuel slot, the watch and the feed are unchanged', () => {
    const target = fuelTargetFor(ctx, {
      id: 'race-1',
      date: '2026-06-13',
      kind: 'race',
      durationMin: 1800,
      flags: [],
      status: 'planned',
    })
    expect(target).toBeNull()
  })
})
