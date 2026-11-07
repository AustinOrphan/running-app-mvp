import { useId, useRef, useState, type FormEvent } from 'react'
import { describeRacePointsEditor, raceOfflineText } from '../../../shared/copy/racePlan.ts'
import { P } from '../../../shared/engine/params/index.ts'
import type { RacePlan } from '../../../shared/engine/racePlan.ts'
import { startMinutes } from '../../../shared/engine/goal.ts'
import { RACE_CHECKPOINT_NAME_MAX } from '../../../shared/limits.ts'
import type { RaceCheckpointRow, Units } from '../../../shared/types.ts'
import { fieldErrors } from '../../api/client.ts'
import { useRaceCheckpoints, useSaveRaceCheckpoints } from '../../api/race.ts'
import { Button } from '../Button.tsx'
import { Field, Input, Select } from '../Field.tsx'
import { Sheet } from '../Sheet.tsx'
import { Skeleton } from '../Skeleton.tsx'
import { useToast } from '../Toast.tsx'
import {
  blankDraft,
  draftFrom,
  parseDrafts,
  type CutoffMode,
  type PointDraft,
  type PointErrors,
  type PointField,
} from './checkpointForm.ts'
import styles from './CheckpointSheet.module.css'

/** The server's field names: the draft field each belongs to and the refusal it shows. */
const SERVER_FIELDS: Record<string, [PointField, NonNullable<PointErrors[PointField]>]> = {
  name: ['name', 'name'],
  distanceM: ['distance', 'distance'],
  gainM: ['gain', 'metres'],
  lossM: ['loss', 'metres'],
  cutoffSec: ['cutoff', 'cutoff'],
}

/** The days a clock cutoff may fall on: the race date and up to three days after it. */
const CUTOFF_DAYS = [0, 1, 2, 3] as const

interface EditorProps {
  plan: RacePlan
  units: Units
  rows: RaceCheckpointRow[]
  onClose: () => void
}

