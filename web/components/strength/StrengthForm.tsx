import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { render } from '../../../shared/copy/template.ts'
import { TEMPLATES } from '../../../shared/copy/templates.ts'
import { countPhrase } from '../../../shared/copy/quantity.ts'
import { P } from '../../../shared/engine/params/index.ts'
import type {
  PinnedSlot,
  StrengthNextLoad,
  StrengthWorkout,
  Units,
  WeightUnit,
} from '../../../shared/types.ts'
import { STRENGTH_DURATION_MAX_MIN } from '../../../shared/limits.ts'
import { useCreateActivity } from '../../api/activities.ts'
import { useSaveStrengthLog, useSaveStrengthSettings, useStrengthView } from '../../api/strength.ts'
import { Button } from '../Button.tsx'
import { Field, Input, Textarea } from '../Field.tsx'
import { ScalePicker } from '../ScalePicker.tsx'
import { useToast } from '../Toast.tsx'
import { getOutbox } from '../../pwa/outbox.ts'
import { useOnline } from '../useOnline.ts'
import { LiftSection } from './LiftSection.tsx'
import {
  EFFORT_SCALE,
  PAIN_SCALE,
  REPS_LEFT_MAX,
  asSuggested,
  bareActivity,
  buildLogBody,
  canAddSet,
  hasLast,
  initialState,
  lastSetsOf,
  newLogId,
  queuedLogOf,
  parseMinutes,
  sameAsLast,
  stateFromBody,
  withUsualLoad,
  type Block,
  type FormState,
  type LogIssues,
} from './strengthForm.ts'
import {
  applyDraft,
  clearDraft,
  contextOf,
  draftOf,
  readDraft,
  writeDraft,
} from './strengthDraft.ts'
import { strengthWords } from './strengthText.ts'
import { usualLoadOf } from './workoutRows.ts'
import styles from './StrengthSheet.module.css'

/** What a save came to, for the surface that opened the sheet. */
export interface StrengthSaved {
  /** `sent`: the server has it. `queued`: it is kept on this phone. `without-sets`: only the minutes and effort. */
  status: 'sent' | 'queued' | 'without-sets'
  /** The load now suggested for each lift of the session; empty unless the server answered. */
  next: StrengthNextLoad[]
}

export interface StrengthFormProps {
  workout: StrengthWorkout
  date: string
  /** The planned session the log links to; null for none. */
  sessionId: string | null
  activityId: string | null
  /** Start every set that has a usual load at it (design 11.1). */
  usualLoads?: boolean
  weightUnit: WeightUnit
  units: Units
  onSaved: (saved: StrengthSaved) => void
}

/**
 * The logging sheet's form (design 9.1): the lifts filled from the workout, "As suggested" and "Same
 * as last time", the minutes and the effort, and Save. Nothing is written until Save; what is entered
 * is kept on this device as a draft until then, under an id that is also the idempotency key of the
 * save, so a save that is replayed from the outbox leaves one log. A sheet hosts it (`StrengthSheet`).
 */
