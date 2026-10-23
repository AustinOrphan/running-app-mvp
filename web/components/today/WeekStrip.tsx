import { useState } from 'react'
import { render } from '../../../shared/copy/template.ts'
import { renderFact, TEMPLATES } from '../../../shared/copy/templates.ts'
import type {
  PlanSession,
  Units,
  WeekStrip as WeekStripView,
  WeekStripDay,
} from '../../../shared/types.ts'
import { minutesToHours1 } from '../../../shared/units.ts'
import { formatWeekday } from '../format.ts'
import { Meter } from '../Meter.tsx'
import { SessionSheet } from '../SessionSheet.tsx'
import styles from './WeekStrip.module.css'

/** Kinds that sit beside the day's main session; a tap on the day opens the main one. */
const SUPPORTING = new Set<PlanSession['kind']>(['strength', 'mobility'])

function mainSession(sessions: readonly PlanSession[]): PlanSession | null {
  return sessions.find((s) => !SUPPORTING.has(s.kind)) ?? sessions[0] ?? null
}

/** "Monday 16 Mar, Done, 45 min logged": the name a screen reader gives the day. */
function dayName(day: WeekStripDay, units: Units): string {
  const mark = renderFact({ template: `today.week.${day.mark}`, slots: {} }, units)
  const when = {
    weekday: { kind: 'weekday', iso: day.date, style: 'long' },
    date: { kind: 'date', iso: day.date, style: 'short' },
    mark,
  } as const
  return day.runMin > 0
    ? render(
        TEMPLATES['today.week.day-logged'],
        { ...when, logged: { kind: 'minutes', min: day.runMin } },
        units,
      )
    : render(TEMPLATES['today.week.day'], when, units)
}

function DayFace({ day, units }: { day: WeekStripDay; units: Units }) {
  return (
    <>
      <span aria-hidden="true" className={styles.dayName}>
        {formatWeekday(day.date)}
      </span>
      <span aria-hidden="true" className={styles.mark} data-mark={day.mark} />
      <span aria-hidden="true" className={styles.minutes}>
        {day.runMin > 0 ? String(day.runMin) : ' '}
      </span>
      <span className="visually-hidden">{dayName(day, units)}</span>
    </>
  )
}

/**
 * The week at a glance: seven days, each with a mark whose shape carries its meaning and a name
 * for screen readers, the run time logged under it, and the week's hours against the target as
 * the sketch Meter. A day with sessions opens its sheet. The strip describes and never grades: a
 * past day with a run still to do reads "planned, no run logged".
 */
export function WeekStrip({ strip, units }: { strip: WeekStripView; units: Units }) {
  const [open, setOpen] = useState<PlanSession | null>(null)
  const empty = strip.days.every((d) => d.mark === 'free' && d.runMin === 0)
  if (empty && strip.targetRunMin === null) return null
  const advice = strip.remaining

  return (
    <section aria-label="This week" className={styles.week}>
      <ol className={styles.days}>
        {strip.days.map((day) => {
          const session = mainSession(day.sessions)
          const current = day.isToday ? 'date' : undefined
          return (
            <li key={day.date} className={styles.day}>
              {session === null ? (
                <div className={styles.cell} aria-current={current}>
                  <DayFace day={day} units={units} />
                </div>
              ) : (
                <button
                  type="button"
                  className={`${styles.cell} ${styles.tap}`}
                  aria-current={current}
                  onClick={() => {
                    setOpen(session)
                  }}
                >
                  <DayFace day={day} units={units} />
                </button>
              )}
            </li>
          )
        })}
      </ol>
      {strip.targetRunMin === null ? (
        <p className={styles.caption}>{`${minutesToHours1(strip.runMin)} h run this week`}</p>
      ) : (
        <Meter valueMin={strip.runMin} targetMin={strip.targetRunMin} label="Run time this week" />
      )}
      {advice === null || advice.perDayMin === null ? null : (
        <p className={styles.advisory}>
          <span className={styles.advisoryLine}>
            {advice.remainingMin === 0
              ? render(TEMPLATES['today.week.nothing-left'], {}, units)
              : render(
                  TEMPLATES['today.week.advisory'],
                  { perDay: { kind: 'minutes', min: advice.perDayMin } },
                  units,
                )}
          </span>{' '}
          <span className={styles.caption}>
            {render(TEMPLATES['today.week.advisory-caption'], {}, units)}
          </span>
        </p>
      )}
      {open === null ? null : (
        <SessionSheet
          session={open}
          onClose={() => {
            setOpen(null)
          }}
        />
      )}
    </section>
  )
}
