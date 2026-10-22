import { useState, type FormEvent } from 'react'
import type {
  AthleteProfile,
  Availability,
  Injury,
  Terrain,
  Units,
  Weekday,
} from '../../shared/types.ts'
import { formatDuration, milesToM } from '../../shared/units.ts'
import { fieldErrors } from '../api/client.ts'
import { useProfile, useUpdateProfile } from '../api/profile.ts'
import { useSettings } from '../api/settings.ts'
import { Button } from '../components/Button.tsx'
import { Field, Input, Select } from '../components/Field.tsx'
import { PageHeader } from '../components/PageHeader.tsx'
import { Segmented } from '../components/Segmented.tsx'
import { useToast } from '../components/Toast.tsx'
import styles from './ProfilePage.module.css'

const WEEKDAYS: Array<{ value: Weekday; label: string }> = [
  { value: 'mon', label: 'Monday' },
  { value: 'tue', label: 'Tuesday' },
  { value: 'wed', label: 'Wednesday' },
  { value: 'thu', label: 'Thursday' },
  { value: 'fri', label: 'Friday' },
  { value: 'sat', label: 'Saturday' },
  { value: 'sun', label: 'Sunday' },
]

const TERRAIN: Array<{ key: keyof Terrain; label: string }> = [
  { key: 'trail', label: 'Trails' },
  { key: 'hills', label: 'Hills' },
  { key: 'treadmill', label: 'Treadmill' },
  { key: 'track', label: 'Track' },
]

const STRENGTH: Array<{ value: string; label: string }> = [
  { value: '0', label: 'None' },
  { value: '1', label: 'A little' },
  { value: '2', label: 'Some' },
  { value: '3', label: 'A lot' },
]

const INJURY_KINDS: Array<{ value: Injury['kind']; label: string }> = [
  { value: 'bone-stress', label: 'Bone stress' },
  { value: 'tendon', label: 'Tendon' },
  { value: 'muscle', label: 'Muscle' },
  { value: 'joint', label: 'Joint' },
  { value: 'other', label: 'Other' },
]

type Sex = NonNullable<AthleteProfile['sex']>
type HrSource = NonNullable<AthleteProfile['hrMaxSource']>

interface InjuryDraft {
  area: string
  side: '' | 'left' | 'right' | 'both'
  year: string
  month: string
  kind: Injury['kind']
  notes: string
}

/** The form's working copy: numbers are kept as the text typed so a half-typed value survives. */
interface Draft {
  birthYear: string
  sex: '' | Sex
  heightCm: string
  weightKg: string
  runningSinceYear: string
  hrMax: string
  hrMaxSource: '' | HrSource
  hrRest: string
  lthr: string
  pace: string
  availability: Record<Weekday, { available: boolean; maxMin: string }>
  longRunDay: Weekday
  terrain: Terrain
  strength: string
  injuries: InjuryDraft[]
  timezone: string
  homeLat: string
  homeLng: string
  useHomeWeather: boolean
}

function text(value: number | null): string {
  return value === null ? '' : String(value)
}

/** Kilometres in one unit of the runner's distance setting. */
function kmPerUnit(units: Units): number {
  return units === 'mi' ? milesToM(1) / 1000 : 1
}

/** Stored seconds per km shown as `m:ss` per the runner's unit. */
function formatPace(secPerKm: number | null, units: Units): string {
  if (secPerKm === null) return ''
  return formatDuration(Math.round(secPerKm * kmPerUnit(units)))
}

function browserTimezone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone
  } catch {
    return undefined
  }
}

