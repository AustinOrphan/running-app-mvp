import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { render } from '../../../shared/copy/template.ts'
import { TEMPLATES } from '../../../shared/copy/templates.ts'
import { doneEntryFor } from '../../../shared/domain/doneEntry.ts'
import type { SessionKind } from '../../../shared/engine/types.ts'
import type { Feel, Units } from '../../../shared/types.ts'
import { formatDistance } from '../../../shared/units.ts'
import { type ActivityInput } from '../../api/activities.ts'
import { newActivityId, useSaveDone, WriteRefused } from '../../api/activityOutbox.ts'
import { useCachedUserId } from '../../api/auth.ts'
import { ApiError, fieldErrors } from '../../api/client.ts'
import {
  distanceText,
  DURATION_HINT,
  parseDistanceInput,
  parseDurationInput,
} from '../../pages/ActivityForm.tsx'
import { DONE_DRAFT_PREFIX } from '../../pwa/drafts.ts'
import { Button } from '../Button.tsx'
import { Field, Input } from '../Field.tsx'
import { FeelPicker, ScaleChips } from '../FeelPicker.tsx'
import { Sheet } from '../Sheet.tsx'
import { useToast } from '../Toast.tsx'
import { useOnline } from '../useOnline.ts'
import styles from './DoneSheet.module.css'

/** What the session asked for: the figures the sheet starts from. */
export interface DonePlan {
  kind: SessionKind
  durationMin: number
  distanceM: number | null
}

export interface DoneSheetProps {
  plan: DonePlan
  /** The planned session the run marks done; the server links the run to it. */
  sessionId: string
  /** The day the session is on, which is the server's day for it, and the day the run is logged on. */
  date: string
  units: Units
  onClose: () => void
  /** Called once the run is saved, in place of `onClose`. */
  onSaved: () => void
}

interface DoneForm {
  duration: string
  distance: string
  rpe: number | null
  feel: Feel | null
  pain: number | null
}

type Errors = Partial<Record<'duration' | 'distance' | 'rpe' | 'feel', string>>

const SERVER_FIELDS: Record<string, keyof Errors> = {
  durationSec: 'duration',
  distanceM: 'distance',
  rpe: 'rpe',
  feel: 'feel',
}

/**
 * The device keeps an unsent entry per day, so a reload or a lost connection does not lose it. The
 * key carries the signed-in user, so a second account on the same browser never opens the first
 * one's figures; sign-out and a 401 remove the drafts as well (`purgeDeviceData`).
 */
const draftKey = (date: string, userId: string | null) =>
  `${DONE_DRAFT_PREFIX}${userId === null ? '' : `${userId}_`}${date}`

function readDraft(key: string): DoneForm | null {
  try {
    const text = window.localStorage.getItem(key)
    if (text === null) return null
    const value: unknown = JSON.parse(text)
    if (typeof value !== 'object' || value === null) return null
    const draft = value as Partial<Record<keyof DoneForm, unknown>>
    const feel = draft.feel
    const rpe = draft.rpe
    if (typeof draft.duration !== 'string' || typeof draft.distance !== 'string') return null
    return {
      duration: draft.duration,
      distance: draft.distance,
      rpe: typeof rpe === 'number' ? rpe : null,
      feel: typeof feel === 'number' && feel >= -2 && feel <= 2 ? (feel as Feel) : null,
      pain:
        typeof draft.pain === 'number' && draft.pain >= 0 && draft.pain <= 10 ? draft.pain : null,
    }
  } catch {
    return null
  }
}

function writeDraft(key: string, form: DoneForm): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(form))
  } catch {
    // A full or blocked store only means no draft.
  }
}

function clearDraft(key: string): void {
  try {
    window.localStorage.removeItem(key)
  } catch {
    // Nothing to clear.
  }
}

/**
 * "Log today's run": the session's minutes and distance already filled in, with RPE, how it felt
 * and pain. One Save writes one activity under an id the sheet chose, so a repeat of the write is
 * the same write, and the server links the run to the session. With no connection the run is kept
 * on this phone (the outbox) and goes up later; the sheet says so. Changes are kept as a draft
 * until the run is saved. A session the server already has a run for (another phone) is refused in
 * plain words and nothing is stored.
 */
