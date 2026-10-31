import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
  type RefObject,
} from 'react'
import { anchorEstimate } from '../../../shared/engine/strength.ts'
import { countPhrase } from '../../../shared/copy/quantity.ts'
import { exerciseById, type ExerciseId } from '../../../shared/domain/strengthLibrary.ts'
import { P } from '../../../shared/engine/params/index.ts'
import { STRENGTH_LOAD_LIST_MAX } from '../../../shared/limits.ts'
import type {
  PinnedSlot,
  Slot,
  StrengthLift,
  StrengthSettings,
  StrengthView,
  Units,
  WeightUnit,
} from '../../../shared/types.ts'
import { useUpdateSettings } from '../../api/settings.ts'
import {
  useDeleteStrengthLift,
  useSaveStrengthLift,
  useSaveStrengthSettings,
} from '../../api/strength.ts'
import { Button } from '../Button.tsx'
import { Field, Input, Select, Textarea } from '../Field.tsx'
import { ScalePicker } from '../ScalePicker.tsx'
import { Segmented } from '../Segmented.tsx'
import { Sheet } from '../Sheet.tsx'
import { useToast } from '../Toast.tsx'
import {
  EMPTY_ANCHOR,
  EQUIPMENT_KINDS,
  NOTE_MAX,
  PIN_SLOTS,
  anchorBody,
  anchorEstimateOf,
  anchorExercises,
  anchorImplement,
  bodyOfExercises,
  equipmentOfForm,
  formOfEquipment,
  formOfExercises,
  leaveOutChoices,
  pinChoices,
  toggleAvoid,
  withPin,
  type Amount,
  type AnchorForm,
  type AnchorProblems,
  type EquipmentForm,
  type EquipmentProblem,
  type EquipmentProblems,
  type LoadsDraft,
  type LoadsMode,
  type SetupPart,
} from './setupForm.ts'
import { REPS_LEFT_MAX } from './strengthForm.ts'
import { pageWords, type PageWords } from './strengthPageText.ts'
import { loadMeaningLine } from './strengthText.ts'
import styles from './SetupSheets.module.css'

export interface StrengthSetupSheetProps {
  part: SetupPart
  /** The page's view: the saved setup and starting points. Read again after every save. */
  view: StrengthView
  weightUnit: WeightUnit
  units: Units
  onClose: () => void
}

/** The runner's own slots in the order the leave-out list shows them. */
const SLOT_ORDER: readonly Slot[] = ['knee', 'hip', 'calf', 'plyo', 'trunk']

const PART_TITLE = {
  unit: 'strength.page.part-unit',
  equipment: 'strength.page.part-equipment',
  history: 'strength.page.part-history',
  exercises: 'strength.page.part-exercises',
  anchors: 'strength.page.part-anchors',
} as const

interface PartProps {
  words: PageWords
  view: StrengthView
  weightUnit: WeightUnit
  onClose: () => void
}

/** What a failed save says: the server's own reason inside the app's sentence. */
function failure(words: PageWords, error: unknown): string {
  const reason = error instanceof Error ? error.message : ''
  return words.say('strength.page.save-error', { reason })
}

interface SaveBarProps {
  words: PageWords
  /** The button's words; "Save" unless the sheet saves one thing at a time. */
  label?: string
  pending: boolean
  /** The failure of the last save, already worded; null when there is none. */
  error: string | null
  /** The fields are marked and the save did not go out. */
  checking: boolean
}

/** Save, kept above the safe area while a long sheet scrolls, with what went wrong. */
function SaveBar({ words, label, pending, error, checking }: SaveBarProps) {
  return (
    <div className={styles.actions}>
      {checking ? (
        <p role="alert" className={styles.alert}>
          {words.say('strength.page.err-check')}
        </p>
      ) : null}
      {error === null ? null : (
        <p role="alert" className={styles.alert}>
          {error}
        </p>
      )}
      <div>
        <Button type="submit" variant="primary" loading={pending}>
          {label ?? words.say('strength.page.save')}
        </Button>
      </div>
    </div>
  )
}

/** Moves focus to the first field a save found wrong. */
function useFocusFirstInvalid(form: RefObject<HTMLFormElement | null>, problems: unknown): void {
  useEffect(() => {
    if (problems !== null) {
      form.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()
    }
  }, [form, problems])
}

