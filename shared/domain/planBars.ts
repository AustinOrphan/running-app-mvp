// The geometry of the "against the plan" bars on the run page: how long the planned outline and
// the solid ran bar are, and where an overshoot starts. Pure, so the picture is tested without a
// browser. The bars carry no tick, no percentage and no verdict: targets are a sketch.

/** Fractions (0 to 1) of one bar's track, which is as long as the larger of the two figures. */
export interface PlanBarGeometry {
  /** The outline: the whole planned figure. */
  planned: number
  /** The solid bar: what was run, up to the planned figure. */
  ran: number
  /** The hatched part: what was run past the planned figure; null when nothing went past it. */
  overshoot: { from: number; to: number } | null
}

/** Null when either figure is not a positive finite number: there is nothing to set side by side. */
export function planBarGeometry(planned: number, ran: number): PlanBarGeometry | null {
  if (!(planned > 0) || !(ran > 0) || !Number.isFinite(planned + ran)) return null
  const track = Math.max(planned, ran)
  const plannedFraction = planned / track
  if (ran <= planned) return { planned: plannedFraction, ran: ran / track, overshoot: null }
  return {
    planned: plannedFraction,
    ran: plannedFraction,
    overshoot: { from: plannedFraction, to: 1 },
  }
}