export function DoneSheet({ plan, sessionId, date, units, onClose, onSaved }: DoneSheetProps) {
  const formId = useId()
  const toast = useToast()
  const navigate = useNavigate()
  const online = useOnline()
  const save = useSaveDone()
  // The id is the write's key: a retry in this sheet repeats the write instead of making a second.
  const [activityId] = useState(newActivityId)
  const key = draftKey(date, useCachedUserId())
  const entry = doneEntryFor(plan.kind)
  const type = entry.type
  const isRun = type === 'run' || type === 'race'
  const hasDistance = type !== 'strength'
  const planned = distanceText(plan.distanceM, units)
  const [form, setForm] = useState<DoneForm>(
    () =>
      readDraft(key) ?? {
        duration: String(plan.durationMin),
        distance: planned,
        rpe: null,
        feel: null,
        pain: null,
      },
  )
  const [errors, setErrors] = useState<Errors>({})
  const [failure, setFailure] = useState<string | null>(null)
  // The session was already logged elsewhere: nothing was stored, and saving again cannot help.
  const [conflict, setConflict] = useState<string | null>(null)
  const conflictLine = useRef<HTMLParagraphElement>(null)
  // Save is replaced by "Back to Today" and held focus: it goes to the explanation, which scrolls into view.
  useEffect(() => {
    if (conflict !== null) conflictLine.current?.focus()
  }, [conflict])

  function change(patch: Partial<DoneForm>) {
    const next = { ...form, ...patch }
    setForm(next)
    writeDraft(key, next)
  }

  function build(): { input: ActivityInput & { sessionId: string } } | { errors: Errors } {
    const found: Errors = {}
    const durationSec = parseDurationInput(form.duration)
    if (durationSec === null) found.duration = DURATION_HINT
    let distanceM: number | null = null
    if (hasDistance && form.distance.trim() !== '') {
      // An untouched distance keeps the session's exact metres, not the rounded text.
      distanceM =
        form.distance === planned && plan.distanceM !== null
          ? plan.distanceM
          : parseDistanceInput(form.distance, units)
      if (distanceM === null) found.distance = 'Enter a distance like 5 or 5.2'
    }
    if (durationSec === null || Object.keys(found).length > 0) return { errors: found }
    const input: ActivityInput = { date, type, durationSec }
    // A hike is logged as `cross` with sub-type `hike`; without it the server cannot link the entry.
    if (entry.subtype !== undefined) input.subtype = entry.subtype
    if (distanceM !== null) input.distanceM = distanceM
    if (form.rpe !== null) input.rpe = form.rpe
    if (form.feel !== null) input.feel = form.feel
    if (form.pain !== null) input.pain = form.pain
    return { input: { ...input, sessionId } }
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    if (save.isPending || conflict !== null) return
    const built = build()
    if ('errors' in built) {
      setErrors(built.errors)
      setFailure(null)
      return
    }
    setErrors({})
    setFailure(null)
    // The sheet closes with the save, before a per-call callback would run, so the promise settles here.
    save.mutateAsync({ id: activityId, body: built.input }).then(
      (landed) => {
        clearDraft(key)
        if (landed === 'queued') {
          toast.show(render(TEMPLATES['today.done.queued'], {}, units))
        } else {
          toast.show(
            render(
              TEMPLATES[isRun ? 'today.done.saved-run' : 'today.done.saved-session'],
              {},
              units,
            ),
            {
              action: {
                label: render(
                  TEMPLATES[isRun ? 'today.done.see-run' : 'today.done.see-session'],
                  {},
                  units,
                ),
                onClick: () => {
                  void navigate(`/activities/${encodeURIComponent(activityId)}`)
                },
              },
            },
          )
        }
        onSaved()
      },
      (error: unknown) => {
        if (error instanceof WriteRefused && error.conflict) {
          clearDraft(key)
          setConflict(error.message)
          return
        }
        const mapped: Errors = {}
        for (const [path, message] of Object.entries(fieldErrors(error))) {
          const field = SERVER_FIELDS[path]
          if (field !== undefined) mapped[field] = message
        }
        setErrors(mapped)
        const reason =
          error instanceof ApiError || error instanceof WriteRefused
            ? error.message
            : 'Something went wrong.'
        setFailure(render(TEMPLATES['today.done.not-saved'], { reason }, units))
      },
    )
  }

  const sentence =
    plan.distanceM === null
      ? render(
          TEMPLATES['today.done.planned-time'],
          { duration: { kind: 'minutes', min: plan.durationMin } },
          units,
        )
      : render(
          TEMPLATES['today.done.planned'],
          {
            duration: { kind: 'minutes', min: plan.durationMin },
            distance: formatDistance(plan.distanceM, units),
          },
          units,
        )

  return (
    <Sheet
      open
      onClose={onClose}
      title={render(
        TEMPLATES[isRun ? 'today.done.title-run' : 'today.done.title-session'],
        {},
        units,
      )}
      footer={
        <>
          {online ? null : (
            <p role="status" className={styles.offline}>
              {render(TEMPLATES['today.done.offline'], {}, units)}
            </p>
          )}
          {conflict === null ? (
            <Button type="submit" form={formId} variant="primary" loading={save.isPending}>
              Save
            </Button>
          ) : (
            <Button variant="primary" onClick={onSaved}>
              Back to Today
            </Button>
          )}
        </>
      }
    >
      <form id={formId} onSubmit={submit} noValidate className={styles.form}>
        <p className={styles.planned}>{sentence}</p>
        <Field label="Duration" hint={DURATION_HINT} error={errors.duration}>
          {(control) => (
            <Input
              {...control}
              type="text"
              inputMode="text"
              autoComplete="off"
              value={form.duration}
              onChange={(event) => {
                change({ duration: event.target.value })
              }}
            />
          )}
        </Field>
        {hasDistance ? (
          <Field label={`Distance (${units === 'mi' ? 'mi' : 'km'})`} error={errors.distance}>
            {(control) => (
              <Input
                {...control}
                type="text"
                inputMode="decimal"
                autoComplete="off"
                value={form.distance}
                onChange={(event) => {
                  change({ distance: event.target.value })
                }}
              />
            )}
          </Field>
        ) : null}
        <ScaleChips
          legend="RPE"
          min={1}
          max={10}
          touch
          value={form.rpe}
          onChange={(rpe) => {
            change({ rpe })
          }}
          hint="1 is very easy, 10 is all out. Tap again to clear."
        />
        <FeelPicker
          value={form.feel}
          onChange={(feel) => {
            change({ feel })
          }}
        />
        <ScaleChips
          legend="Pain"
          min={0}
          max={10}
          touch
          value={form.pain}
          onChange={(pain) => {
            change({ pain })
          }}
          hint="0 is none, 10 is the worst. Tap again to clear."
        />
        {conflict === null ? null : (
          <p ref={conflictLine} tabIndex={-1} role="status" className={styles.notice}>
            {conflict}
          </p>
        )}
        {failure === null ? null : (
          <p role="alert" className={styles.notice}>
            {failure}
          </p>
        )}
      </form>
    </Sheet>
  )
}
