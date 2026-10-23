import { useEffect, useRef, useState, type FormEvent } from 'react'
import { fuelTotals } from '../../../shared/domain/fuel.ts'
import { runIsHot } from '../../../shared/engine/fuel.ts'
import { fluidReferenceNote, loggedTotalText } from '../../../shared/engine/fuelCopy.ts'
import type { RunWeather } from '../../../shared/engine/types.ts'
import type { FuelLabView, FuelLogView } from '../../../shared/types.ts'
import { useSaveFuelLog, useSkipFuelLog } from '../../api/fuel.ts'
import { Button } from '../Button.tsx'
import { Field, Input } from '../Field.tsx'
import { useToast } from '../Toast.tsx'
import { EahCard } from './EahCard.tsx'
import {
  clearDraft,
  fluidText,
  itemFromSnapshot,
  parseFluid,
  readDraft,
  stateFromLog,
  toBody,
  withFood,
  withOneLess,
  withOneMore,
  withoutItem,
  writeDraft,
  type FormState,
} from './fuelForm.ts'
import { fuelText } from './fuelText.ts'
import styles from './FuelLogForm.module.css'
import { ProductPicker } from './ProductPicker.tsx'
import { SymptomScale } from './SymptomScale.tsx'

export interface FuelLogFormProps {
  activityId: string
  /** Elapsed seconds of the run, not moving seconds: eating happens at stops. */
  elapsedSec: number
  /** The weather the run has; null or no temperature while it has not loaded. */
  weather: RunWeather | null
  lab: FuelLabView
  /** The run's log, to edit; null for a run with none. */
  log: FuelLogView | null
  /** The log was saved, or the run was marked "not this time". */
  onDone: () => void
}

/**
 * The 20-second log (design 10.6): the products taken, a live total against the target, fluid, the
 * gut score (required) and nausea (optional), whether it was hot, and Save or "Not this time".
 * Every control is a chip or a step, so a first log needs no keyboard. Nothing is written until
 * Save; what is entered is kept on this device until then. A sheet hosts it (`FuelLogSheet`).
 */
