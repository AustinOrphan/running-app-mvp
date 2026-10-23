import { useId, useState, type FormEvent } from 'react'
import { render } from '../../../shared/copy/template.ts'
import { TEMPLATES } from '../../../shared/copy/templates.ts'
import type { SessionKind } from '../../../shared/engine/types.ts'
import type { ActivityType, Feel, Units } from '../../../shared/types.ts'
import { formatDistance } from '../../../shared/units.ts'
import { useCreateActivity, type ActivityInput } from '../../api/activities.ts'
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
  /** The day the session is on, which is the day the run is logged on. */
  date: string
  units: Units
  onClose: () => void
  /** Called once the run is saved, in place of `onClose`. */
  onSaved: () => void
}

/**
 * The activity type a session of this kind is logged as: the type the server links to it (a run,
 * a race, a strength session) or, for a hike, a walk or mobility work, a cross-training entry.
 */
export function activityTypeFor(kind: SessionKind): ActivityType {
  switch (kind) {
    case 'race':
      return 'race'
    case 'strength':
      return 'strength'
    case 'hike':
    case 'mobility':
    case 'cross':
      return 'cross'
    default:
      return 'run'
  }
}

interface DoneForm {
  duration: string
  distance: string
  rpe: number | null
  feel: Feel | null
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
 * "Log today's run": the session's minutes and distance already filled in, with RPE and how it
 * felt. One Save posts one activity, and the server links it to the session. Changes are kept on
 * this phone as a draft until the run is saved. With no connection Save is off and the sheet says
 * so: an activity is not an idempotent write, so it is never queued for later.
 */
export function DoneSheet({ plan, date, units, onClose, onSaved }: DoneSheetProps) {
  const formId = useId()
  const toast = useToast()
  const online = useOnline()
  const create = useCreateActivity()
  const key = draftKey(date, useCachedUserId())
  const type = activityTypeFor(plan.kind)
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
      },
  )
  const [errors, setErrors] = useState<Errors>({})
  const [failure, setFailure] = useState<string | null>(null)

  function change(patch: Partial<DoneForm>) {
    const next = { ...form, ...patch }
    setForm(next)
    writeDraft(key, next)
  }

  function build(): { input: ActivityInput } | { errors: Errors } {
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
    if (distanceM !== null) input.distanceM = distanceM
    if (form.rpe !== null) input.rpe = form.rpe
    if (form.feel !== null) input.feel = form.feel
    return { input }
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    if (!online || create.isPending) return
    const built = build()
    if ('errors' in built) {
      setErrors(built.errors)
      setFailure(null)
      return
    }
    setErrors({})
    setFailure(null)
    create.mutate(built.input, {
      onSuccess: () => {
        clearDraft(key)
        toast.show(
          render(TEMPLATES[isRun ? 'today.done.saved-run' : 'today.done.saved-session'], {}, units),
        )
        onSaved()
      },
      onError: (error) => {
        const mapped: Errors = {}
        for (const [path, message] of Object.entries(fieldErrors(error))) {
          const field = SERVER_FIELDS[path]
          if (field !== undefined) mapped[field] = message
        }
        setErrors(mapped)
        const reason = error instanceof ApiError ? error.message : 'Something went wrong.'
        setFailure(render(TEMPLATES['today.done.not-saved'], { reason }, units))
      },
    })
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
          <Button
            type="submit"
            form={formId}
            variant="primary"
            disabled={!online}
            loading={create.isPending}
          >
            Save
          </Button>
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
        {failure === null ? null : (
          <p role="alert" className={styles.notice}>
            {failure}
          </p>
        )}
      </form>
    </Sheet>
  )
}
