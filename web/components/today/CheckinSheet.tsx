import { useId, useState, type FormEvent, type ReactNode } from 'react'
import { render } from '../../../shared/copy/template.ts'
import { TEMPLATES } from '../../../shared/copy/templates.ts'
import type { Checkin, Units } from '../../../shared/types.ts'
import { useSaveCheckin } from '../../api/checkins.ts'
import { Button } from '../Button.tsx'
import { Input } from '../Field.tsx'
import { ScalePicker } from '../ScalePicker.tsx'
import { Sheet } from '../Sheet.tsx'
import styles from './CheckinSheet.module.css'

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

export interface CheckinSheetProps {
  date: string
  /** What is known for the day: the saved check-in with anything still queued laid over it. */
  checkin: Checkin | null
  /** The engine still counts an earlier report of point tenderness on a bone. */
  boneActive: boolean
  /** Which part comes first, and so takes focus: the five scales, or pain and illness. */
  lead: 'feel' | 'hurt'
  units: Units
  onClose: () => void
  /**
   * Called once the write is kept: `sent` when the server has it, `queued` when it waits. It is
   * given the fatigue answer the sheet saved, which the row shows while the server catches up.
   */
  onSaved: (result: 'sent' | 'queued', fatigue: number | null) => void
}

/**
 * The whole check-in in a sheet: the five 1 to 5 scales, then illness, pain, its area and point
 * tenderness on a bone. It opens from the one-tap row ("Add more", "Something hurts, or I'm
 * ill"), starts from the answers already given, and saves through the outbox, so it also works
 * with no connection. Bone tenderness starts ticked while the engine still counts an earlier
 * report, and is sent as false only after the runner unticks it. Targets are 44 px or more.
 */
export function CheckinSheet({
  date,
  checkin,
  boneActive,
  lead,
  units,
  onClose,
  onSaved,
}: CheckinSheetProps) {
  const formId = useId()
  const save = useSaveCheckin()
  const initial = draftFrom(checkin, boneActive)
  const [draft, setDraft] = useState<CheckinDraft>(initial)
  const [reason, setReason] = useState<string | null>(null)
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial)
  const area = draft.painArea.trim()

  function submit(event: FormEvent) {
    event.preventDefault()
    setReason(null)
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
        onSuccess: (result) => {
          if (result.status === 'rejected') setReason(result.reason)
          else onSaved(result.status, draft.fatigue)
        },
        onError: () => {
          setReason('Something went wrong.')
        },
      },
    )
  }

  const feel: ReactNode = (
    <section key="feel" aria-labelledby={`${formId}-feel`} className={styles.section}>
      <h3 id={`${formId}-feel`} className={styles.heading}>
        How you feel
      </h3>
      <p className={styles.caption}>
        {render(
          TEMPLATES[checkin === null ? 'today.checkin.sheet-new' : 'today.checkin.sheet-saved'],
          {},
          units,
        )}
      </p>
      {CHECKIN_SCALES.map(([key, legend]) => (
        <ScalePicker
          key={key}
          legend={legend}
          min={1}
          max={5}
          value={draft[key]}
          touch
          onChange={(value) => {
            setDraft({ ...draft, [key]: value })
          }}
        />
      ))}
    </section>
  )

  const hurt: ReactNode = (
    <section key="hurt" aria-labelledby={`${formId}-hurt`} className={styles.section}>
      <h3 id={`${formId}-hurt`} className={styles.heading}>
        Pain and illness
      </h3>
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
        touch
        onChange={(painScore) => {
          setDraft({ ...draft, painScore })
        }}
        hint={render(TEMPLATES['today.checkin.pain-hint'], {}, units)}
      />
      <div className={styles.areaField}>
        <label htmlFor={`${formId}-area`} className={styles.areaLabel}>
          Pain area
        </label>
        <Input
          id={`${formId}-area`}
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
    </section>
  )

  return (
    <Sheet
      open
      onClose={onClose}
      title="Check-in"
      footer={
        <Button
          type="submit"
          form={formId}
          variant="primary"
          disabled={!dirty}
          loading={save.isPending}
        >
          Save check-in
        </Button>
      }
    >
      <form id={formId} onSubmit={submit} noValidate className={styles.form}>
        {lead === 'hurt' ? [hurt, feel] : [feel, hurt]}
        {reason === null ? null : (
          <p role="alert" className={styles.notice}>
            {render(TEMPLATES['today.checkin.not-saved'], { reason }, units)}
          </p>
        )}
      </form>
    </Sheet>
  )
}
