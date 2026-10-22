import { minutesToHours1 } from '../../shared/units.ts'
import styles from './Meter.module.css'

export interface MeterProps {
  valueMin: number
  targetMin: number
  label: string
}

type MeterState = 'under' | 'near' | 'over'

/** Under below 85% of the target, near from 85% up to it, over above it (review rules). */
function stateOf(valueMin: number, targetMin: number): MeterState {
  if (targetMin <= 0) return valueMin > 0 ? 'over' : 'under'
  if (valueMin > targetMin) return 'over'
  if (valueMin >= targetMin * 0.85) return 'near'
  return 'under'
}

function caption(state: MeterState, valueMin: number, targetMin: number): string {
  if (targetMin <= 0) return `${minutesToHours1(valueMin)} h, no target set`
  switch (state) {
    case 'under':
      return `${minutesToHours1(valueMin)} h of ${minutesToHours1(targetMin)} h target`
    case 'near':
      return `${minutesToHours1(targetMin - valueMin)} h to target`
    case 'over':
      return `${minutesToHours1(valueMin - targetMin)} h past target`
  }
}

function percent(part: number, whole: number): string {
  return `${String(Math.min(100, Math.max(0, (part / whole) * 100)))}%`
}

/**
 * The week's time against its target, drawn as a sketch: a dotted tick for the target, a soft
 * band for "near", and a hatched continuation past the tick. The state is also stated in words.
 */
export function Meter({ valueMin, targetMin, label }: MeterProps) {
  const value = Number.isFinite(valueMin) ? Math.max(0, valueMin) : 0
  const target = Number.isFinite(targetMin) ? Math.max(0, targetMin) : 0
  const state = stateOf(value, target)
  // The track always leaves room past the tick so an overshoot has somewhere to go.
  const scale = Math.max(target * 1.25, value, 1)

  return (
    <div className={styles.meter}>
      <div
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={Math.max(target, 1)}
        aria-valuenow={value}
        aria-valuetext={`${minutesToHours1(value)} of ${minutesToHours1(target)} hours`}
        data-state={state}
        className={styles.track}
      >
        {target > 0 ? (
          <span
            className={styles.band}
            style={{
              left: percent(target * 0.85, scale),
              width: percent(target * 0.15, scale),
            }}
          />
        ) : null}
        <span
          className={styles.fill}
          style={{ width: percent(Math.min(value, target > 0 ? target : value), scale) }}
        />
        {state === 'over' && target > 0 ? (
          <span
            className={styles.over}
            style={{ left: percent(target, scale), width: percent(value - target, scale) }}
          />
        ) : null}
        {target > 0 ? (
          <span className={styles.tick} style={{ left: percent(target, scale) }} />
        ) : null}
      </div>
      <p className={styles.caption}>{caption(state, value, target)}</p>
    </div>
  )
}
