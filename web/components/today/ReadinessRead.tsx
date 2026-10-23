import type { ReactNode } from 'react'
import { renderFact } from '../../../shared/copy/templates.ts'
import type { ReadinessSignal, ReadinessVerdict, Units } from '../../../shared/types.ts'
import styles from './ReadinessRead.module.css'

export interface ReadinessReadProps {
  /** Null for a preview of a day ahead, which has no readiness read. */
  verdict: ReadinessVerdict | null
  /** At most three readings, those the verdict leans on first. */
  signals: ReadinessSignal[]
  units: Units
  /** The check-in under the signals (E2-6). */
  children?: ReactNode
}

/**
 * The readiness read: one line on what readiness means for today (a live region, so a change
 * after a check-in is announced) and the few readings behind it. Readiness never adds load, so no
 * verdict asks for more than the plan holds. A reading the verdict leans on is set in heavier
 * type and listed first; nothing is told by colour alone.
 */
export function ReadinessRead({ verdict, signals, units, children }: ReadinessReadProps) {
  if (verdict === null && signals.length === 0 && children === undefined) return null
  return (
    <section aria-label="Readiness" className={styles.read}>
      {verdict === null ? null : (
        <p role="status" className={styles.verdict}>
          {renderFact(verdict, units)}
        </p>
      )}
      {signals.length === 0 ? null : (
        <ul className={styles.signals} aria-label="Readiness signals">
          {signals.map((signal) => (
            <li
              key={signal.code}
              className={styles.signal}
              data-noted={signal.noted ? 'true' : undefined}
            >
              {renderFact(signal, units)}
            </li>
          ))}
        </ul>
      )}
      {children}
    </section>
  )
}
