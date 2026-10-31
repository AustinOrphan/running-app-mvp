import { useMemo, useState } from 'react'
import { renderFact } from '../../shared/copy/templates.ts'
import type {
  StrengthLog,
  StrengthView,
  StrengthWorkout,
  Units,
  WeightUnit,
} from '../../shared/types.ts'
import { useStrengthUnits, useStrengthView } from '../api/strength.ts'
import { PageHeader } from '../components/PageHeader.tsx'
import { Skeleton } from '../components/Skeleton.tsx'
import { StrengthSetupSheet, StrengthSheet } from '../components/lazySheets.tsx'
import { AboutCard } from '../components/strength/AboutCard.tsx'
import { BlockCard } from '../components/strength/BlockCard.tsx'
import { CountPrompt } from '../components/strength/CountPrompt.tsx'
import { LiftHistory } from '../components/strength/LiftHistory.tsx'
import { LiftsList } from '../components/strength/LiftsList.tsx'
import { RecentSessions } from '../components/strength/RecentSessions.tsx'
import { SetupCard } from '../components/strength/SetupCard.tsx'
import { StrengthLogNotices } from '../components/strength/StrengthLogNotices.tsx'
import type { SetupPart } from '../components/strength/setupForm.ts'
import { UnitsSection } from '../components/strength/UnitsSection.tsx'
import { WorkoutCard } from '../components/strength/WorkoutCard.tsx'
import { workoutOfLog } from '../components/strength/strengthForm.ts'
import { pageWords } from '../components/strength/strengthPageText.ts'
import styles from './StrengthPage.module.css'

/** What the logging sheet is open on: the next workout (at a day), or a saved log being edited. */
type Logging =
  | { kind: 'workout'; workout: StrengthWorkout; date: string; sessionId: string | null }
  | { kind: 'edit'; log: StrengthLog }

interface BodyProps {
  view: StrengthView
  units: Units
  weightUnit: WeightUnit
}

/**
 * The sections in the order a phone shows them: setup (until it is saved), the next session, the
 * block, the lifts, the history of one lift, the recent sessions, equipment and units, and about.
 * From 900 px the first four stand in the left column and the next four in the right, so the DOM
 * order is the reading order at every width.
 */
function StrengthBody({ view, units, weightUnit }: BodyProps) {
  const words = useMemo(() => pageWords(units, weightUnit), [units, weightUnit])
  const [part, setPart] = useState<SetupPart | null>(null)
  const [logging, setLogging] = useState<Logging | null>(null)
  const [lift, setLift] = useState<string | null>(null)

  /** A sentence that restates a Param, worded from the fact the view carries (design 11.6). */
  const fact = (template: string): string | null => {
    const found = view.facts.find((candidate) => candidate.template === template)
    return found === undefined ? null : renderFact(found, units, weightUnit)
  }
  const next = view.next[0] ?? null
  const benefit = fact('strength.benefit')
  // an edit opens on the workout of its log, with the steps the saved equipment makes now
  const sheetWorkout = useMemo(
    () =>
      logging === null
        ? null
        : logging.kind === 'workout'
          ? logging.workout
          : workoutOfLog(logging.log, view.settings.equipment, weightUnit),
    [logging, view.settings.equipment, weightUnit],
  )

  return (
    <div className={styles.page}>
      <div className={styles.columns}>
        <div className={styles.column}>
          {view.setupSaved ? null : <SetupCard words={words} onOpen={setPart} />}
          <WorkoutCard
            workout={next}
            asOf={view.asOf}
            words={words}
            separation={fact('strength.separation')}
            onLog={(workout) => {
              // a session that is still ahead is logged today, and a session of today is the day's
              const today = workout.date <= view.asOf
              setLogging({
                kind: 'workout',
                workout,
                date: today ? workout.date : view.asOf,
                sessionId: today ? workout.sessionId : null,
              })
            }}
            onPast={(workout, date) => {
              setLogging({ kind: 'workout', workout, date, sessionId: null })
            }}
          />
          <BlockCard block={view.block} benefit={benefit} words={words} />
          <CountPrompt view={view} words={words} />
          <LiftsList
            lifts={view.lifts}
            selected={lift}
            words={words}
            units={units}
            weightUnit={weightUnit}
            onSelect={setLift}
          />
        </div>
        <div className={styles.column}>
          <LiftHistory exerciseId={lift} words={words} units={units} weightUnit={weightUnit} />
          <RecentSessions
            logs={view.recent}
            words={words}
            units={units}
            weightUnit={weightUnit}
            onEdit={(log) => {
              setLogging({ kind: 'edit', log })
            }}
          />
          <UnitsSection view={view} words={words} weightUnit={weightUnit} onOpen={setPart} />
          <AboutCard benefit={benefit} words={words} />
        </div>
      </div>

      {part === null ? null : (
        <StrengthSetupSheet
          part={part}
          view={view}
          weightUnit={weightUnit}
          units={units}
          onClose={() => {
            setPart(null)
          }}
        />
      )}
      {logging === null || sheetWorkout === null ? null : (
        <StrengthSheet
          workout={sheetWorkout}
          date={logging.kind === 'workout' ? logging.date : logging.log.date}
          sessionId={logging.kind === 'workout' ? logging.sessionId : null}
          {...(logging.kind === 'edit' ? { log: logging.log } : {})}
          onClose={() => {
            setLogging(null)
          }}
          onSaved={() => {
            setLogging(null)
          }}
        />
      )}
    </div>
  )
}

/**
 * The Strength page (`/strength`, reached from More): the next workout, where the block stands, the
 * lifts and the history of each, the recent sessions, the equipment and units, and what the
 * programme does and does not claim. Everything comes from `GET /api/strength` (and one read of an
 * exercise's history), so nothing here works out a load, a week or an estimate. It is not one of the
 * reads the service worker keeps (ADR 0012): with no connection it says so.
 */
export function StrengthPage() {
  const view = useStrengthView()
  const units = useStrengthUnits()
  const words = pageWords('km', 'lb')

  return (
    <>
      <PageHeader
        title={words.say('strength.page.title')}
        context={words.say('strength.page.context')}
      />
      {/* a log the server refused when it was sent later is gone from the phone: say so, here too */}
      <StrengthLogNotices />
      {view.data === undefined && view.isError ? (
        <p role="alert" className={styles.error}>
          {words.say('strength.page.load-error')}
        </p>
      ) : units.isError ? (
        <p role="alert" className={styles.error}>
          {words.say('strength.page.units-error')}
        </p>
      ) : view.data === undefined || units.data === undefined ? (
        <Skeleton lines={6} />
      ) : (
        <StrengthBody
          view={view.data}
          units={units.data.units}
          weightUnit={units.data.weightUnit}
        />
      )}
    </>
  )
}