function Editor({ plan, units, rows, onClose }: EditorProps) {
  const formId = useId()
  const toast = useToast()
  const save = useSaveRaceCheckpoints()
  const text = describeRacePointsEditor({ supportLevel: plan.supportLevel }, units)
  const nextKey = useRef(rows.length)
  const newKey = () => `point-${String(nextKey.current++)}`
  const [drafts, setDrafts] = useState<PointDraft[]>(() =>
    rows.map((row, index) => draftFrom(row, `point-${String(index)}`, units)),
  )
  const [errors, setErrors] = useState<PointErrors[]>([])
  const [formError, setFormError] = useState<string | null>(null)
  const startMin = startMinutes(plan.expected.start)
  const max = P.r1.maxCheckpoints.value

  const change = (index: number, patch: Partial<PointDraft>) => {
    setDrafts((current) => current.map((d, i) => (i === index ? { ...d, ...patch } : d)))
  }

  const message = (code: PointErrors[PointField]): string | undefined => {
    switch (code) {
      case 'name':
        return text.errName
      case 'distance':
        return text.errDistance
      case 'duplicate':
        return text.errDuplicate
      case 'metres':
        return text.errMetres
      case 'cutoff':
        return text.errCutoff
      case 'clock':
        return text.errClock
      case undefined:
        return undefined
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    setFormError(null)
    if (drafts.length > max) {
      setFormError(text.errCount(max))
      return
    }
    const parsed = parseDrafts(drafts, { units, courseM: plan.distanceM, startMin })
    setErrors(parsed.errors)
    if (!parsed.ok) return
    save.mutate(
      parsed.rows.map((r) => r.row),
      {
        onSuccess: () => {
          toast.show(text.saved)
          onClose()
        },
        onError: (err) => {
          // A refusal names the row and the field, never the value; show it on the right point.
          const next: PointErrors[] = drafts.map(() => ({}))
          let placed = false
          for (const path of Object.keys(fieldErrors(err))) {
            const match = /^checkpoints\.(\d+)\.(\w+)$/.exec(path)
            const sent = match === null ? undefined : parsed.rows[Number(match[1])]
            const field = match === null ? undefined : SERVER_FIELDS[match[2] ?? '']
            if (sent !== undefined && field !== undefined) {
              next[sent.draftIndex] = { ...next[sent.draftIndex], [field[0]]: field[1] }
              placed = true
            }
          }
          setErrors(next)
          if (!placed) setFormError(text.saveFailed)
        },
      },
    )
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title={text.title}
      busy={save.isPending}
      footer={
        <Button type="submit" form={formId} variant="primary" loading={save.isPending}>
          {text.save}
        </Button>
      }
    >
      <form id={formId} className={styles.form} onSubmit={submit} noValidate>
        <p className={styles.hint}>{text.hint}</p>
        {drafts.map((draft, index) => {
          const own = errors[index] ?? {}
          return (
            <fieldset key={draft.key} className={styles.point}>
              <legend className={styles.legend}>{text.pointN(index + 1)}</legend>
              <Field label={text.name} error={message(own.name)}>
                {(a) => (
                  <Input
                    {...a}
                    value={draft.name}
                    maxLength={RACE_CHECKPOINT_NAME_MAX}
                    onChange={(e) => {
                      change(index, { name: e.target.value })
                    }}
                  />
                )}
              </Field>
              <Field label={text.distance} error={message(own.distance)}>
                {(a) => (
                  <Input
                    {...a}
                    inputMode="decimal"
                    value={draft.distance}
                    onChange={(e) => {
                      change(index, { distance: e.target.value })
                    }}
                  />
                )}
              </Field>
              <div className={styles.row}>
                <Field label={text.gain} hint={text.climbHint} error={message(own.gain)}>
                  {(a) => (
                    <Input
                      {...a}
                      inputMode="numeric"
                      value={draft.gain}
                      onChange={(e) => {
                        change(index, { gain: e.target.value })
                      }}
                    />
                  )}
                </Field>
                <Field label={text.loss} hint={text.climbHint} error={message(own.loss)}>
                  {(a) => (
                    <Input
                      {...a}
                      inputMode="numeric"
                      value={draft.loss}
                      onChange={(e) => {
                        change(index, { loss: e.target.value })
                      }}
                    />
                  )}
                </Field>
              </div>
              {startMin === null ? null : (
                <Field label={text.cutoffAs}>
                  {(a) => (
                    <Select
                      {...a}
                      value={draft.cutoffMode}
                      onChange={(e) => {
                        change(index, { cutoffMode: e.target.value as CutoffMode, cutoff: '' })
                      }}
                    >
                      <option value="elapsed">{text.asElapsed}</option>
                      <option value="clock">{text.asClock}</option>
                    </Select>
                  )}
                </Field>
              )}
              {draft.cutoffMode === 'clock' && startMin !== null ? (
                <div className={styles.row}>
                  <Field label={text.cutoffClock} error={message(own.cutoff)}>
                    {(a) => (
                      <Input
                        {...a}
                        type="time"
                        value={draft.cutoff}
                        onChange={(e) => {
                          change(index, { cutoff: e.target.value })
                        }}
                      />
                    )}
                  </Field>
                  <Field label={text.cutoffDay}>
                    {(a) => (
                      <Select
                        {...a}
                        value={String(draft.cutoffDay)}
                        onChange={(e) => {
                          change(index, { cutoffDay: Number(e.target.value) })
                        }}
                      >
                        {CUTOFF_DAYS.map((day) => (
                          <option key={day} value={day}>
                            {text.dayN(day)}
                          </option>
                        ))}
                      </Select>
                    )}
                  </Field>
                </div>
              ) : (
                <Field label={text.cutoff} error={message(own.cutoff)}>
                  {(a) => (
                    <Input
                      {...a}
                      inputMode="numeric"
                      placeholder="9:30"
                      value={draft.cutoff}
                      onChange={(e) => {
                        change(index, { cutoff: e.target.value })
                      }}
                    />
                  )}
                </Field>
              )}
              <div>
                <Button
                  variant="quiet"
                  onClick={() => {
                    setDrafts((current) => current.filter((_d, i) => i !== index))
                    setErrors([])
                  }}
                  aria-label={`${text.remove} ${text.pointN(index + 1)}`}
                >
                  {text.remove}
                </Button>
              </div>
            </fieldset>
          )
        })}
        {drafts.length >= max ? (
          <p className={styles.hint}>{text.errCount(max)}</p>
        ) : (
          <div>
            <Button
              onClick={() => {
                setDrafts((current) => [...current, blankDraft(newKey())])
              }}
            >
              {text.add}
            </Button>
          </div>
        )}
        {formError === null ? null : (
          <p role="alert" className={styles.error}>
            {formError}
          </p>
        )}
      </form>
    </Sheet>
  )
}

export interface CheckpointSheetProps {
  plan: RacePlan
  units: Units
  onClose: () => void
}

/**
 * The editor of the runner's checkpoint table (rule H14, ADR 0018): a name and a distance for each
 * point, and optionally the climb and descent since the previous point and a cutoff, entered as
 * time into the race or, with a start time, as a time of day. A save replaces the whole table. The
 * rows are the runner's private data; a refusal is shown on the point and field it names.
 */
export function CheckpointSheet({ plan, units, onClose }: CheckpointSheetProps) {
  const query = useRaceCheckpoints()
  const text = describeRacePointsEditor({ supportLevel: plan.supportLevel }, units)
  if (query.data === undefined) {
    return (
      <Sheet open onClose={onClose} title={text.title}>
        {query.isError ? (
          <p role="alert" className={styles.error}>
            {raceOfflineText(units)}
          </p>
        ) : (
          <Skeleton lines={4} />
        )}
      </Sheet>
    )
  }
  return <Editor plan={plan} units={units} rows={query.data.checkpoints} onClose={onClose} />
}
