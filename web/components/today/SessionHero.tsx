import { Fragment, useEffect, useId, useRef, useState } from 'react'
import { formatQuantity } from '../../../shared/copy/quantity.ts'
import { sessionStatusLabel } from '../../../shared/copy/sessionStatus.ts'
import { render } from '../../../shared/copy/template.ts'
import { TEMPLATES } from '../../../shared/copy/templates.ts'
import { isToRun } from '../../../shared/domain/sessionStatus.ts'
import type { PlanSession, TodayHeat, TodayHero, Units } from '../../../shared/types.ts'
import { formatDistance } from '../../../shared/units.ts'
import { WhyDrawer } from '../WhyDrawer.tsx'
import { CoolerStart } from './CoolerStart.tsx'
import { DoneSheet, NotFullSheet } from '../lazySheets.tsx'
import { KnowToday } from './KnowToday.tsx'
import { NotFullEntry } from './NotFullEntry.tsx'
import { NotTodaySheet } from './NotTodaySheet.tsx'
import { SessionActions } from './SessionActions.tsx'
import styles from './SessionHero.module.css'
import { SessionTargets } from './SessionTargets.tsx'
import { TodaySlot } from './TodaySlot.tsx'

const minutes = (min: number) => ({ kind: 'minutes', min }) as const

/** "Next: Thu 22 Oct, Long run, 1 h 30 min", or nothing when no session is planned after today. */
function nextLine(next: PlanSession | null, units: Units): string | null {
  if (next === null) return null
  return render(
    TEMPLATES['today.hero.next'],
    {
      date: { kind: 'date', iso: next.date, style: 'weekday' },
      title: next.title,
      duration: minutes(next.durationMin),
    },
    units,
  )
}

/** The run that was logged against the session, in a sentence. */
function loggedLine(run: NonNullable<TodayHero['linkedRun']>, units: Units): string {
  const duration = { kind: 'duration', sec: run.durationSec } as const
  return run.distanceM === null
    ? render(TEMPLATES['today.hero.logged-time'], { duration }, units)
    : render(
        TEMPLATES['today.hero.logged'],
        { distance: formatDistance(run.distanceM, units), duration },
        units,
      )
}

/** What a day with no session says, and the next session when there is one. */
export function NoSession({ next, units }: { next: PlanSession | null; units: Units }) {
  const line = nextLine(next, units)
  return (
    <section aria-label="Today's session" className={styles.empty}>
      <p className={styles.emptyLine}>
        {render(TEMPLATES['today.hero.nothing-planned'], {}, units)}
      </p>
      {line === null ? null : <p className={styles.muted}>{line}</p>}
    </section>
  )
}

export interface SessionHeroProps {
  hero: TodayHero
  heat: TodayHeat
  /** The next session after today, shown once today's is settled or is a rest day. */
  next: PlanSession | null
  units: Units
  /**
   * The session is of a day that is over (the phone's copy of an earlier day): Done and Not today
   * are not offered, because they would act on that day. Explain still is.
   */
  readOnly?: boolean
}

/**
 * Today's session as the page's hero: its title, the duration as the display figure, the targets
 * to run by, the cooler start, the disclosure and the actions. Done opens the sheet that logs the
 * run, filled in with what the hero shows, and Not today the sheet that moves or skips the
 * session. That sheet carries the "Not 100%" entry, which swaps it for the sheet that makes a rest
 * window, dated from the day of this session (the server's day). When readiness eases the day the
 * easy run is the hero and the planned session sits above it, muted; on a rest day the hero says
 * so and keeps the planned session beside it. Every figure comes from the payload.
 */
