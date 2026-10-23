import { useId, useRef, useState, type FormEvent } from 'react'
import { advancedLockedMessage } from '../../../shared/engine/fuelCopy.ts'
import type { FuelSettings } from '../../../shared/types.ts'
import { fieldErrors } from '../../api/client.ts'
import { useSaveFuelSettings } from '../../api/fuel.ts'
import { Button } from '../Button.tsx'
import { useToast } from '../Toast.tsx'
import { labText } from './fuelText.ts'
import styles from './FuelLab.module.css'

export interface FuelSettingsFormProps {
  /** The switches the server keeps. The page remounts the form when they change. */
  settings: FuelSettings
}

/**
 * The four switches: the first higher tier, the highest tier (which opens only after a run at the
 * first one went well), the gut-training block and a diagnosed gut condition, which turns the
 * others off. The ladder follows a saved switch at once; the block reaches the plan at the next
 * weekly re-plan. The form shows the values the server keeps, and what the runner has ticked until
 * Save.
 *
 * While the highest tier is closed, the sentence that says when it opens stands beside its box;
 * it is the sentence the server answers with when the box is saved ticked too early (the 400 on
 * `optInAdvanced`), so the refusal needs no second message: the box goes back to unticked and takes
 * focus, which reads the sentence out.
 */
export function FuelSettingsForm({ settings }: FuelSettingsFormProps) {
  const headingId = useId()
  const hintId = useId()
  const advancedId = useId()
  const giId = useId()
  const advancedBox = useRef<HTMLInputElement>(null)
  const toast = useToast()
  const save = useSaveFuelSettings()
  const [draft, setDraft] = useState<FuelSettings>(settings)
  const [failure, setFailure] = useState<string | null>(null)

  /** A gut condition turns the others off, and the highest tier needs the first one. */
  function change(next: Partial<FuelSettings>): void {
    setDraft((current) => {
      const merged = { ...current, ...next }
      if (merged.giDisease) {
        return { optIn90: false, optInAdvanced: false, giDisease: true, gutBlock: false }
      }
      return { ...merged, optInAdvanced: merged.optIn90 && merged.optInAdvanced }
    })
  }

  function submit(event: FormEvent): void {
    event.preventDefault()
    setFailure(null)
    save.mutateAsync(draft).then(
      () => {
        toast.show(labText.settingsSaved())
      },
      (error: unknown) => {
        if (fieldErrors(error)['optInAdvanced'] !== undefined) {
          setDraft((current) => ({ ...current, optInAdvanced: false }))
          advancedBox.current?.focus()
          return
        }
        setFailure(labText.settingsNotSaved(error instanceof Error ? error.message : ''))
      },
    )
  }

  const advancedClosed = !draft.optIn90 || draft.giDisease
  return (
    <section aria-labelledby={headingId} className={styles.section}>
      <h2 id={headingId} className={styles.heading}>
        {labText.settingsHeading()}
      </h2>
      <form className={styles.fields} onSubmit={submit} aria-label={labText.settingsLegend()}>
        <label className={styles.check}>
          <input
            type="checkbox"
            checked={draft.optIn90}
            disabled={draft.giDisease}
            aria-describedby={hintId}
            onChange={(event) => {
              change({ optIn90: event.target.checked })
            }}
          />
          <span>{labText.opt90()}</span>
        </label>
        <p id={hintId} className={styles.note}>
          {labText.optHint()}
        </p>
        <label className={styles.check}>
          <input
            ref={advancedBox}
            type="checkbox"
            checked={draft.optInAdvanced}
            disabled={advancedClosed}
            aria-describedby={draft.optInAdvanced ? undefined : advancedId}
            onChange={(event) => {
              change({ optInAdvanced: event.target.checked })
            }}
          />
          <span>{labText.optAdvanced()}</span>
        </label>
        {draft.optInAdvanced ? null : (
          <p id={advancedId} className={styles.note}>
            {advancedLockedMessage()}
          </p>
        )}
        <label className={styles.check}>
          <input
            type="checkbox"
            checked={draft.gutBlock}
            disabled={draft.giDisease}
            onChange={(event) => {
              change({ gutBlock: event.target.checked })
            }}
          />
          <span>{labText.gutBlock()}</span>
        </label>
        <label className={styles.check}>
          <input
            type="checkbox"
            checked={draft.giDisease}
            aria-describedby={giId}
            onChange={(event) => {
              change({ giDisease: event.target.checked })
            }}
          />
          <span>{labText.giDisease()}</span>
        </label>
        <p id={giId} className={styles.note}>
          {labText.giHint()}
        </p>
        <p className={styles.note}>{labText.settingsNote()}</p>
        {failure === null ? null : (
          <p role="alert" className={styles.error}>
            {failure}
          </p>
        )}
        <div className={styles.actions}>
          <Button type="submit" variant="primary" loading={save.isPending}>
            {labText.settingsSave()}
          </Button>
        </div>
      </form>
    </section>
  )
}
