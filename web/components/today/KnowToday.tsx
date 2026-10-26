import { useState } from 'react'
import type { Units } from '../../../shared/types.ts'
import { rulesRef } from '../../api/explain.ts'
import { ExplainButton } from '../ExplainButton.tsx'
import { localiseEngineText } from '../engineText.ts'
import styles from './KnowToday.module.css'

/** Training in heat and heat warnings, spelled as the Param registry spells them. */
const HEAT_RULES = ['I7', 'I9']

/** The disclosure keeps its state on this device; the page works without it. */
const STORAGE_KEY = 'rl_today_more'

function readOpen(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

function writeOpen(open: boolean): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, open ? '1' : '0')
  } catch {
    // Storage can be blocked (a private window); the disclosure then forgets its state.
  }
}

export interface KnowTodayProps {
  /** Why readiness changed the day (empty on a day that is as planned). */
  reasons: string[]
  climbNote: string | null
  zonesNote: string | null
  heatNote: string | null
  units: Units
}

/**
 * "What to know today": the lines that qualify the session and need no space above the fold.
 * Closed by default, and it keeps the runner's last choice. Nothing renders when the day has no
 * such line.
 */
export function KnowToday({ reasons, climbNote, zonesNote, heatNote, units }: KnowTodayProps) {
  const [open, setOpen] = useState(readOpen)
  const lines = [...reasons, climbNote, zonesNote].filter((line): line is string => line !== null)
  if (lines.length === 0 && heatNote === null) return null

  return (
    <details
      className={styles.details}
      open={open}
      onToggle={(event) => {
        const next = event.currentTarget.open
        setOpen(next)
        writeOpen(next)
      }}
    >
      <summary className={styles.summary}>What to know today</summary>
      <div className={styles.body}>
        {heatNote === null ? null : (
          <div className={styles.line}>
            <p className={styles.text}>{localiseEngineText(heatNote, units)}</p>
            <ExplainButton
              subject="the heat note"
              rules={HEAT_RULES}
              explain={rulesRef(HEAT_RULES)}
              icon
            />
          </div>
        )}
        {lines.map((line) => (
          <p key={line} className={styles.text}>
            {localiseEngineText(line, units)}
          </p>
        ))}
      </div>
    </details>
  )
}
