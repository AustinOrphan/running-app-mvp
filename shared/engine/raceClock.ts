// A time of day on a race day (rule H14, ADR 0018), shared by the race plan and its splits. Pure.

const SEC_PER_MIN = 60
const MIN_PER_HOUR = 60
const MIN_PER_DAY = 1440

/** A time of day on a race day: `day` 0 is the race date, 1 the day after. */
export interface RaceClock {
  /** `HH:MM`. */
  time: string
  day: number
}

const pad2 = (n: number): string => String(n).padStart(2, '0')

/** The clock after `sec` seconds from a start at `startMin` minutes after midnight, to the minute. */
export function clockAt(startMin: number, sec: number): RaceClock {
  const total = startMin + Math.round(sec / SEC_PER_MIN)
  const day = Math.floor(total / MIN_PER_DAY)
  const within = total - day * MIN_PER_DAY
  return {
    time: `${pad2(Math.floor(within / MIN_PER_HOUR))}:${pad2(within % MIN_PER_HOUR)}`,
    day,
  }
}
