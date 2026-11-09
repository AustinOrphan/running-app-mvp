import type { RouteGlyph as RouteGlyphData } from '../../shared/types.ts'
import styles from './RouteGlyph.module.css'

/**
 * The shape of a run's route as a small line drawing, for a list row. Decoration only: the row's
 * text carries the meaning, so it is hidden from assistive technology. A thin accent stroke with
 * round joins, no fill and no background; the path is fitted in a 100 x 100 box by `routeGlyph`
 * (north up, equal scale), so the box is the same for every run and a page of them reads as a set.
 */
export function RouteGlyph({ glyph, className }: { glyph: RouteGlyphData; className?: string }) {
  return (
    <svg
      className={className === undefined ? styles.glyph : `${styles.glyph} ${className}`}
      viewBox="-2 -2 104 104"
      aria-hidden="true"
      focusable="false"
    >
      <path d={glyph.d} />
    </svg>
  )
}
