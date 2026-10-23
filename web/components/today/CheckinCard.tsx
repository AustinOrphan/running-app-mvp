import { useId, useState } from 'react'
import type { Checkin } from '../../../shared/types.ts'
import { useSaveCheckin } from '../../api/checkins.ts'
import { ApiError } from '../../api/client.ts'
import { Button } from '../Button.tsx'
import { Input } from '../Field.tsx'
import { ScalePicker } from '../ScalePicker.tsx'
import styles from './CheckinCard.module.css'

interface CheckinDraft {
  fatigue: number | null
  soreness: number | null
  sleepQuality: number | null
  mood: number | null
  stress: number | null
  illness: boolean
  painScore: number | null
  painArea: string
  painFocalBone: boolean
}

function draftFrom(checkin: Checkin | null, boneActive: boolean): CheckinDraft {
  return {
    fatigue: checkin?.fatigue ?? null,
    soreness: checkin?.soreness ?? null,
    sleepQuality: checkin?.sleepQuality ?? null,
    mood: checkin?.mood ?? null,
    stress: checkin?.stress ?? null,
    illness: checkin?.illness ?? false,
    painScore: checkin?.painScore ?? null,
    painArea: checkin?.painArea ?? '',
    // Reported bone tenderness stays ticked until the runner unticks it [rules n-1].
    painFocalBone: checkin?.painFocalBone ?? boneActive,
  }
}

const CHECKIN_SCALES = [
  ['fatigue', 'Fatigue'],
  ['soreness', 'Soreness'],
  ['sleepQuality', 'Sleep quality'],
  ['mood', 'Mood'],
  ['stress', 'Stress'],
] as const

export function CheckinCard({
  date,
  checkin,
  boneActive,
  onSaved,
}: {
  date: string
  checkin: Checkin | null
  /** The engine still counts an earlier report of point tenderness on a bone. */
  boneActive: boolean
  onSaved: (message: string) => void
}) {
  const headingId = useId()
  const save = useSaveCheckin()
  const initial = draftFrom(checkin, boneActive)
  const [draft, setDraft] = useState<CheckinDraft>(initial)
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial)
  const area = draft.painArea.trim()

  return (
    <section aria-labelledby={headingId} className={styles.section}>
      <h2 id={headingId} className={styles.heading}>
        Check-in
      </h2>
      <p className={styles.caption}>
        {checkin === null
          ? 'Optional. 1 to 5, where 3 is normal. These answers come first when the plan checks readiness.'
          : 'Saved for today. Change any answer and save again.'}
      </p>
      <div className={styles.checkinFields}>
        {CHECKIN_SCALES.map(([key, legend]) => (
          <ScalePicker
            key={key}
            legend={legend}
            min={1}
            max={5}
            value={draft[key]}
            onChange={(value) => {
              setDraft({ ...draft, [key]: value })
            }}
          />
        ))}
        <label className={styles.checkLabel}>
          <input
            type="checkbox"
            checked={draft.illness}
            onChange={(event) => {
              setDraft({ ...draft, illness: event.target.checked })
            }}
          />
          Feeling ill
        </label>
        <ScalePicker
          legend="Pain today"
          min={0}
          max={10}
          value={draft.painScore}
          onChange={(painScore) => {
            setDraft({ ...draft, painScore })
          }}
          hint="0 is none, 10 is the worst."
        />
        <div className={styles.areaField}>
          <label htmlFor={`${headingId}-area`} className={styles.areaLabel}>
            Pain area
          </label>
          <Input
            id={`${headingId}-area`}
            value={draft.painArea}
            maxLength={80}
            onChange={(event) => {
              setDraft({ ...draft, painArea: event.target.value })
            }}
          />
        </div>
        <label className={styles.checkLabel}>
          <input
            type="checkbox"
            checked={draft.painFocalBone}
            onChange={(event) => {
              setDraft({ ...draft, painFocalBone: event.target.checked })
            }}
          />
          Point tenderness on a bone
        </label>
      </div>
      <div className={styles.actions}>
        <Button
          variant="primary"
          disabled={!dirty}
          loading={save.isPending}
          onClick={() => {
            save.mutate(
              {
                date,
                input: {
                  fatigue: draft.fatigue,
                  soreness: draft.soreness,
                  sleepQuality: draft.sleepQuality,
                  mood: draft.mood,
                  stress: draft.stress,
                  illness: draft.illness,
                  painScore: draft.painScore,
                  painArea: area === '' ? null : area,
                  painFocalBone: draft.painFocalBone,
                },
              },
              {
                onSuccess: () => {
                  onSaved('Check-in saved')
                },
              },
            )
          }}
        >
          Save check-in
        </Button>
      </div>
      {save.isError ? (
        <p role="alert" className={styles.error}>
          {`Check-in not saved. ${save.error instanceof ApiError ? save.error.message : 'Something went wrong.'} Try again.`}
        </p>
      ) : null}
    </section>
  )
}
