import { useId, useState } from 'react'
import { DIFF_LINES_SHOWN } from '../../../shared/copy/limits.ts'
import {
  describeEntry,
  diffListLabel,
  emptyDiffText,
  showAllText,
  showFewerText,
} from '../../../shared/copy/revisionView.ts'
import { presentDiff } from '../../../shared/engine/revisionDiff.ts'
import type { PlanDiff, Units } from '../../../shared/types.ts'
import { Button } from '../Button.tsx'
import styles from './PlanDiffView.module.css'

export interface PlanDiffViewProps {
  diff: PlanDiff
  units: Units
  /** The name of the list for assistive technology; the default says "Changes in this update". */
  label?: string
  /** A muted sentence under a row, by the key `presentDiff` gives the row (its cause). */
  notes?: ReadonlyMap<string, string>
  /** Rows shown before "Show all {n} changes". */
  limit?: number
}

/**
 * What a write did to the plan, as rows: each week as running time before and after, each session
 * as from and to, a session on another day as moved, five rows and then "Show all {n} changes". The
 * rows come from the stored diff through the templates in the runner's units; nothing is worked
 * out here. The same view shows an applied revision and the restore diff of an undo preview.
 */
export function PlanDiffView({
  diff,
  units,
  label,
  notes,
  limit = DIFF_LINES_SHOWN,
}: PlanDiffViewProps) {
  const listId = useId()
  const [all, setAll] = useState(false)
  const entries = presentDiff(diff)
  if (entries.length === 0) return <p className={styles.empty}>{emptyDiffText(units)}</p>

  const shown = all ? entries : entries.slice(0, limit)
  return (
    <div className={styles.view}>
      <ul id={listId} className={styles.list} aria-label={label ?? diffListLabel(units)}>
        {shown.map((entry) => {
          const note = notes?.get(entry.key)
          return (
            <li key={entry.key} className={styles.row} data-entry={entry.type}>
              <span className={styles.line}>{describeEntry(entry, units)}</span>
              {note === undefined ? null : <span className={styles.note}>{note}</span>}
            </li>
          )
        })}
      </ul>
      {entries.length > limit ? (
        <Button
          variant="quiet"
          aria-expanded={all}
          aria-controls={listId}
          onClick={() => {
            setAll(!all)
          }}
        >
          {all ? showFewerText(units) : showAllText(entries.length, units)}
        </Button>
      ) : null}
    </div>
  )
}