export function SessionHero({ hero, heat, next, units, readOnly = false }: SessionHeroProps) {
  const titleId = useId()
  const title = useRef<HTMLHeadingElement>(null)
  const settled = useRef(false)
  const [whyOpen, setWhyOpen] = useState(false)
  const [sheet, setSheet] = useState<'done' | 'not-today' | 'not-full' | null>(null)

  // After a run is saved, the session is moved or skipped, or a window is made, the button that
  // opened the sheet is gone with the rest of the actions; focus goes to the title, where the new
  // state reads.
  useEffect(() => {
    if (sheet === null && settled.current) {
      settled.current = false
      title.current?.focus()
    }
  }, [sheet])

  const { session, advice, eased, target, linkedRun, others } = hero
  const rest = advice === 'rest' || session.kind === 'rest'
  const shown = eased ?? session
  const planned = { title: session.title, duration: minutes(session.durationMin) }
  const status = session.status === 'planned' ? null : sessionStatusLabel(session.status)
  const toRun = isToRun(session.status)
  const rules = [...new Set([...shown.rules, ...(advice === 'as-planned' ? [] : ['J3'])])]
  const showNext = rest || !toRun

  const plannedLine =
    advice === 'rest' && session.kind !== 'rest'
      ? render(TEMPLATES['today.hero.planned-not-today'], planned, units)
      : eased !== null
        ? render(TEMPLATES['today.hero.planned'], planned, units)
        : null
  const extent = [
    shown.distanceM === null ? null : formatDistance(shown.distanceM, units),
    shown.gainM === null || shown.gainM <= 0
      ? null
      : render(TEMPLATES['today.hero.climb'], { climb: { kind: 'climb', m: shown.gainM } }, units),
  ].filter((part): part is string => part !== null)
  const also = others.map(
    (other) => `${other.title} (${formatQuantity(minutes(other.durationMin), units)})`,
  )
  const nextText = showNext ? nextLine(next, units) : null

  return (
    <article aria-labelledby={titleId} className={styles.hero}>
      {plannedLine === null ? null : <p className={styles.planned}>{plannedLine}</p>}
      <div className={styles.head}>
        <h2 id={titleId} ref={title} tabIndex={-1} className={styles.title}>
          {rest ? render(TEMPLATES['today.hero.rest-day'], {}, units) : shown.title}
        </h2>
        {status === null ? null : <span className={styles.status}>{status}</span>}
      </div>

      {rest ? null : (
        <>
          <div className={styles.figureRow}>
            <p className={styles.figure}>
              <span className={styles.display}>{String(shown.durationMin)}</span>{' '}
              <span className={styles.unit}>min</span>
            </p>
            {extent.length === 0 ? null : (
              <p className={styles.extent}>
                {extent.map((part, index) => (
                  <Fragment key={part}>
                    {index === 0 ? null : ', '}
                    <span>{part}</span>
                  </Fragment>
                ))}
              </p>
            )}
          </div>
          {linkedRun === null ? null : (
            <p className={styles.muted}>{loggedLine(linkedRun, units)}</p>
          )}
          {target === null ? null : <SessionTargets targets={target} units={units} />}
          <TodaySlot name="fuel" />
          <CoolerStart heat={heat} units={units} />
          <KnowToday
            reasons={hero.reasons}
            climbNote={target?.climbNote ?? null}
            zonesNote={target?.zonesNote ?? null}
            heatNote={heat.note}
            units={units}
          />
          <p className={styles.purpose}>{shown.purpose}</p>
        </>
      )}
      {rest ? (
        <KnowToday
          reasons={hero.reasons}
          climbNote={null}
          zonesNote={null}
          heatNote={null}
          units={units}
        />
      ) : null}
      {nextText === null ? null : <p className={styles.muted}>{nextText}</p>}

      <SessionActions
        canAct={!rest && toRun && !readOnly}
        canExplain={rules.length > 0}
        onDone={() => {
          setSheet('done')
        }}
        onExplain={() => {
          setWhyOpen(true)
        }}
        onNotToday={() => {
          setSheet('not-today')
        }}
      />
      <TodaySlot name="watch" />
      {also.length === 0 ? null : (
        <p className={styles.muted}>
          {render(TEMPLATES['today.hero.also'], { sessions: also.join(', ') }, units)}
        </p>
      )}

      <WhyDrawer
        explain={{ subject: 'session', id: session.id }}
        rules={rules}
        open={whyOpen}
        onClose={() => {
          setWhyOpen(false)
        }}
      />
      {sheet === 'done' ? (
        <DoneSheet
          plan={shown}
          date={session.date}
          units={units}
          onClose={() => {
            setSheet(null)
          }}
          onSaved={() => {
            settled.current = true
            setSheet(null)
          }}
        />
      ) : null}
      {sheet === 'not-today' ? (
        <NotTodaySheet
          session={session}
          onClose={() => {
            setSheet(null)
          }}
          onChanged={() => {
            settled.current = true
            setSheet(null)
          }}
        >
          <NotFullEntry
            units={units}
            onOpen={() => {
              setSheet('not-full')
            }}
          />
        </NotTodaySheet>
      ) : null}
      {sheet === 'not-full' ? (
        <NotFullSheet
          today={session.date}
          onClose={() => {
            // The Not today button is gone with the sheet that held the entry, so focus goes to
            // the title, as after the other sheets.
            settled.current = true
            setSheet(null)
          }}
        />
      ) : null}
    </article>
  )
}