function toDraft(profile: AthleteProfile, units: Units): Draft {
  // 'UTC' is the server's default for a profile that was never filled in.
  const timezone = profile.timezone === 'UTC' ? (browserTimezone() ?? 'UTC') : profile.timezone
  const availability = {} as Draft['availability']
  for (const { value } of WEEKDAYS) {
    const day = profile.availability[value]
    availability[value] = { available: day.available, maxMin: text(day.maxMin) }
  }
  return {
    birthYear: text(profile.birthYear),
    sex: profile.sex ?? '',
    heightCm: text(profile.heightCm),
    weightKg: text(profile.weightKg),
    runningSinceYear: text(profile.runningSinceYear),
    hrMax: text(profile.hrMax),
    hrMaxSource: profile.hrMaxSource ?? '',
    hrRest: text(profile.hrRest),
    lthr: text(profile.lthr),
    pace: formatPace(profile.thresholdPaceSecPerKm, units),
    availability,
    longRunDay: profile.longRunDay,
    terrain: { ...profile.terrain },
    strength: String(profile.strengthPreference),
    injuries: profile.injuries.map((injury) => ({
      area: injury.area,
      side: injury.side ?? '',
      year: text(injury.year),
      month: text(injury.month),
      kind: injury.kind,
      notes: injury.notes ?? '',
    })),
    timezone,
    homeLat: text(profile.homeLat),
    homeLng: text(profile.homeLng),
    useHomeWeather: profile.useHomeWeather,
  }
}

function timezoneOptions(current: string): string[] {
  let zones: string[] = []
  try {
    zones = Intl.supportedValuesOf('timeZone')
  } catch {
    zones = []
  }
  const all = new Set(zones)
  all.add('UTC')
  all.add(current)
  return [...all].sort()
}

function round2(value: number): number {
  const rounded = Math.round(value * 100) / 100
  return rounded === 0 ? 0 : rounded
}

class Problems {
  readonly errors: Record<string, string> = {}

  add(path: string, message: string) {
    if (!(path in this.errors)) this.errors[path] = message
  }

  get any(): boolean {
    return Object.keys(this.errors).length > 0
  }
}

/** Blank is null; anything that is not a number is reported against `path`. */
function parseNumber(
  raw: string,
  path: string,
  problems: Problems,
  opts: { integer: boolean },
): number | null {
  const value = raw.trim()
  if (value === '') return null
  const number = Number(value)
  if (!Number.isFinite(number) || (opts.integer && !Number.isInteger(number))) {
    problems.add(path, opts.integer ? 'Enter a whole number.' : 'Enter a number.')
    return null
  }
  return number
}

/** `m:ss` per the runner's unit, returned as whole seconds per km. */
function parsePace(raw: string, units: Units, problems: Problems): number | null {
  const value = raw.trim()
  if (value === '') return null
  const match = /^(\d{1,2}):([0-5]\d)$/.exec(value)
  if (!match) {
    problems.add('thresholdPaceSecPerKm', 'Use minutes and seconds, such as 5:30.')
    return null
  }
  return Math.round((Number(match[1]) * 60 + Number(match[2])) / kmPerUnit(units))
}

function toProfile(draft: Draft, units: Units, problems: Problems): AthleteProfile {
  const int = { integer: true }
  const availability = {} as Availability
  for (const { value } of WEEKDAYS) {
    const day = draft.availability[value]
    availability[value] = {
      available: day.available,
      maxMin: parseNumber(day.maxMin, `availability.${value}.maxMin`, problems, int),
    }
  }
  const injuries = draft.injuries.map((injury, index): Injury => {
    const path = `injuries.${String(index)}`
    const year = parseNumber(injury.year, `${path}.year`, problems, int)
    if (year === null && injury.year.trim() === '') problems.add(`${path}.year`, 'Enter a year.')
    return {
      area: injury.area.trim(),
      side: injury.side === '' ? null : injury.side,
      year: year ?? 0,
      month: parseNumber(injury.month, `${path}.month`, problems, int),
      kind: injury.kind,
      notes: injury.notes.trim() === '' ? null : injury.notes.trim(),
    }
  })
  const lat = parseNumber(draft.homeLat, 'homeLat', problems, { integer: false })
  const lng = parseNumber(draft.homeLng, 'homeLng', problems, { integer: false })
  const strength = Number(draft.strength) as AthleteProfile['strengthPreference']
  return {
    birthYear: parseNumber(draft.birthYear, 'birthYear', problems, int),
    sex: draft.sex === '' ? null : draft.sex,
    heightCm: parseNumber(draft.heightCm, 'heightCm', problems, { integer: false }),
    weightKg: parseNumber(draft.weightKg, 'weightKg', problems, { integer: false }),
    hrMax: parseNumber(draft.hrMax, 'hrMax', problems, int),
    hrMaxSource: draft.hrMaxSource === '' ? null : draft.hrMaxSource,
    hrRest: parseNumber(draft.hrRest, 'hrRest', problems, int),
    lthr: parseNumber(draft.lthr, 'lthr', problems, int),
    thresholdPaceSecPerKm: parsePace(draft.pace, units, problems),
    runningSinceYear: parseNumber(draft.runningSinceYear, 'runningSinceYear', problems, int),
    injuries,
    availability,
    longRunDay: draft.longRunDay,
    terrain: draft.terrain,
    strengthPreference: strength,
    timezone: draft.timezone,
    homeLat: lat === null ? null : round2(lat),
    homeLng: lng === null ? null : round2(lng),
    useHomeWeather: draft.useHomeWeather,
  }
}