// ---- Part 1: the weight unit -------------------------------------------------------------------

function UnitPart({ words, weightUnit, onClose }: PartProps) {
  const update = useUpdateSettings()
  const toast = useToast()
  const [unit, setUnit] = useState(weightUnit)

  function submit(event: FormEvent): void {
    event.preventDefault()
    if (unit === weightUnit) {
      onClose()
      return
    }
    update.mutateAsync({ weightUnit: unit }).then(
      () => {
        toast.show(words.say('strength.page.unit-saved'))
        onClose()
      },
      () => {
        // the failure shows in the sheet, and the choice stays
      },
    )
  }

  return (
    <form className={styles.form} onSubmit={submit} noValidate>
      <p className={styles.lead}>{words.say('strength.page.unit-lead')}</p>
      <Segmented<WeightUnit>
        label={words.say('strength.page.weight-units')}
        value={unit}
        onChange={setUnit}
        options={[
          { value: 'lb', label: words.say('strength.page.unit-pounds') },
          { value: 'kg', label: words.say('strength.page.unit-kilograms') },
        ]}
      />
      <SaveBar
        words={words}
        pending={update.isPending}
        error={update.isError ? failure(words, update.error) : null}
        checking={false}
      />
    </form>
  )
}

// ---- Part 2: the equipment ---------------------------------------------------------------------

interface AmountFieldProps {
  label: string
  hint?: string
  error?: string
  value: Amount
  onChange: (next: Amount) => void
}

/** A weight field: decimal keyboard, the text kept as typed. */
function AmountField({ label, hint, error, value, onChange }: AmountFieldProps) {
  return (
    <Field label={label} hint={hint} error={error}>
      {(control) => (
        <Input
          {...control}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          value={value.text}
          onChange={(event) => {
            onChange({ text: event.target.value })
          }}
        />
      )}
    </Field>
  )
}

interface EquipmentFieldsProps {
  words: PageWords
  form: EquipmentForm
  problems: EquipmentProblems | null
  unitName: string
  onChange: (update: (current: EquipmentForm) => EquipmentForm) => void
}

function problemText(words: PageWords, problem: EquipmentProblem | undefined): string | undefined {
  if (problem === undefined) return undefined
  return words.say(
    `strength.page.err-${problem}`,
    problem === 'list-long' ? { max: words.count(STRENGTH_LOAD_LIST_MAX) } : {},
  )
}

/** The weights of dumbbells or kettlebells: a range and a step, or a list. */
function LoadsFields({
  words,
  kind,
  draft,
  problems,
  unitName,
  onChange,
}: {
  words: PageWords
  kind: 'dumbbells' | 'kettlebells'
  draft: LoadsDraft
  problems: EquipmentProblems | null
  unitName: string
  onChange: (update: (current: LoadsDraft) => LoadsDraft) => void
}) {
  const problem = (field: string) => problemText(words, problems?.[kind + '.' + field])
  return (
    <div className={styles.fields}>
      <Segmented<LoadsMode>
        label={words.say('strength.page.eq-mode')}
        value={draft.mode}
        onChange={(mode) => {
          onChange((current) => ({ ...current, mode }))
        }}
        options={[
          { value: 'range', label: words.say('strength.page.eq-mode-range') },
          { value: 'list', label: words.say('strength.page.eq-mode-list') },
        ]}
      />
      {draft.mode === 'range' ? (
        <>
          <AmountField
            label={words.say('strength.page.eq-first', { unit: unitName })}
            error={problem('first')}
            value={draft.first}
            onChange={(first) => {
              onChange((current) => ({ ...current, first }))
            }}
          />
          <AmountField
            label={words.say('strength.page.eq-last', { unit: unitName })}
            hint={words.say('strength.page.eq-last-hint')}
            error={problem('last')}
            value={draft.last}
            onChange={(last) => {
              onChange((current) => ({ ...current, last }))
            }}
          />
          <AmountField
            label={words.say('strength.page.eq-step', { unit: unitName })}
            error={problem('step')}
            value={draft.step}
            onChange={(step) => {
              onChange((current) => ({ ...current, step }))
            }}
          />
        </>
      ) : (
        <Field
          label={words.say('strength.page.eq-list', { unit: unitName })}
          hint={words.say('strength.page.eq-list-hint')}
          error={problem('list')}
        >
          {(control) => (
            <Input
              {...control}
              type="text"
              // the list is separated by commas, which a decimal keypad has not got
              inputMode="text"
              autoComplete="off"
              value={draft.list.text}
              onChange={(event) => {
                onChange((current) => ({ ...current, list: { text: event.target.value } }))
              }}
            />
          )}
        </Field>
      )}
    </div>
  )
}

