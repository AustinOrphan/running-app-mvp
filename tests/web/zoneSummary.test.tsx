import { render, screen } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import type { Boundary, ZoneSet } from '../../shared/engine/types.ts'
import { ZoneSummary } from '../../web/components/ZoneSummary.tsx'

const cs = (over: Partial<Boundary>): Boundary => ({
  value: 3.5,
  band: [3.4, 3.6],
  source: 'cs',
  asOf: '2026-11-09',
  ...over,
})

const zones = (csMps: Boundary): ZoneSet => ({
  hrMax: null,
  hrRest: null,
  lt1Hr: null,
  lt2Hr: null,
  csMps,
  lt1PaceSecPerKm: null,
  thresholdPaceSecPerKm: null,
  hr: null,
  pace: null,
  rpe: { z1: [1, 2], z2: [3, 4], z3: [5, 6] },
})

describe('ZoneSummary: a critical speed from training [A6]', () => {
  test('labels a boundary that needed efforts older than three months', () => {
    render(<ZoneSummary set={zones(cs({ fromTraining: true, windowWidened: true }))} units="km" />)
    expect(screen.getByText(/\(from training, some older than three months\), as of/)).toBeVisible()
  })

  test('labels a plain training boundary without the older-efforts words', () => {
    render(<ZoneSummary set={zones(cs({ fromTraining: true }))} units="km" />)
    expect(screen.getByText(/\(from training\), as of/)).toBeVisible()
    expect(screen.queryByText(/older than three months/)).not.toBeInTheDocument()
  })
})
