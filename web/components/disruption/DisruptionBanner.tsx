import { useState, type ReactNode } from 'react'
import { betterWords, windowBannerLine } from '../../../shared/copy/windowView.ts'
import { addDays } from '../../../shared/dates.ts'
import type { DisruptionView, Units } from '../../../shared/types.ts'
import { Button } from '../Button.tsx'
import { WindowActionSheet } from '../lazySheets.tsx'
import type { WindowAction } from './WindowActionSheet.tsx'
import styles from './disruption.module.css'

/** What the banner's buttons ask for. */
export type BannerAction = 'better' | 'extend' | 'remove'

export interface DisruptionBannerProps {
  /** A window that is not over, as `GET /api/plan/disruptions` and Today serve it for the day. */
  window: DisruptionView
  /** The server's local day (`TodayView.date`); the banner never reads the device clock. */
  today: string
  units: Units
  /** Called with the button the runner pressed. The caller opens the sheet (`DisruptionBanners`). */
  onAction: (action: BannerAction) => void
  /**
   * The form that fits Today's `disruption` slot: 64 px at 360 px (`slots.ts`). The sentence is
   * clamped to two lines and the buttons are small; the words, the buttons and what they do are
   * the Plan page's. Every button opens a preview first, so a small one costs a look, not a change.
   */
  compact?: boolean
}

/**
 * A window in force, in one line for the phase it is in today ("Resting for illness until Fri 24
 * Oct.", "One symptom-free day first, then easy running from Sun 26 Oct.", "Return week: up to 240
 * min."), with the three things a runner does to it: say they are better (or back), extend it, or
 * remove it. A window that is over renders nothing. The same banner serves the Plan page and
 * Today's `disruption` slot (`compact`).
 */
export function DisruptionBanner({
  window,
  today,
  units,
  onAction,
  compact = false,
}: DisruptionBannerProps) {
  const line = windowBannerLine(window, units)
  if (line === '') return null

  // The window can end yesterday only while it is running and yesterday is not before its start.
  const yesterday = addDays(today, -1)
  const canEndEarly =
    (window.phase === 'resting' || window.phase === 'limited') &&
    yesterday >= window.startDate &&
    yesterday < window.endDate
  // The sheet this button opens is titled with the same words (`betterWords`).
  const better = betterWords(window.reason, units).title

  return (
    <section
      aria-label="Rest window"
      className={compact ? `${styles.banner} ${styles.compact}` : styles.banner}
      data-phase={window.phase}
    >
      <p className={styles.bannerLine}>{line}</p>
      <div className={styles.bannerActions}>
        {canEndEarly ? (
          <Button
            variant="quiet"
            className={compact ? styles.compactAction : undefined}
            onClick={() => {
              onAction('better')
            }}
          >
            {better}
          </Button>
        ) : null}
        <Button
          variant="quiet"
          className={compact ? styles.compactAction : undefined}
          onClick={() => {
            onAction('extend')
          }}
        >
          Extend
        </Button>
        <Button
          variant="quiet"
          className={compact ? styles.compactAction : undefined}
          onClick={() => {
            onAction('remove')
          }}
        >
          Remove window
        </Button>
      </div>
    </section>
  )
}

export interface DisruptionBannersProps {
  /** The windows to show; one that is over renders nothing. */
  windows: readonly DisruptionView[]
  today: string
  units: Units
  /** The form for Today's slot (`DisruptionBannerProps.compact`). */
  compact?: boolean
  /**
   * Wraps the banners, and only the banners: the sheet stays outside it. Today's slot gives the
   * frame that takes no height while there are none, so a window that is removed leaves nothing
   * behind and its sheet still stays.
   */
  frame?: (banners: ReactNode) => ReactNode
}

/**
 * One banner for each window, and the sheet that previews what a button on one of them would do.
 * The sheet belongs here, not to the banner: removing a window takes its banner away, and the
 * sheet has to stay to show what was removed and to offer the undo. A caller keeps this mounted
 * when its list of windows becomes empty (render it with `windows={[]}`), or the sheet goes too.
 */
export function DisruptionBanners({
  windows,
  today,
  units,
  compact = false,
  frame,
}: DisruptionBannersProps) {
  const [sheet, setSheet] = useState<WindowAction | null>(null)
  // A list, not a fragment: a frame that asks whether it has content sees an empty list as none.
  const banners = windows.map((window) => (
    <DisruptionBanner
      key={window.id}
      window={window}
      today={today}
      units={units}
      compact={compact}
      onAction={(action) => {
        setSheet(
          action === 'remove'
            ? { kind: 'remove', windowId: window.id }
            : { kind: action, window, today },
        )
      }}
    />
  ))
  return (
    <>
      {frame === undefined ? banners : frame(banners)}
      {sheet !== null ? (
        <WindowActionSheet
          {...sheet}
          onClose={() => {
            setSheet(null)
          }}
        />
      ) : null}
    </>
  )
}
