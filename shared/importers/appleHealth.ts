// Stub from the data-foundation scaffold; Task D8 implements it.
import type { ParsedActivity, WellnessInput } from '../types.ts'

/** A workout found in pass one of the Apple Health export; pass two adds its heart rate. */
export interface AppleWorkout {
  providerKey: string
  startUtc: string
  endUtc: string
}

export interface AppleExportReducer {
  onOpenTag(name: string, attrs: Record<string, string>): void
  onCloseTag(name: string): void
  passOneResult(): { workouts: AppleWorkout[]; wellness: WellnessInput[] }
  startPassTwo(workouts: AppleWorkout[]): void
  passTwoResult(): ParsedActivity[]
}

/** An event-driven reducer fed by the SAX events of `export.xml`, in two passes. */
export function createAppleExportReducer(opts: { timezone: string }): AppleExportReducer {
  void opts
  throw new Error('not implemented')
}

/** Adds the altitude, distance and start location of a `workout-routes/*.gpx` to an activity. */
export function attachRoute(activity: ParsedActivity, gpxText: string): ParsedActivity {
  void gpxText
  void activity
  throw new Error('not implemented')
}