/** The checklist of design 6.2: each item ticked and, where it needs one, its detail. */
function EquipmentFields({ words, form, problems, unitName, onChange }: EquipmentFieldsProps) {
  const problem = (key: string) => problemText(words, problems?.[key])
  return (
    <>
      {EQUIPMENT_KINDS.map((kind) => {
        const on = form[kind].on
        return (
          <div key={kind} className={styles.item}>
            <label className={styles.check}>
              <input
                type="checkbox"
                checked={on}
                onChange={(event) => {
                  const checked = event.target.checked
                  onChange((current) => ({
                    ...current,
                    [kind]: { ...current[kind], on: checked },
                  }))
                }}
              />
              <span>{words.kind(kind)}</span>
            </label>
            {on && kind === 'barbell' ? (
              <div className={styles.fields}>
                <AmountField
                  label={words.say('strength.page.eq-bar', { unit: unitName })}
                  error={problem('barbell.bar')}
                  value={form.barbell.bar}
                  onChange={(bar) => {
                    onChange((current) => ({ ...current, barbell: { ...current.barbell, bar } }))
                  }}
                />
                <AmountField
                  label={words.say('strength.page.eq-jump', { unit: unitName })}
                  hint={words.say('strength.page.eq-jump-hint')}
                  error={problem('barbell.jump')}
                  value={form.barbell.jump}
                  onChange={(jump) => {
                    onChange((current) => ({ ...current, barbell: { ...current.barbell, jump } }))
                  }}
                />
              </div>
            ) : null}
            {on && (kind === 'dumbbells' || kind === 'kettlebells') ? (
              <LoadsFields
                words={words}
                kind={kind}
                draft={form[kind]}
                problems={problems}
                unitName={unitName}
                onChange={(update) => {
                  onChange((current) => ({ ...current, [kind]: update(current[kind]) }))
                }}
              />
            ) : null}
            {on && (kind === 'leg-press' || kind === 'calf-machine' || kind === 'leg-curl') ? (
              <div className={styles.fields}>
                <AmountField
                  label={words.say('strength.page.eq-machine-step', { unit: unitName })}
                  error={problem(kind + '.step')}
                  value={form[kind].step}
                  onChange={(step) => {
                    onChange((current) => ({ ...current, [kind]: { ...current[kind], step } }))
                  }}
                />
                <AmountField
                  label={words.say('strength.page.eq-machine-top', { unit: unitName })}
                  error={problem(kind + '.max')}
                  value={form[kind].max}
                  onChange={(max) => {
                    onChange((current) => ({ ...current, [kind]: { ...current[kind], max } }))
                  }}
                />
              </div>
            ) : null}
          </div>
        )
      })}
    </>
  )
}

function EquipmentPart({ words, view, weightUnit, onClose }: PartProps) {
  const save = useSaveStrengthSettings()
  const toast = useToast()
  const formRef = useRef<HTMLFormElement>(null)
  const [form, setForm] = useState(() => formOfEquipment(view.settings.equipment, weightUnit))
  const [problems, setProblems] = useState<EquipmentProblems | null>(null)
  useFocusFirstInvalid(formRef, problems)

  function submit(event: FormEvent): void {
    event.preventDefault()
    const built = equipmentOfForm(form, weightUnit)
    if (!built.ok) {
      setProblems(built.problems)
      return
    }
    setProblems(null)
    save.mutateAsync({ equipment: built.equipment }).then(
      () => {
        toast.show(words.say('strength.page.saved'))
        onClose()
      },
      () => {
        // the failure shows in the sheet, and the entries stay
      },
    )
  }

  return (
    <form ref={formRef} className={styles.form} onSubmit={submit} noValidate>
      <p className={styles.lead}>{words.say('strength.page.equipment-lead')}</p>
      <EquipmentFields
        words={words}
        form={form}
        problems={problems}
        unitName={words.unitName()}
        onChange={(update) => {
          setForm(update)
        }}
      />
      <SaveBar
        words={words}
        pending={save.isPending}
        error={save.isError ? failure(words, save.error) : null}
        checking={problems !== null}
      />
    </form>
  )
}

