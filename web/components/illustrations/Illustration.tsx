import type { ReactElement } from 'react'
import styles from './Illustration.module.css'
import { useIllustrations } from './useIllustrations.ts'

/**
 * The drawings behind the Illustrations switch (visual design, section 5). Each is a few strokes of
 * `currentColor` (the muted text colour set by `.art`) plus, at most, one stroke in `--accent`: the
 * thing the page is waiting for. Drawn on a 160 by 120 sheet, round caps, no fill, no motion.
 */
export type ArtKey = 'runs' | 'plan' | 'offline' | 'load' | 'race' | 'trends' | 'strength' | 'paces'

const DOTS = '0.1 5.4'

/** The drawing's horizontal extent on the sheet, so it lines up with the text beside it. */
const SPAN: Record<ArtKey, readonly [number, number]> = {
  runs: [6, 154],
  plan: [20, 148],
  offline: [10, 150],
  load: [27, 143],
  race: [8, 152],
  trends: [22, 140],
  strength: [10, 150],
  paces: [34, 125],
}

const DRAWINGS: Record<ArtKey, ReactElement> = {
  // A ridge, the ground, and a dotted trail that starts at a ring and runs on without a run on it.
  runs: (
    <>
      <path d="M8 70 C26 52 40 50 56 62 C72 74 88 40 112 38 C132 36 146 50 152 58" />
      <circle cx="34" cy="26" r="8" />
      <path d="M10 112 H64 M72 112 H150" />
      <path
        className="accent"
        strokeDasharray={DOTS}
        d="M44 102 C72 102 50 90 76 88 C104 86 88 76 118 74"
      />
      <circle className="accent" cx="37" cy="102" r="4" />
    </>
  ),
  // A notebook page of two weeks in empty circles, a pencil across the corner, one ring marked.
  plan: (
    <>
      <rect x="22" y="16" width="88" height="92" rx="4" />
      <path d="M44 10 V22 M66 10 V22 M88 10 V22" />
      <path d="M22 38 H110" />
      <path
        d="M35 58 h0.1 M47 58 h0.1 M59 58 h0.1 M71 58 h0.1 M83 58 h0.1 M95 58 h0.1"
        strokeWidth="5"
      />
      <path d="M35 78 h0.1 M47 78 h0.1 M59 78 h0.1 M71 78 h0.1" strokeWidth="5" />
      <circle className="accent" cx="85" cy="78" r="6" strokeDasharray="2 3.2" />
      <path d="M120 106 L121 95.6 L139.1 52.8 L144.9 55.2 L126.8 98 Z M121 95.6 L126.8 98 M136 60.2 L141.8 62.6" />
    </>
  ),
  // Three arcs of signal and a dot, struck through where the connection should be.
  offline: (
    <>
      <path d="M65.9 77.9 A20 20 0 0 1 94.1 77.9" />
      <path d="M53.1 65.1 A38 38 0 0 1 106.9 65.1" />
      <path d="M40.4 52.4 A56 56 0 0 1 119.6 52.4" />
      <circle cx="80" cy="94" r="3.2" fill="currentColor" />
      <path d="M12 108 H64 M72 108 H148" />
      <path className="accent" d="M46 100 L114 30" />
    </>
  ),
  // A page with its corner turned and a line left unfinished, and the arrow that tries again.
  load: (
    <>
      <path d="M30 14 H80 L96 30 V106 H30 Z M80 14 V30 H96" />
      <path d="M42 46 H82 M42 58 H86 M42 70 H66 M42 84 H50 M57 84 H62" />
      <path className="accent" d="M122 68 A16 16 0 1 1 106 84" />
      <path className="accent" d="M101.5 89 L106 83.5 L110.5 89" />
    </>
  ),
  // A ridge with a pole on it and a pennant flying: the place a goal race goes.
  race: (
    <>
      <path d="M10 102 C32 102 50 78 82 78 C108 78 124 102 150 102" />
      <path d="M86 78 V24" />
      <path className="accent" d="M86 24 L120 34 L86 46" />
      <path d="M16 112 H70 M78 112 H144" />
      <path d="M52 102 l3 -6 m4 6 l-1 -5 M112 100 l-3 -6" />
    </>
  ),
  // Two axes and four open circles, a dotted line waiting to be drawn between them.
  trends: (
    <>
      <path d="M30 18 V98 H138" />
      <path d="M26 76 H30 M26 54 H30 M26 32 H30 M54 98 V102 M78 98 V102 M102 98 V102 M126 98 V102" />
      <circle cx="54" cy="78" r="4" />
      <circle cx="78" cy="66" r="4" />
      <circle cx="102" cy="72" r="4" />
      <circle cx="126" cy="48" r="4" />
      <path
        className="accent"
        strokeDasharray={DOTS}
        d="M59.4 75.3 L72.6 68.7 M83.8 67.5 L96.2 70.5 M106.2 67.8 L121.8 52.2"
      />
    </>
  ),
  // A barbell at rest on the floor; the inner plates are the ones to load.
  strength: (
    <>
      <path d="M20 68 H34 M51 68 H109 M126 68 H140" />
      <rect x="34" y="42" width="8" height="52" rx="3" />
      <rect x="118" y="42" width="8" height="52" rx="3" />
      <rect className="accent" x="44" y="50" width="7" height="36" rx="3" />
      <rect className="accent" x="109" y="50" width="7" height="36" rx="3" />
      <path d="M12 98 H70 M78 98 H148" />
    </>
  ),
  // A stopwatch whose hand is dotted in: nothing timed yet.
  paces: (
    <>
      <circle cx="80" cy="68" r="34" />
      <path d="M74 24 H86 M80 24 V34 M110 42 L116 36 M113 33 L119 39" />
      <path d="M80 38 V44 M80 92 V98 M50 68 H56 M104 68 H110" />
      <path className="accent" strokeDasharray={DOTS} d="M80 68 L96 48" />
      <circle cx="80" cy="68" r="2.6" fill="currentColor" />
      <path d="M44 112 H72 M80 112 H116" />
    </>
  ),
}

/** The drawing for `art` when the switch is on; nothing at all when it is off. */
export function Illustration({ art }: { art: ArtKey | undefined }) {
  const { on } = useIllustrations()
  if (!on || art === undefined) return null
  return (
    <svg
      className={styles.art}
      viewBox={`${String(SPAN[art][0])} 0 ${String(SPAN[art][1] - SPAN[art][0])} 120`}
      aria-hidden="true"
      focusable="false"
      data-art={art}
    >
      {DRAWINGS[art]}
    </svg>
  )
}