function emptyInjury(): InjuryDraft {
  return { area: '', side: '', year: '', month: '', kind: 'other', notes: '' }
}

function ProfileForm({ initial, units }: { initial: AthleteProfile; units: Units }) {
  const toast = useToast()
  const update = useUpdateProfile()
  const [draft, setDraft] = useState<Draft>(() => toDraft(initial, units))
  const [localErrors, setLocalErrors] = useState<Record<string, string>>({})
  const [locationNote, setLocationNote] = useState<string | undefined>()

  const serverErrors = fieldErrors(update.error)
  const errors: Record<string, string> = { ...serverErrors, ...localErrors }
  const otherError =
    update.isError && Object.keys(serverErrors).length === 0
      ? 'Profile not saved. The server did not accept the change; try again.'
      : undefined

  function set<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((current) => ({ ...current, [key]: value }))
  }

  function setInjury(index: number, patch: Partial<InjuryDraft>) {
    setDraft((current) => ({
      ...current,
      injuries: current.injuries.map((injury, i) =>
        i === index ? { ...injury, ...patch } : injury,
      ),
    }))
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    const problems = new Problems()
    const profile = toProfile(draft, units, problems)
    setLocalErrors(problems.errors)
    if (problems.any) {
      // Drop the previous attempt's server errors so only this attempt's problems show.
      update.reset()
      return
    }
    update.mutate(profile, {
      onSuccess: (saved) => {
        setDraft(toDraft(saved, units))
        toast.show('Profile saved')
      },
    })
  }

  function useMyLocation() {
    if (!('geolocation' in navigator)) {
      setLocationNote('This browser cannot share a location. Enter the coordinates instead.')
      return
    }
    setLocationNote(undefined)
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setDraft((current) => ({
          ...current,
          homeLat: String(round2(position.coords.latitude)),
          homeLng: String(round2(position.coords.longitude)),
        }))
      },
      () => {
        setLocationNote('The location was not shared. Enter the coordinates instead.')
      },
    )
  }

  function numberField(
    label: string,
    key: 'birthYear' | 'heightCm' | 'weightKg' | 'runningSinceYear' | 'hrMax' | 'hrRest' | 'lthr',
    path: string,
    opts: { hint?: string; decimal?: boolean } = {},
  ) {
    return (
      <Field label={label} hint={opts.hint} error={errors[path]}>
        {(control) => (
          <Input
            {...control}
            type="text"
            inputMode={opts.decimal === true ? 'decimal' : 'numeric'}
            value={draft[key]}
            onChange={(event) => {
              set(key, event.target.value)
            }}
          />
        )}
      </Field>
    )
  }

  const zones = timezoneOptions(draft.timezone)

  return (
    <>
      <PageHeader
        title="Profile"
        context="Details the training plan can use. Every field is optional."
      />
      <form className={styles.form} onSubmit={onSubmit} noValidate>
        <section className={styles.section} aria-labelledby="about-heading">
          <h2 id="about-heading" className={styles.heading}>
            About you
          </h2>
          <div className={styles.grid}>
            {numberField('Birth year', 'birthYear', 'birthYear')}
            <Field label="Sex" error={errors['sex']}>
              {(control) => (
                <Select
                  {...control}
                  value={draft.sex}
                  onChange={(event) => {
                    set('sex', event.target.value as Draft['sex'])
                  }}
                >
                  <option value="">Not stated</option>
                  <option value="female">Female</option>
                  <option value="male">Male</option>
                  <option value="unspecified">Prefer not to say</option>
                </Select>
              )}
            </Field>
            {numberField('Height (cm)', 'heightCm', 'heightCm', { decimal: true })}
            {numberField('Weight (kg)', 'weightKg', 'weightKg', { decimal: true })}
            {numberField('Running since (year)', 'runningSinceYear', 'runningSinceYear')}
          </div>
        </section>

        <section className={styles.section} aria-labelledby="hr-heading">
          <h2 id="hr-heading" className={styles.heading}>
            Heart rate
          </h2>
          <div className={styles.grid}>
            {numberField('Maximum heart rate', 'hrMax', 'hrMax', { hint: 'Beats per minute.' })}
            <Field label="Maximum heart rate source" error={errors['hrMaxSource']}>
              {(control) => (
                <Select
                  {...control}
                  value={draft.hrMaxSource}
                  onChange={(event) => {
                    set('hrMaxSource', event.target.value as Draft['hrMaxSource'])
                  }}
                >
                  <option value="">Not stated</option>
                  <option value="measured">Measured in a test or race</option>
                  <option value="estimated">Estimated</option>
                </Select>
              )}
            </Field>
            {numberField('Resting heart rate', 'hrRest', 'hrRest')}
            {numberField('Threshold heart rate', 'lthr', 'lthr', {
              hint: 'Must be below the maximum.',
            })}
          </div>
        </section>

        <section className={styles.section} aria-labelledby="pace-heading">
          <h2 id="pace-heading" className={styles.heading}>
            Pace
          </h2>
          <div className={styles.grid}>
            <Field
              label={`Threshold pace (min:sec per ${units})`}
              hint="The hardest pace held for about an hour, such as 5:30."
              error={errors['thresholdPaceSecPerKm']}
            >
              {(control) => (
                <Input
                  {...control}
                  type="text"
                  inputMode="numeric"
                  value={draft.pace}
                  onChange={(event) => {
                    set('pace', event.target.value)
                  }}
                />
              )}
            </Field>
          </div>
        </section>

        <section className={styles.section} aria-labelledby="availability-heading">
          <h2 id="availability-heading" className={styles.heading}>
            Availability
          </h2>
          <p className={styles.note}>
            Untick a day you cannot train. A time cap is optional; leave it blank for no limit.
          </p>
          <ul className={styles.days}>
            {WEEKDAYS.map(({ value, label }) => {
              const day = draft.availability[value]
              const path = `availability.${value}.maxMin`
              const error = errors[path]
              return (
                <li key={value} className={styles.day}>
                  <label className={styles.check}>
                    <input
                      type="checkbox"
                      checked={day.available}
                      onChange={(event) => {
                        setDraft((current) => ({
                          ...current,
                          availability: {
                            ...current.availability,
                            [value]: {
                              ...current.availability[value],
                              available: event.target.checked,
                            },
                          },
                        }))
                      }}
                    />
                    {label}
                  </label>
                  <div className={styles.cap}>
                    <Input
                      type="text"
                      inputMode="numeric"
                      aria-label={`${label} maximum minutes`}
                      aria-invalid={error === undefined ? undefined : true}
                      placeholder="Max min"
                      disabled={!day.available}
                      value={day.maxMin}
                      onChange={(event) => {
                        setDraft((current) => ({
                          ...current,
                          availability: {
                            ...current.availability,
                            [value]: {
                              ...current.availability[value],
                              maxMin: event.target.value,
                            },
                          },
                        }))
                      }}
                    />
                    {error !== undefined ? <p className={styles.error}>{error}</p> : null}
                  </div>
                </li>
              )
            })}
          </ul>
          <div className={styles.grid}>
            <Field label="Long-run day" error={errors['longRunDay']}>
              {(control) => (
                <Select
                  {...control}
                  value={draft.longRunDay}
                  onChange={(event) => {
                    set('longRunDay', event.target.value as Weekday)
                  }}
                >
                  {WEEKDAYS.map(({ value, label }) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </div>
        </section>

        <section className={styles.section} aria-labelledby="terrain-heading">
          <h2 id="terrain-heading" className={styles.heading}>
            Terrain
          </h2>
          <p className={styles.note}>What is within reach for regular training.</p>
          <div className={styles.checks}>
            {TERRAIN.map(({ key, label }) => (
              <label key={key} className={styles.check}>
                <input
                  type="checkbox"
                  checked={draft.terrain[key]}
                  onChange={(event) => {
                    setDraft((current) => ({
                      ...current,
                      terrain: { ...current.terrain, [key]: event.target.checked },
                    }))
                  }}
                />
                {label}
              </label>
            ))}
          </div>
        </section>

        <section className={styles.section} aria-labelledby="strength-heading">
          <h2 id="strength-heading" className={styles.heading}>
            Strength
          </h2>
          <p className={styles.note}>How much strength work to include alongside running.</p>
          <Segmented
            label="Strength preference"
            options={STRENGTH}
            value={draft.strength}
            onChange={(value) => {
              set('strength', value)
            }}
          />
          {errors['strengthPreference'] !== undefined ? (
            <p className={styles.error}>{errors['strengthPreference']}</p>
          ) : null}
        </section>

        <section className={styles.section} aria-labelledby="injury-heading">
          <h2 id="injury-heading" className={styles.heading}>
            Injury history
          </h2>
          <p className={styles.note}>Past injuries that should shape how load is added.</p>
          {draft.injuries.map((injury, index) => {
            const n = index + 1
            const path = `injuries.${String(index)}`
            return (
              <fieldset key={index} className={styles.injury}>
                <legend className={styles.legend}>Injury {n}</legend>
                <div className={styles.grid}>
                  <Field label={`Injury ${String(n)} area`} error={errors[`${path}.area`]}>
                    {(control) => (
                      <Input
                        {...control}
                        type="text"
                        value={injury.area}
                        onChange={(event) => {
                          setInjury(index, { area: event.target.value })
                        }}
                      />
                    )}
                  </Field>
                  <Field label={`Injury ${String(n)} side`} error={errors[`${path}.side`]}>
                    {(control) => (
                      <Select
                        {...control}
                        value={injury.side}
                        onChange={(event) => {
                          setInjury(index, { side: event.target.value as InjuryDraft['side'] })
                        }}
                      >
                        <option value="">Not applicable</option>
                        <option value="left">Left</option>
                        <option value="right">Right</option>
                        <option value="both">Both</option>
                      </Select>
                    )}
                  </Field>
                  <Field label={`Injury ${String(n)} type`} error={errors[`${path}.kind`]}>
                    {(control) => (
                      <Select
                        {...control}
                        value={injury.kind}
                        onChange={(event) => {
                          setInjury(index, { kind: event.target.value as Injury['kind'] })
                        }}
                      >
                        {INJURY_KINDS.map((kind) => (
                          <option key={kind.value} value={kind.value}>
                            {kind.label}
                          </option>
                        ))}
                      </Select>
                    )}
                  </Field>
                  <Field label={`Injury ${String(n)} year`} error={errors[`${path}.year`]}>
                    {(control) => (
                      <Input
                        {...control}
                        type="text"
                        inputMode="numeric"
                        value={injury.year}
                        onChange={(event) => {
                          setInjury(index, { year: event.target.value })
                        }}
                      />
                    )}
                  </Field>
                  <Field
                    label={`Injury ${String(n)} month`}
                    hint="1 to 12, optional."
                    error={errors[`${path}.month`]}
                  >
                    {(control) => (
                      <Input
                        {...control}
                        type="text"
                        inputMode="numeric"
                        value={injury.month}
                        onChange={(event) => {
                          setInjury(index, { month: event.target.value })
                        }}
                      />
                    )}
                  </Field>
                </div>
                <Field label={`Injury ${String(n)} notes`} error={errors[`${path}.notes`]}>
                  {(control) => (
                    <Input
                      {...control}
                      type="text"
                      value={injury.notes}
                      onChange={(event) => {
                        setInjury(index, { notes: event.target.value })
                      }}
                    />
                  )}
                </Field>
                <div>
                  <Button
                    variant="quiet"
                    onClick={() => {
                      setDraft((current) => ({
                        ...current,
                        injuries: current.injuries.filter((_, i) => i !== index),
                      }))
                    }}
                  >
                    Remove injury {n}
                  </Button>
                </div>
              </fieldset>
            )
          })}
          <div>
            <Button
              onClick={() => {
                setDraft((current) => ({
                  ...current,
                  injuries: [...current.injuries, emptyInjury()],
                }))
              }}
            >
              Add an injury
            </Button>
          </div>
          {errors['injuries'] !== undefined ? (
            <p className={styles.error}>{errors['injuries']}</p>
          ) : null}
        </section>

        <section className={styles.section} aria-labelledby="location-heading">
          <h2 id="location-heading" className={styles.heading}>
            Location and timezone
          </h2>
          <p className={styles.note}>
            The home location is kept to 0.01 degrees, about one kilometre. It supplies weather for
            runs without a recorded start.
          </p>
          <div>
            <Button onClick={useMyLocation}>Use my location</Button>
          </div>
          {locationNote !== undefined ? <p className={styles.note}>{locationNote}</p> : null}
          <div className={styles.grid}>
            <Field label="Home latitude" error={errors['homeLat']}>
              {(control) => (
                <Input
                  {...control}
                  type="text"
                  inputMode="decimal"
                  value={draft.homeLat}
                  onChange={(event) => {
                    set('homeLat', event.target.value)
                  }}
                />
              )}
            </Field>
            <Field label="Home longitude" error={errors['homeLng']}>
              {(control) => (
                <Input
                  {...control}
                  type="text"
                  inputMode="decimal"
                  value={draft.homeLng}
                  onChange={(event) => {
                    set('homeLng', event.target.value)
                  }}
                />
              )}
            </Field>
          </div>
          <label className={styles.check}>
            <input
              type="checkbox"
              checked={draft.useHomeWeather}
              onChange={(event) => {
                set('useHomeWeather', event.target.checked)
              }}
            />
            Use the home location for weather when a run has no start location
          </label>
          <div className={styles.grid}>
            <Field label="Timezone" error={errors['timezone']}>
              {(control) => (
                <Select
                  {...control}
                  value={draft.timezone}
                  onChange={(event) => {
                    set('timezone', event.target.value)
                  }}
                >
                  {zones.map((zone) => (
                    <option key={zone} value={zone}>
                      {zone}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </div>
        </section>

        {otherError !== undefined ? (
          <p role="alert" className={styles.error}>
            {otherError}
          </p>
        ) : Object.keys(errors).length > 0 ? (
          <p role="alert" className={styles.error}>
            Profile not saved. Check the fields marked above.
          </p>
        ) : null}
        <div>
          <Button type="submit" variant="primary" loading={update.isPending}>
            Save profile
          </Button>
        </div>
      </form>
    </>
  )
}

export function ProfilePage() {
  const profile = useProfile()
  // Pace is typed in the runner's unit; a failed settings load falls back to the stored km.
  const settings = useSettings()

  if (profile.isError) {
    return (
      <>
        <PageHeader title="Profile" />
        <p role="alert" className={styles.error}>
          The profile did not load. The server did not respond; reload the page to try again.
        </p>
      </>
    )
  }
  if (profile.isPending || settings.isPending) {
    return <div className="skeleton" aria-busy="true" aria-label="Loading" />
  }
  return <ProfileForm initial={profile.data} units={settings.data?.units ?? 'km'} />
}
