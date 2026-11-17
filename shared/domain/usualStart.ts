// The place a runner usually starts a run (PL1, ADR 0024): the most common 0.01-degree cell (about
// 1 km) among the first recorded positions of their runs. Pure; the server reads the positions and
// only the rounded cell and the counts leave it.

export interface RunStart {
  lat: number
  lng: number
  /** The run's local day, `YYYY-MM-DD`; the most recent run breaks a tie between cells. */
  date: string
}

export interface UsualStart {
  /** The cell's coordinates, rounded to 0.01 degrees. */
  lat: number
  lng: number
  /** Runs that started in the cell. */
  runs: number
  /** Runs with a track that were counted. */
  of: number
}

/** Days of runs the usual start looks at. */
export const USUAL_START_DAYS = 365

/** A coordinate rounded to 0.01 degrees; never `-0`. */
export function roundToCell(value: number): number {
  const rounded = Math.round(value * 100) / 100
  return rounded === 0 ? 0 : rounded
}

/** Longitudes of an unwrapped track (past +-180) brought back into -180..180. */
function wrapLng(lng: number): number {
  return ((((lng + 180) % 360) + 360) % 360) - 180
}

/**
 * The most common cell among `starts`, or null when there are none. A tie goes to the cell with the
 * most recent run (the later date; two cells whose latest run is the same day go to the one with
 * the lower latitude, then the lower longitude, so the answer never depends on input order).
 */
export function usualStart(starts: ReadonlyArray<RunStart>): UsualStart | null {
  if (starts.length === 0) return null
  const cells = new Map<string, { lat: number; lng: number; runs: number; latest: string }>()
  for (const start of starts) {
    const lat = roundToCell(start.lat)
    const lng = roundToCell(wrapLng(start.lng))
    const key = `${lat.toFixed(2)},${lng.toFixed(2)}`
    const cell = cells.get(key)
    if (cell) {
      cell.runs += 1
      if (start.date > cell.latest) cell.latest = start.date
    } else {
      cells.set(key, { lat, lng, runs: 1, latest: start.date })
    }
  }
  let best: { lat: number; lng: number; runs: number; latest: string } | null = null
  for (const cell of cells.values()) {
    if (
      best === null ||
      cell.runs > best.runs ||
      (cell.runs === best.runs &&
        (cell.latest > best.latest ||
          (cell.latest === best.latest &&
            (cell.lat < best.lat || (cell.lat === best.lat && cell.lng < best.lng)))))
    ) {
      best = cell
    }
  }
  return { lat: best!.lat, lng: best!.lng, runs: best!.runs, of: starts.length }
}