export function StrengthForm({
  workout,
  date,
  sessionId,
  activityId,
  usualLoads = false,
  weightUnit,
  units,
  onSaved,
}: StrengthFormProps) {
  const words = useMemo(() => strengthWords(units, weightUnit), [units, weightUnit])
  const toast = useToast()
  const online = useOnline()
  const view = useStrengthView()
  const save = useSaveStrengthLog()
  const bare = useCreateActivity()
  const pin = useSaveStrengthSettings()
  const formRef = useRef<HTMLFormElement>(null)
  const dirty = useRef(false)
  const workoutSession = workout.sessionId
  const context = useMemo(
    () => contextOf({ sessionId: workoutSession }, date, activityId),
    [workoutSession, date, activityId],
  )

  // The sheet opens on what is kept for its session, and chooses an id only when nothing is. A save
  // still in the outbox is found first: its id is the one a second save has to use, or one session
  // replays as two logs; the draft of that id, if the runner went on editing, is newer than its body.
  // Otherwise the draft brings its id back, so the save it was kept for is the same save.
  const [boot] = useState(() => {
    const start = initialState(workout, weightUnit)
    const fresh = usualLoads
      ? { ...start, blocks: start.blocks.map((block) => withUsualLoad(block, weightUnit)) }
      : start
    const draft = readDraft(context)
    const queued = queuedLogOf(getOutbox().getState().entries, { sessionId, date, activityId })
    if (queued !== null) {
      return {
        logId: queued.logId,
        state:
          draft?.logId === queued.logId
            ? applyDraft(fresh, draft, weightUnit)
            : stateFromBody(fresh, queued.body, weightUnit),
      }
    }
    return draft === null
      ? { logId: newLogId(), state: fresh }
      : { logId: draft.logId, state: applyDraft(fresh, draft, weightUnit) }
  })
  const { logId } = boot
  const [state, setState] = useState<FormState>(boot.state)
  const [attempted, setAttempted] = useState(false)
  const [problems, setProblems] = useState<LogIssues | null>(null)
  const [more, setMore] = useState(boot.state.pain !== null || boot.state.notes !== '')

  function change(update: (current: FormState) => FormState): void {
    dirty.current = true
    setState(update)
  }

  function changeBlock(key: string, update: (block: Block) => Block): void {
    change((current) => ({
      ...current,
      blocks: current.blocks.map((block) => (block.key === key ? update(block) : block)),
    }))
  }

  useEffect(() => {
    if (dirty.current) writeDraft(draftOf(logId, context, state, Date.now(), weightUnit))
  }, [logId, context, state, weightUnit])

  // The sheet focuses its first control when it opens. When the settings arrived after that, focus
  // is still on the dialog itself, so it goes to the first control here.
  useEffect(() => {
    if (document.activeElement?.getAttribute('role') === 'dialog') {
      formRef.current?.querySelector<HTMLElement>('button, input')?.focus()
    }
  }, [])

  // A save the sheet could not make says which field it could not read, and focus goes there.
  useEffect(() => {
    if (problems !== null) {
      formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()
    }
  }, [problems])

  const equipment = view.data?.settings.equipment ?? null
  const pinned = view.data?.settings.pinned
  const lastOf = useMemo(() => lastSetsOf(view.data?.recent ?? []), [view.data])
  const anyLast = state.blocks.some((block) => hasLast(block, lastOf))
  const addable = canAddSet(state.blocks)
  const hasEffort = state.blocks.some((block) => block.shown.rir !== null)
  const lighterDay = state.blocks.some((block) => block.shown.change === 'lighter-day')
  // "the usual load is one tap away" is true only where some lift has a usual load to go back to
  const anyUsual = state.blocks.some((block) => usualLoadOf(block.shown) !== null)
  const minutesWrong =
    parseMinutes(state.minutes) === null && (attempted || problems?.minutes === true)
  const sheetNeedsServer = view.isError && view.data === undefined

  async function pinChoice(exerciseId: string, slot: PinnedSlot): Promise<boolean> {
    const kept = view.data?.settings.pinned ?? {}
    try {
      await pin.mutateAsync({ pinned: { ...kept, [slot]: exerciseId } })
      return true
    } catch {
      return false
    }
  }

  function done(saved: StrengthSaved, message: string): void {
    // the draft is of an unsent sheet: a saved one has none, and the effect must not write it back
    dirty.current = false
    clearDraft(logId)
    toast.show(message)
    onSaved(saved)
  }

  function submit(): void {
    setAttempted(true)
    const built = buildLogBody({
      workout,
      date,
      sessionId,
      activityId,
      state,
      unit: weightUnit,
    })
    if (!built.ok) {
      setProblems(built.issues)
      return
    }
    setProblems(null)
    // A log the server turned down shows in the sheet's alert and the entries stay; one kept on
    // this phone is as good as saved. The saved session can leave the sheet's surface before a
    // per-call callback would run, so the promise settles here.
    save.mutateAsync({ logId, body: built.body }).then(
      (result) => {
        if (result.status === 'rejected') return
        if (result.status === 'queued') {
          done({ status: 'queued', next: [] }, words.say('strength.sheet.saved-queued'))
        } else {
          done({ status: 'sent', next: result.next }, words.saved(result.next))
        }
      },
      () => {
        // The failure shows in the sheet's alert, and the entries stay.
      },
    )
  }

  function saveWithoutSets(): void {
    setAttempted(true)
    const input = bareActivity(state, date)
    if (input === null) {
      setProblems({ sets: [], minutes: true, empty: false })
      return
    }
    setProblems(null)
    bare.mutateAsync(input).then(
      () => {
        done(
          { status: 'without-sets', next: [] },
          render(TEMPLATES['today.done.saved-session'], {}, units),
        )
      },
      () => {
        // The failure shows in the sheet's alert, and the entries stay.
      },
    )
  }

  function onSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    if (!save.isPending) submit()
  }

  const failure = (() => {
    if (problems?.empty === true) return words.say('strength.sheet.no-sets')
    if (problems !== null && problems.sets.length > 0)
      return words.say('strength.sheet.check-fields')
    if (save.isError) return words.say('strength.sheet.not-saved', { reason: save.error.message })
    if (save.data?.status === 'rejected') {
      return words.say('strength.sheet.not-saved', { reason: save.data.reason })
    }
    if (bare.isError)
      return words.say('strength.sheet.not-saved-bare', { reason: bare.error.message })
    return null
  })()

  return (
    <form
      ref={formRef}
      className={styles.form}
      aria-label={words.heading(workout.template, workout.variant)}
      noValidate
      onSubmit={onSubmit}
    >
      <div className={styles.intro}>
        <p className={styles.muted}>
          {words.say('strength.sheet.date-unit', {
            date: { kind: 'date', iso: date, style: 'weekday' },
            unit: words.unitName(),
          })}
        </p>
        {lighterDay ? (
          <p className={styles.note}>
            {anyUsual
              ? words.say('strength.lighter-today', {
                  sets: countPhrase(P.f9.lowReadinessSetsCut.value, 'set'),
                  pct: { kind: 'percent', pct: P.f9.lowReadinessLoadPct.value },
                })
              : words.say('strength.lighter-today-sets', {
                  sets: countPhrase(P.f9.lowReadinessSetsCut.value, 'set'),
                })}
          </p>
        ) : null}
        <p className={styles.muted}>{words.say('strength.safety')}</p>
        <p className={styles.muted}>
          {words.say('strength.sheet.warmup')}
          {hasEffort
            ? ` ${words.say('strength.sheet.reps-left-hint', { max: words.count(REPS_LEFT_MAX) })}`
            : ''}
        </p>
      </div>

      <div className={styles.quick}>
        <Button
          variant="quiet"
          onClick={() => {
            change((current) => ({ ...current, blocks: asSuggested(current.blocks, weightUnit) }))
          }}
        >
          {words.say('strength.sheet.as-suggested')}
        </Button>
        <Button
          variant="quiet"
          disabled={!anyLast}
          onClick={() => {
            change((current) => ({
              ...current,
              blocks: sameAsLast(current.blocks, lastOf, weightUnit),
            }))
          }}
        >
          {words.say('strength.sheet.same-as-last')}
        </Button>
      </div>
      {sheetNeedsServer ? (
        <p className={styles.muted} role="status">
          {words.say('strength.sheet.needs-connection')}
        </p>
      ) : null}

      <div className={styles.lifts}>
        {state.blocks.map((block) => (
          <LiftSection
            key={block.key}
            block={block}
            workout={workout}
            words={words}
            weightUnit={weightUnit}
            attempted={attempted}
            equipment={equipment}
            pinned={pinned?.[block.shown.slot as PinnedSlot]}
            hasLast={hasLast(block, lastOf)}
            canAdd={addable}
            onChange={(update) => {
              changeBlock(block.key, update)
            }}
            onSameAsLast={() => {
              change((current) => ({
                ...current,
                blocks: sameAsLast(current.blocks, lastOf, weightUnit, block.key),
              }))
            }}
            onPin={pinChoice}
          />
        ))}
      </div>

      <div className={styles.footer}>
        <Field
          label={words.say('strength.sheet.minutes')}
          error={
            minutesWrong
              ? words.say('strength.sheet.minutes-invalid', {
                  lo: words.count(1),
                  hi: words.count(STRENGTH_DURATION_MAX_MIN),
                })
              : undefined
          }
        >
          {(control) => (
            <Input
              {...control}
              type="text"
              inputMode="numeric"
              autoComplete="off"
              value={state.minutes}
              onChange={(event) => {
                change((current) => ({ ...current, minutes: event.target.value }))
              }}
            />
          )}
        </Field>
        <ScalePicker
          legend={words.say('strength.sheet.effort')}
          min={EFFORT_SCALE.min}
          max={EFFORT_SCALE.max}
          value={state.effort}
          touch
          hint={words.say('strength.sheet.effort-hint', {
            lo: words.count(EFFORT_SCALE.min),
            hi: words.count(EFFORT_SCALE.max),
          })}
          onChange={(effort) => {
            change((current) => ({ ...current, effort }))
          }}
        />
        <div>
          <Button
            variant="quiet"
            aria-expanded={more}
            onClick={() => {
              setMore((open) => !open)
            }}
          >
            {words.say('strength.sheet.more-details')}
          </Button>
        </div>
        {more ? (
          <>
            <ScalePicker
              legend={words.say('strength.sheet.pain')}
              min={PAIN_SCALE.min}
              max={PAIN_SCALE.max}
              value={state.pain}
              touch
              hint={words.say('strength.sheet.pain-hint', {
                lo: words.count(PAIN_SCALE.min),
                hi: words.count(PAIN_SCALE.max),
              })}
              onChange={(pain) => {
                change((current) => ({ ...current, pain }))
              }}
            />
            <Field label={words.say('strength.sheet.note')}>
              {(control) => (
                <Textarea
                  {...control}
                  value={state.notes}
                  onChange={(event) => {
                    change((current) => ({ ...current, notes: event.target.value }))
                  }}
                />
              )}
            </Field>
          </>
        ) : null}
      </div>

      <div className={styles.actions}>
        {failure === null ? null : (
          <p role="alert" className={styles.alert}>
            {failure}
          </p>
        )}
        {online ? null : (
          <p role="status" className={styles.muted}>
            {words.say('strength.sheet.offline')}
          </p>
        )}
        <div className={styles.buttons}>
          <Button type="submit" variant="primary" loading={save.isPending}>
            {words.say('strength.sheet.save')}
          </Button>
          {/* An activity is not an idempotent write, so with no connection it is not queued; and a
              sheet that attaches to an activity that exists has no activity to make. */}
          {activityId === null ? (
            <Button
              variant="quiet"
              disabled={!online}
              loading={bare.isPending}
              onClick={saveWithoutSets}
            >
              {words.say('strength.sheet.save-without-sets')}
            </Button>
          ) : null}
        </div>
        {online || activityId !== null ? null : (
          <p className={styles.muted}>{words.say('strength.sheet.bare-offline')}</p>
        )}
      </div>
    </form>
  )
}
