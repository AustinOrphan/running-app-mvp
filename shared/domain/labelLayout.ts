// Where the labels along the top of the race profile go so that none covers another. Pure: the
// caller measures nothing, it passes each label's centre and width in pixels.

export interface LabelSpec {
  /** The label's centre, pixels from the plot's left edge. */
  x: number
  /** The label's width in pixels. */
  width: number
}

export interface PlacedLabel {
  /** The index in the list that was passed. */
  index: number
  /** Which line of labels: 0 is the nearest to the plot. */
  row: number
  /** The left edge in pixels, kept inside the plot. */
  left: number
}

/** An estimate of a text's width: the profile's labels are short names in one small face. */
export function textWidth(text: string, fontPx: number): number {
  return Math.ceil(text.length * fontPx * 0.6)
}

/**
 * Places labels left to right. Each takes the first of `rows` lines where it clears the one before
 * it by `gap` pixels, and is dropped when it clears none, so a crowded course shows fewer names
 * rather than names on top of each other. A label is shifted to stay inside `[0, plotWidth]`.
 * Labels are placed in the order given: the caller lists them by distance.
 */
export function placeLabels(
  labels: readonly LabelSpec[],
  plotWidth: number,
  options: { rows: number; gap: number },
): PlacedLabel[] {
  const rightEdge: number[] = Array.from({ length: options.rows }, () => -Infinity)
  const placed: PlacedLabel[] = []
  labels.forEach((label, index) => {
    if (label.width > plotWidth) return
    const left = Math.min(Math.max(label.x - label.width / 2, 0), plotWidth - label.width)
    const row = rightEdge.findIndex((edge) => left >= edge + options.gap)
    if (row < 0) return
    rightEdge[row] = left + label.width
    placed.push({ index, row, left })
  })
  return placed
}
