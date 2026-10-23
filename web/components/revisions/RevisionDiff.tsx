import {
  causeSentence,
  diffListLabel,
  newMarker,
  reasonLabel,
} from '../../../shared/copy/revisionView.ts'
import { todayIso } from '../../../shared/dates.ts'
import { entryCauses, presentDiff } from '../../../shared/engine/revisionDiff.ts'
import type { PlanRevisionView, Units } from '../../../shared/types.ts'
import { Button } from '../Button.tsx'
import { RemoveWindowInstead, windowToRemoveInstead } from '../disruption/RemoveWindowInstead.tsx'
import { localiseEngineText } from '../engineText.ts'
import { formatShortDate } from '../format.ts'
import { describeChange } from '../planChanges.ts'
import { PlanDiffView } from './PlanDiffView.tsx'
import styles from './RevisionDiff.module.css'
import { UndoControl } from './UndoControl.tsx'

export interface RevisionDiffProps {
  revision: PlanRevisionView
  units: Units
  /**
   * Opens the why drawer for the rules behind the revision. The page owns the drawer; without this
   * there is no Why control.
   */
  onWhy?: (rules: string[]) => void
  /**
   * Whether to show the "New" marker. Defaults to the revision's own marker (`seenAt` is null); a
   * surface that stamps the revision when it opens passes the state from before it did.
   */
  isNew?: boolean
}

/** Rules shown in the why drawer: those of the engine's week changes, and the weekly decision's. */
function rulesOf(revision: PlanRevisionView): string[] {
  const rules = revision.changes.flatMap((change) => change.rules)
  if (revision.decision !== null) rules.push('J5')
  return [...new Set(rules)]
}

/** The most causes named for a row or a revision. */
const CAUSES_SHOWN = 2

/**
 * One revision of the plan, the same everywhere it is shown (Plan page, Review after save, Today's
 * change sheet, the weekly brief): what made it and when, its stored summary, why each change is
 * there, the changes as from and to in the runner's units, a Why, and the undo with its preview.
 * A rest window whose undo is refused because the plan changed since offers "Remove this rest
 * window instead".
 *
 * A revision that every row explains the same way says so once above the rows; one whose rows have
 * different causes names the cause under each row. A revision from before the revision model has no
 * diff and shows its week-level changes the way they were stored.
 */
export function RevisionDiff({ revision, units, onWhy, isNew }: RevisionDiffProps) {
  const rules = rulesOf(revision)
  const marked = isNew ?? revision.seenAt === null
  const { diff } = revision
  // A rest window whose undo is refused because the plan changed since can still be removed.
  const windowId = windowToRemoveInstead(revision)

  let shared: string | null = null
  let notes: Map<string, string> | undefined
  if (diff !== null && !diff.empty) {
    const rows = presentDiff(diff).map((entry) => ({
      key: entry.key,
      causes: entryCauses(entry, revision.causes).slice(0, CAUSES_SHOWN),
    }))
    const explained = rows.filter((row) => row.causes.length > 0)
    const kinds = new Set(explained.map((row) => row.causes.join('|')))
    const first = explained[0]
    if (first !== undefined && kinds.size === 1) {
      shared = first.causes.map((cause) => causeSentence(cause, units)).join(' ')
    } else if (explained.length > 0) {
      notes = new Map(
        explained.map((row) => [
          row.key,
          row.causes.map((cause) => causeSentence(cause, units)).join(' '),
        ]),
      )
    }
  }

  return (
    <div className={styles.revision} data-revision={revision.id}>
      <p className={styles.head}>
        <strong>{reasonLabel(revision.reason, units)}</strong>{' '}
        <span className={styles.muted}>
          {formatShortDate(todayIso(new Date(revision.createdAt)))}
        </span>
        {marked ? <span className={styles.marker}>{newMarker(units)}</span> : null}
      </p>
      <p className={styles.summary}>{localiseEngineText(revision.summary, units)}</p>
      {shared !== null ? <p className={styles.cause}>{shared}</p> : null}
      {diff !== null && !diff.empty ? (
        <PlanDiffView diff={diff} units={units} notes={notes} />
      ) : null}
      {diff === null && revision.changes.length > 0 ? (
        <ul className={styles.legacy} aria-label={diffListLabel(units)}>
          {revision.changes.map((change, index) => (
            <li key={`${change.weekStart}-${change.field}-${String(index)}`}>
              Week of {formatShortDate(change.weekStart)}: {describeChange(change, units).text}
            </li>
          ))}
        </ul>
      ) : null}
      {onWhy !== undefined && rules.length > 0 ? (
        <Button
          variant="quiet"
          aria-label="Why this update"
          onClick={() => {
            onWhy(rules)
          }}
        >
          Why
        </Button>
      ) : null}
      <UndoControl revision={revision} units={units} />
      {windowId !== null ? <RemoveWindowInstead windowId={windowId} units={units} /> : null}
    </div>
  )
}
