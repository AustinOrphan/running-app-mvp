import { useState } from 'react'
import { weekStripEstimateText } from '../../../shared/copy/distanceEstimate.ts'
import { overshootTodayLine } from '../../../shared/copy/overshoot.ts'
import { render } from '../../../shared/copy/template.ts'
import { renderFact, TEMPLATES } from '../../../shared/copy/templates.ts'
import type {
  PlanSessionView,
  Units,
  WeekStrip as WeekStripView,
  WeekStripDay,
} from '../../../shared/types.ts'
import { minutesToHours1 } from '../../../shared/units.ts'
import {
  loggedMin,
  plannedRestOfWeekMin,
  weekBars,
  type WeekBar,
} from '../../../shared/domain/weekStrip.ts'
import { formatWeekday } from '../format.ts'
import { Meter } from '../Meter.tsx'
import { SessionSheet } from '../SessionSheet.tsx'
import styles from './WeekStrip.module.css'

/** Kinds that sit beside the day's main session; a tap on the day opens the main one. */
const SUPPORTING = new Set<PlanSessionView['kind']>(['strength', 'mobility'])

function mainSession(sessions: readonly PlanSessionView[]): PlanSessionView | null {
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
  return loggedMin(day) > 0
    ? render(
        TEMPLATES['today.week.day-logged'],
        { ...when, logged: { kind: 'minutes', min: loggedMin(day) } },
        units,
      )
    : render(TEMPLATES['today.week.day'], when, units)
}

/** A bar's height as a share of the column, at least a hairline for any minutes at all. */
function barHeight(share: number): string {
  return share === 0 ? '0' : `max(${String(Math.round(share * 1000) / 10)}%, 3px)`
}

function DayFace({ day, bar, units }: { day: WeekStripDay; bar: WeekBar; units: Units }) {
  return (
    <>
      <span aria-hidden="true" className={styles.bars}>
        {bar.plannedMin > 0 ? (
          <span className={styles.planned} style={{ height: barHeight(bar.plannedShare) }} />
        ) : null}
        {bar.runMin > 0 ? (
          <span className={styles.run} style={{ height: barHeight(bar.runShare) }} />
        ) : null}
      </span>
      <span aria-hidden="true" className={styles.dayName}>
        {formatWeekday(day.date)}
      </span>
      <span aria-hidden="true" className={styles.mark} data-mark={day.mark} />
      <span aria-hidden="true" className={styles.minutes}>
        {loggedMin(day) > 0 ? String(loggedMin(day)) : ' '}
      </span>
      <span className="visually-hidden">{dayName(day, units)}</span>
    </>
  )
}

/** The figures behind the bars, for a screen reader: planned and logged minutes by day. */
function WeekBarsTable({
  bars,
  today,
  units,
}: {
  bars: readonly WeekBar[]
  today: string | null
  units: Units
}) {
  const say = (key: keyof typeof TEMPLATES, slots = {}) => render(TEMPLATES[key], slots, units)
  const minutes = (min: number) => say('today.week.cell-min', { min: { kind: 'minutes', min } })
  return (
    <div className="visually-hidden">
      <table>
        <caption>{say('today.week.table-caption')}</caption>
        <thead>
          <tr>
            <th scope="col">{say('today.week.col-day')}</th>
            <th scope="col">{say('today.week.col-planned')}</th>
            <th scope="col">{say('today.week.col-logged')}</th>
          </tr>
        </thead>
        <tbody>
          {bars.map((bar) => (
            <tr key={bar.date}>
              <th scope="row">
                {say(bar.date === today ? 'today.week.row-today' : 'today.week.row', {
                  weekday: { kind: 'weekday', iso: bar.date, style: 'long' },
                })}
              </th>
              <td>{minutes(bar.plannedMin)}</td>
              <td>{minutes(bar.runMin)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/**
 * The week at a glance: seven days, each a column of bars (the planned minutes as an outline, the run minutes
 * as a solid bar, both against the week's longest day; today's column is tinted and underlined),
 * a mark whose shape carries its meaning and a name for screen readers, the run time logged, and the week's hours against the target as
 * the sketch Meter. A day with sessions opens its sheet. The strip describes and never grades: a
 * past day with a run still to do reads "planned, no run logged".
 */
export function WeekStrip({
  strip,
  units,
  advisory = true,
}: {
  strip: WeekStripView
  units: Units
  /** False leaves out what reaching the target would take (`showWeekAdvisory`). */
  advisory?: boolean
}) {
  // The sheet is opened on the session as the strip holds it now, by id, so a read of Today that
  // changes the session (a log that settles it) changes the sheet too, as the Plan page's does.
  const [openId, setOpenId] = useState<string | null>(null)
  const open =
    openId === null
      ? null
      : (strip.days.flatMap((day) => day.sessions).find((s) => s.id === openId) ?? null)
  const empty = strip.days.every((d) => d.mark === 'free' && d.runMin === 0)
  if (empty && strip.targetRunMin === null) return null
  const plannedMin = plannedRestOfWeekMin(strip)
  const bars = weekBars(strip)
  // `?? null`: an answer the phone kept from before the estimate existed has no field.
  const weekEstimateM = strip.distanceEstimateM ?? null
  // A week run past its plan: the meter's tick is the planned figure and the caption says how far
  // the minutes run lie over it. An answer kept from before the field existed has no `overshoot`.
  const overshootLine =
    strip.targetRunMin !== null && (strip.overshoot ?? false)
      ? overshootTodayLine(strip.runMin, strip.targetRunMin)
      : null

  return (
    <section aria-label="This week" className={styles.week}>
      <ol className={styles.days}>
        {strip.days.map((day, index) => {
          const session = mainSession(day.sessions)
          const current = day.isToday ? 'date' : undefined
          return (
            <li key={day.date} className={styles.day}>
              {session === null ? (
                <div className={styles.cell} aria-current={current}>
                  <DayFace day={day} bar={bars[index]!} units={units} />
                </div>
              ) : (
                <button
                  type="button"
                  className={`${styles.cell} ${styles.tap}`}
                  aria-current={current}
                  onClick={() => {
                    setOpenId(session.id)
                  }}
                >
                  <DayFace day={day} bar={bars[index]!} units={units} />
                </button>
              )}
            </li>
          )
        })}
      </ol>
      <WeekBarsTable
        bars={bars}
        today={strip.days.find((d) => d.isToday)?.date ?? null}
        units={units}
      />
      {strip.targetRunMin === null ? (
        <p className={styles.caption}>{`${minutesToHours1(strip.runMin)} h run this week`}</p>
      ) : (
        <Meter
          valueMin={strip.runMin}
          targetMin={strip.targetRunMin}
          remainingMin={strip.remaining?.remainingMin ?? null}
          label="Run time this week"
          captionText={overshootLine ?? undefined}
        />
      )}
      {weekEstimateM === null ? null : (
        <p className={styles.caption}>{weekStripEstimateText(weekEstimateM, units)}</p>
      )}
      {!advisory || plannedMin === 0 ? null : (
        <p className={styles.caption}>
          {render(
            TEMPLATES['today.week.rest-planned'],
            { total: { kind: 'minutes', min: plannedMin } },
            units,
          )}
        </p>
      )}
      {open === null ? null : (
        <SessionSheet
          session={open}
          onClose={() => {
            setOpenId(null)
          }}
        />
      )}
    </section>
  )
}
