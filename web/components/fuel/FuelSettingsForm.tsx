import { useId, useRef, useState, type FormEvent } from 'react'
import { normalisedFuelSettings } from '../../../shared/domain/fuel.ts'
import { advancedLockedMessage } from '../../../shared/engine/fuelCopy.ts'
import type { LadderResult } from '../../../shared/engine/types.ts'
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
  /** The replayed ladder; its rungs say whether the highest tier has been earned. */
  ladder: Pick<LadderResult, 'rungs'>
}

/**
 * The four switches: the first higher tier, the highest tier (which opens only after a run at the
 * first one went well), the gut-training block and a diagnosed gut condition, which turns the
 * others off. The ladder follows a saved switch at once; the block reaches the plan at the next
 * weekly re-plan. The form shows the values the server keeps, and what the runner has ticked until
 * Save.
 *
 * While the ladder shows the highest rungs as not open yet, the sentence that says when they open
 * stands beside the box, and describes it; once the ladder has earned them it is gone. It is the
 * sentence the server answers with when the box is saved ticked too early (the 400 on
 * `optInAdvanced`), and it also appears after such a refusal, whatever the ladder showed. The
 * refusal drops nothing else: the other switches are saved with the highest tier off, and the
 * toast says so in one sentence. When there is nothing else to save, the box goes back to unticked
 * and takes focus, which reads the sentence out.
 */
export function FuelSettingsForm({ settings, ladder }: FuelSettingsFormProps) {
  const headingId = useId()
  const hintId = useId()
  const advancedId = useId()
  const giId = useId()
  const advancedBox = useRef<HTMLInputElement>(null)
  const toast = useToast()
  const save = useSaveFuelSettings()
  const [draft, setDraft] = useState<FuelSettings>(settings)
  const [failure, setFailure] = useState<string | null>(null)
  // The server refused the highest tier on the last save: its sentence stands beside the box.
  const [refused, setRefused] = useState(false)

  /** A gut condition turns the others off, and the highest tier needs the first one. */
  function change(next: Partial<FuelSettings>): void {
    setDraft((current) => normalisedFuelSettings({ ...current, ...next }))
  }

  function notSaved(error: unknown): void {
    setFailure(labText.settingsNotSaved(error instanceof Error ? error.message : ''))
  }

  /**
   * The highest tier was refused, and the server stored nothing from that request. The rest of the
   * draft is saved with the tier off, and the toast says so; with nothing else to save, the box
   * goes back to unticked and takes focus.
   */
  function saveWithoutHighest(): void {
    const rest: FuelSettings = { ...draft, optInAdvanced: false }
    setDraft(rest)
    setRefused(true)
    if (
      rest.optIn90 === settings.optIn90 &&
      rest.optInAdvanced === settings.optInAdvanced &&
      rest.giDisease === settings.giDisease &&
      rest.gutBlock === settings.gutBlock
    ) {
      advancedBox.current?.focus()
      return
    }
    save.mutateAsync(rest).then(() => {
      toast.show(labText.settingsSavedWithoutHighest())
    }, notSaved)
  }

  function submit(event: FormEvent): void {
    event.preventDefault()
    setFailure(null)
    setRefused(false)
    save.mutateAsync(draft).then(
      () => {
        toast.show(labText.settingsSaved())
      },
      (error: unknown) => {
        if (fieldErrors(error)['optInAdvanced'] === undefined) notSaved(error)
        else saveWithoutHighest()
      },
    )
  }

  const advancedClosed = !draft.optIn90 || draft.giDisease
  // A gut condition holds the ladder at the floor, so the highest rungs are not earned either.
  const highestLocked = ladder.rungs.some(
    (rung) => rung.state === 'opens-after-second-tier' || rung.state === 'gut-condition',
  )
  const showLocked = !draft.optInAdvanced && (highestLocked || refused)
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
            aria-describedby={showLocked ? advancedId : undefined}
            onChange={(event) => {
              change({ optInAdvanced: event.target.checked })
            }}
          />
          <span>{labText.optAdvanced()}</span>
        </label>
        {showLocked ? (
          <p id={advancedId} className={styles.note}>
            {advancedLockedMessage()}
          </p>
        ) : null}
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