// ---- Part 3: the lifting history ---------------------------------------------------------------

const LEVELS: readonly StrengthSettings['level'][] = ['new', 'some', 'experienced']

function HistoryPart({ words, view, onClose }: PartProps) {
  const save = useSaveStrengthSettings()
  const toast = useToast()
  const [level, setLevel] = useState(view.settings.level)
  const [now, setNow] = useState(view.settings.currentlyLifting)

  function submit(event: FormEvent): void {
    event.preventDefault()
    save.mutateAsync({ level, currentlyLifting: now }).then(
      () => {
        toast.show(words.say('strength.page.saved'))
        onClose()
      },
      () => {
        // the failure shows in the sheet, and the choice stays
      },
    )
  }

  return (
    <form className={styles.form} onSubmit={submit} noValidate>
      <Segmented<StrengthSettings['level']>
        label={words.say('strength.page.level-label')}
        value={level}
        hint={[words.levelHint(level)]}
        onChange={setLevel}
        options={LEVELS.map((value) => ({ value, label: words.level(value) }))}
      />
      <Segmented<'yes' | 'no'>
        label={words.say('strength.page.now-label')}
        value={now ? 'yes' : 'no'}
        hint={[words.say('strength.page.now-hint')]}
        onChange={(value) => {
          setNow(value === 'yes')
        }}
        options={[
          { value: 'yes', label: words.say('strength.page.yes') },
          { value: 'no', label: words.say('strength.page.no') },
        ]}
      />
      <SaveBar
        words={words}
        pending={save.isPending}
        error={save.isError ? failure(words, save.error) : null}
        checking={false}
      />
    </form>
  )
}

// ---- Part 4: exercises left out and always used ------------------------------------------------

