// How the course climb (or descent) that the runner's rows do not name is shared out over the legs
// without a figure. One rule for both readers of the course points: the arrival ranges
// (`raceSplits.ts`, rule R1) and the silhouette under Today's countdown (`courseSilhouette.ts`).

/**
 * One figure per leg: the runner's own where the leg has one, else its share of what is left of the
 * course total after the entered legs, spread over the legs without a figure by distance, times
 * `share`. Nothing is spread without a course total above zero, or when the entered legs already
 * reach it, so those legs read 0.
 */
export function spreadOverUnentered(
  entered: ReadonlyArray<number | null>,
  legM: readonly number[],
  courseTotalM: number | null,
  share = 1,
): number[] {
  const known = courseTotalM !== null && courseTotalM > 0
  const enteredSum = entered.reduce<number>((sum, value) => sum + (value ?? 0), 0)
  const leftOver = known ? Math.max(0, courseTotalM - enteredSum) : 0
  const unenteredM = legM.reduce((sum, m, i) => sum + (entered[i] === null ? m : 0), 0)
  const spread = leftOver * share
  return entered.map((value, i) =>
    value !== null ? value : unenteredM > 0 ? (spread * (legM[i] ?? 0)) / unenteredM : 0,
  )
}