export function FuelLogForm({
  activityId,
  elapsedSec,
  weather,
  lab,
  log,
  onDone,
}: FuelLogFormProps) {
  const toast = useToast()
  const save = useSaveFuelLog()
  const skip = useSkipFuelLog()
  const formRef = useRef<HTMLFormElement>(null)
  const gutRef = useRef<HTMLDivElement>(null)
  const fluidRef = useRef<HTMLInputElement>(null)
  const dirty = useRef(false)
  const [state, setState] = useState<FormState>(() => readDraft(activityId) ?? stateFromLog(log))
  const [attempted, setAttempted] = useState(false)

  function change(update: (current: FormState) => FormState): void {
    dirty.current = true
    setState(update)
  }

  useEffect(() => {
    if (dirty.current) writeDraft(activityId, state)
  }, [activityId, state])

  // The sheet focuses its first control when it opens. When the data arrived after that, focus is
  // still on the dialog itself, so it goes to the first control here.
  useEffect(() => {
    if (document.activeElement?.getAttribute('role') === 'dialog') {
      formRef.current?.querySelector<HTMLElement>('button, input')?.focus()
    }
  }, [])

  const live = new Set(lab.products.map((product) => product.id))
  // The logs of other runs: the last one with products is what "Same as last long run" repeats,
  // and the fluid amounts of the recent ones are the runner's own chips.
  const others = lab.history.filter((row) => row.log.activityId !== activityId && !row.log.skipped)
  const last = others.find((row) => row.log.items.length > 0)?.log ?? null
  const fluidChips = [
    ...new Set(others.flatMap((row) => (row.log.fluidMl === null ? [] : [row.log.fluidMl]))),
  ].slice(0, 3)

  // The target is the rung this run was tried at: its log's, else the one the ladder stands on.
  const rung =
    log === null || log.skipped ? lab.ladder.rungs[lab.ladder.currentIndex] : log.step.rung
  const total = loggedTotalText({
    carbsG: fuelTotals(state.items).carbsG,
    elapsedSec,
    target: rung === undefined ? null : { gPerH: rung.gPerH, range: rung.range },
  })
  const fluid = parseFluid(state.fluid)
  const fluidNote = typeof fluid === 'number' ? fluidReferenceNote(fluid, elapsedSec) : null

  const weatherKnown = weather !== null && weather.tempC !== null
  const derivedHot = runIsHot(weather, null)
  const hotShown = state.hot ?? derivedHot

  const gutError = attempted && state.gut === null ? fuelText.gutRequired() : undefined

  function toggleHot(): void {
    const next = !hotShown
    // Answering the way the weather already says is the same as not answering.
    change((current) => ({ ...current, hot: next === derivedHot ? null : next }))
  }

  function submit(): void {
    setAttempted(true)
    if (state.gut === null) {
      gutRef.current?.querySelector<HTMLElement>('[role="radio"]')?.focus()
      return
    }
    if (fluid === 'invalid') {
      fluidRef.current?.focus()
      return
    }
    const body = toBody(state, state.gut, fluid, live, {
      sodiumMg: log?.sodiumMg ?? null,
      notes: log?.notes ?? null,
    })
    // The saved run leaves the Today prompts, which can unmount this form before a per-call
    // callback would run; the promise settles anyway.
    save.mutateAsync({ activityId, body }).then(
      (result) => {
        clearDraft(activityId)
        toast.show(result.message ?? fuelText.saved())
        onDone()
      },
      () => {
        // The failure shows in the form's alert, and the entries stay.
      },
    )
  }

  function notThisTime(): void {
    skip.mutateAsync(activityId).then(
      (result) => {
        clearDraft(activityId)
        if (result.message !== null) toast.show(result.message)
        onDone()
      },
      () => {
        // The failure shows in the form's alert.
      },
    )
  }

  function onSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    submit()
  }

  const failure = save.isError
    ? fuelText.notSaved(save.error.message)
    : skip.isError
      ? fuelText.notMarked(skip.error.message)
      : null

  return (
    <form
      ref={formRef}
      className={styles.form}
      aria-label={fuelText.logHeading()}
      noValidate
      onSubmit={onSubmit}
    >
      <ProductPicker
        products={lab.products}
        state={state}
        canRepeat={last !== null}
        total={state.items.length === 0 ? null : total}
        onRepeat={() => {
          if (last === null) return
          change((current) => ({
            ...current,
            items: last.items.map(itemFromSnapshot),
            fluid: fluidText(last.fluidMl),
          }))
        }}
        onAdd={(product) => {
          change((current) => withOneMore(current, product))
        }}
        onRemove={(product) => {
          change((current) => withOneLess(current, product))
        }}
        onAddFood={(food) => {
          change((current) => withFood(current, food))
        }}
        onRemoveFood={(food) => {
          change((current) => withoutItem(current, food))
        }}
      />

      <fieldset className={styles.group}>
        <legend>{fuelText.fluidLegend()}</legend>
        {fluidChips.length === 0 ? null : (
          <div className={styles.chips}>
            {fluidChips.map((ml) => (
              <button
                key={ml}
                type="button"
                className={styles.choice}
                aria-pressed={fluid === ml}
                onClick={() => {
                  change((current) => ({ ...current, fluid: fluidText(ml) }))
                }}
              >
                {fuelText.fluidChip(ml)}
              </button>
            ))}
          </div>
        )}
        <Field
          label={fuelText.fluidInput()}
          hint={fuelText.fluidHint()}
          error={fluid === 'invalid' ? fuelText.fluidInvalid() : undefined}
        >
          {(a) => (
            <Input
              {...a}
              ref={fluidRef}
              type="number"
              inputMode="numeric"
              min={0}
              step={1}
              value={state.fluid}
              onChange={(event) => {
                change((current) => ({ ...current, fluid: event.target.value }))
              }}
            />
          )}
        </Field>
        {fluidNote === null ? null : <p className={styles.note}>{fluidNote}</p>}
      </fieldset>

      <div ref={gutRef}>
        <SymptomScale
          legend={fuelText.gutLegend()}
          hint={fuelText.gutHint()}
          value={state.gut}
          error={gutError}
          onChange={(gut) => {
            change((current) => ({ ...current, gut }))
          }}
        />
      </div>
      <SymptomScale
        legend={fuelText.nauseaLegend()}
        value={state.nausea}
        onChange={(nausea) => {
          change((current) => ({ ...current, nausea }))
        }}
      />

      <div className={styles.group}>
        <div className={styles.chips}>
          <button
            type="button"
            className={styles.choice}
            aria-pressed={hotShown}
            onClick={toggleHot}
          >
            {fuelText.hot()}
          </button>
        </div>
        {state.hot !== null ? null : !weatherKnown ? (
          <p className={styles.muted}>{fuelText.weatherMissing()}</p>
        ) : derivedHot ? (
          <p className={styles.muted}>{fuelText.weatherHot()}</p>
        ) : null}
      </div>

      <EahCard card={lab.eah} />

      <div className={styles.actions}>
        {failure === null ? null : (
          <p role="alert" className={styles.error}>
            {failure}
          </p>
        )}
        <div className={styles.buttons}>
          <Button type="submit" variant="primary" loading={save.isPending}>
            {fuelText.save()}
          </Button>
          {/* A run that already has an answer cannot be marked "not this time" over it. */}
          {log === null ? (
            <Button variant="quiet" loading={skip.isPending} onClick={notThisTime}>
              {fuelText.skip()}
            </Button>
          ) : null}
        </div>
      </div>
    </form>
  )
}