function ExercisesPart({ words, view, onClose }: PartProps) {
  const save = useSaveStrengthSettings()
  const toast = useToast()
  const [form, setForm] = useState(() => formOfExercises(view.settings))
  const choices = leaveOutChoices(form)

  function submit(event: FormEvent): void {
    event.preventDefault()
    save.mutateAsync(bodyOfExercises(form)).then(
      () => {
        toast.show(words.say('strength.page.saved'))
        onClose()
      },
      () => {
        // the failure shows in the sheet, and the choices stay
      },
    )
  }

  return (
    <form className={styles.form} onSubmit={submit} noValidate>
      {PIN_SLOTS.map((slot: PinnedSlot) => {
        const options = pinChoices(slot, view.settings.equipment, form)
        return (
          <Field
            key={slot}
            label={words.say('strength.page.pin-label', { slot: words.slot(slot) })}
          >
            {(control) => (
              <Select
                {...control}
                value={form.pinned[slot] ?? ''}
                onChange={(event) => {
                  const id = event.target.value
                  setForm((current) => withPin(current, slot, id === '' ? undefined : id))
                }}
              >
                <option value="">{words.say('strength.page.pin-none')}</option>
                {options.map((id) => (
                  <option key={id} value={id}>
                    {words.name(id)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        )
      })}

      <fieldset className={styles.group}>
        <legend>{words.say('strength.page.leave-out')}</legend>
        <p className={styles.muted}>{words.say('strength.page.leave-out-hint')}</p>
        {SLOT_ORDER.map((slot) => {
          const ofSlot = choices.filter((id) => exerciseById(id)?.slot === slot)
          return ofSlot.length === 0 ? null : (
            <div key={slot} className={styles.slot}>
              <h3 className={styles.slotName}>{words.slot(slot)}</h3>
              {ofSlot.map((id: ExerciseId) => (
                <label key={id} className={styles.check}>
                  <input
                    type="checkbox"
                    checked={form.avoid.has(id)}
                    onChange={() => {
                      setForm((current) => toggleAvoid(current, id))
                    }}
                  />
                  <span>{words.name(id)}</span>
                </label>
              ))}
            </div>
          )
        })}
      </fieldset>

      <Field
        label={words.say('strength.page.note-label')}
        hint={words.say('strength.page.note-hint')}
      >
        {(control) => (
          <Textarea
            {...control}
            maxLength={NOTE_MAX}
            value={form.note}
            onChange={(event) => {
              setForm((current) => ({ ...current, note: event.target.value }))
            }}
          />
        )}
      </Field>
      <SaveBar
        words={words}
        pending={save.isPending}
        error={save.isError ? failure(words, save.error) : null}
        checking={false}
      />
    </form>
  )
}

// ---- Part 5: the starting points ---------------------------------------------------------------

/** The sentence about an estimate: of a set, of a known maximum, or none for a set too far from the limit. */
function estimateLine(
  words: PageWords,
  kind: StrengthLift['kind'],
  estimate: { estimateG: number } | 'none',
): string {
  if (estimate === 'none') {
    return words.say('strength.page.anchor-estimate-none', {
      max: words.count(P.f8.e1rmMaxReps.value),
    })
  }
  return words.say(
    kind === 'max' ? 'strength.page.anchor-estimate-max' : 'strength.page.anchor-estimate',
    { load: words.load(estimate.estimateG) },
  )
}

/** One saved starting point: what was entered, and the estimated maximum it gives. */
function AnchorRow({
  words,
  lift,
  removing,
  onRemove,
}: {
  words: PageWords
  lift: StrengthLift
  removing: boolean
  onRemove: () => void
}) {
  const exercise = words.name(lift.exerciseId)
  const estimateG = anchorEstimate(lift)
  const sentence =
    lift.kind === 'max'
      ? words.say('strength.page.anchor-row-max', { exercise, load: words.load(lift.loadG) })
      : words.say('strength.page.anchor-row-set', {
          exercise,
          load: words.load(lift.loadG),
          reps: countPhrase(lift.reps, 'rep'),
        })
  return (
    <li className={styles.anchor}>
      <div>
        <p className={styles.line}>{sentence}</p>
        <p className={styles.muted}>
          {estimateLine(words, lift.kind, estimateG === null ? 'none' : { estimateG })}
        </p>
      </div>
      <Button
        variant="quiet"
        loading={removing}
        aria-label={words.say('strength.page.anchor-remove-for', { exercise })}
        onClick={onRemove}
      >
        {words.say('strength.page.anchor-remove')}
      </Button>
    </li>
  )
}

function AnchorsPart({ words, view, weightUnit }: PartProps) {
  const save = useSaveStrengthLift()
  const remove = useDeleteStrengthLift()
  const toast = useToast()
  const [form, setForm] = useState<AnchorForm>(EMPTY_ANCHOR)
  const [problems, setProblems] = useState<AnchorProblems | null>(null)
  const exercises = useMemo(() => anchorExercises(), [])
  const estimate = anchorEstimateOf(form, weightUnit)
  // what the weight means is fixed by the implement and shown beside the field (design 5.2), in the
  // words of the logging sheet's load field
  const meaning =
    form.exerciseId === ''
      ? null
      : loadMeaningLine(
          words,
          form.exerciseId,
          anchorImplement(form.exerciseId, view.settings.equipment),
        )
  const formRef = useRef<HTMLFormElement>(null)
  useFocusFirstInvalid(formRef, problems)

  function submit(event: FormEvent): void {
    event.preventDefault()
    const built = anchorBody(form, weightUnit)
    if (!built.ok) {
      setProblems(built.problems)
      return
    }
    setProblems(null)
    save.mutateAsync({ exerciseId: built.exerciseId, body: built.body }).then(
      () => {
        toast.show(words.say('strength.page.anchor-saved'))
        setForm(EMPTY_ANCHOR)
      },
      () => {
        // the failure shows in the sheet, and the entries stay
      },
    )
  }

  const rowFailure = remove.isError ? failure(words, remove.error) : null

  return (
    <div className={styles.form}>
      {view.anchors.length === 0 ? null : (
        <section aria-label={words.say('strength.page.anchor-list')} className={styles.group}>
          <h3 className={styles.slotName}>{words.say('strength.page.anchor-list')}</h3>
          <ul className={styles.anchors}>
            {view.anchors.map((lift) => (
              <AnchorRow
                key={lift.exerciseId}
                words={words}
                lift={lift}
                removing={remove.isPending && remove.variables === lift.exerciseId}
                onRemove={() => {
                  remove.mutateAsync(lift.exerciseId).then(
                    () => {
                      toast.show(words.say('strength.page.anchor-removed'))
                    },
                    () => {
                      // the failure shows below the list
                    },
                  )
                }}
              />
            ))}
          </ul>
          {rowFailure === null ? null : (
            <p role="alert" className={styles.alert}>
              {rowFailure}
            </p>
          )}
        </section>
      )}

      <form ref={formRef} className={styles.form} onSubmit={submit} noValidate>
        <Field
          label={words.say('strength.page.anchor-exercise')}
          error={problems?.exercise === true ? words.say('strength.page.err-exercise') : undefined}
        >
          {(control) => (
            <Select
              {...control}
              value={form.exerciseId}
              onChange={(event) => {
                setForm((current) => ({ ...current, exerciseId: event.target.value }))
              }}
            >
              <option value="">{words.say('strength.page.anchor-choose')}</option>
              {exercises.map((id) => (
                <option key={id} value={id}>
                  {words.name(id)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Segmented<StrengthLift['kind']>
          label={words.say('strength.page.anchor-kind')}
          value={form.kind}
          onChange={(kind) => {
            setForm((current) => ({ ...current, kind }))
          }}
          options={[
            { value: 'set', label: words.say('strength.page.anchor-kind-set') },
            { value: 'max', label: words.say('strength.page.anchor-kind-max') },
          ]}
        />
        <Field
          label={words.say('strength.page.anchor-load', { unit: words.unitName() })}
          hint={meaning ?? undefined}
          error={problems?.load === true ? words.say('strength.page.err-weight') : undefined}
        >
          {(control) => (
            <Input
              {...control}
              type="text"
              inputMode="decimal"
              autoComplete="off"
              value={form.load}
              onChange={(event) => {
                setForm((current) => ({ ...current, load: event.target.value }))
              }}
            />
          )}
        </Field>
        {form.kind === 'set' ? (
          <>
            <Field
              label={words.say('strength.page.anchor-reps')}
              error={problems?.reps === true ? words.say('strength.page.err-reps') : undefined}
            >
              {(control) => (
                <Input
                  {...control}
                  type="text"
                  inputMode="numeric"
                  autoComplete="off"
                  value={form.reps}
                  onChange={(event) => {
                    setForm((current) => ({ ...current, reps: event.target.value }))
                  }}
                />
              )}
            </Field>
            <ScalePicker
              legend={words.say('strength.label.reps-left')}
              min={0}
              max={REPS_LEFT_MAX}
              value={form.rir}
              touch
              hint={words.say('strength.page.anchor-rir-hint')}
              onChange={(rir) => {
                setForm((current) => ({ ...current, rir }))
              }}
            />
          </>
        ) : null}
        {estimate === null ? null : (
          <p className={styles.line} role="status">
            {estimateLine(words, form.kind, estimate)}
          </p>
        )}
        <SaveBar
          words={words}
          label={words.say('strength.page.anchor-save')}
          pending={save.isPending}
          error={
            save.isError
              ? words.say('strength.page.anchor-error', { reason: save.error.message })
              : null
          }
          checking={problems !== null}
        />
      </form>
    </div>
  )
}

/**
 * One of the five setup sheets (design 6.2): the weight unit, the equipment, the lifting history,
 * the exercises left out and always used, and the starting points. Each saves its own part, so a
 * sheet can be skipped, and each can be opened again whenever the setup changes (design 6.5). The
 * sheet is lazy (`lazySheets.tsx`): mount it through that file, and only while it is open.
 */
export function StrengthSetupSheet({
  part,
  view,
  weightUnit,
  units,
  onClose,
}: StrengthSetupSheetProps) {
  const words = useMemo(() => pageWords(units, weightUnit), [units, weightUnit])
  const common = { words, view, weightUnit, onClose }
  let body: ReactNode
  switch (part) {
    case 'unit':
      body = <UnitPart {...common} />
      break
    case 'equipment':
      body = <EquipmentPart {...common} />
      break
    case 'history':
      body = <HistoryPart {...common} />
      break
    case 'exercises':
      body = <ExercisesPart {...common} />
      break
    case 'anchors':
      body = <AnchorsPart {...common} />
      break
  }
  return (
    <Sheet open onClose={onClose} title={words.say(PART_TITLE[part])}>
      {body}
    </Sheet>
  )
}
