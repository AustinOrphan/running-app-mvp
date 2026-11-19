import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { render } from '../../shared/copy/template.ts'
import { TEMPLATES } from '../../shared/copy/templates.ts'
import { WARNING_SIGNS_NAME, WARNING_SIGNS_PATH } from '../../shared/copy/warningSigns.ts'
import {
  ZONE_UNSET_VALUE,
  ZONE_UTC_VALUE,
  zoneLineText,
  zoneSaveNoteText,
  zoneUnsetLabel,
  zoneUtcLabel,
} from '../../shared/copy/zone.ts'
import { addDays } from '../../shared/dates.ts'
import type {
  AthleteProfile,
  Availability,
  Injury,
  Terrain,
  Units,
  Weekday,
  WeightUnit,
} from '../../shared/types.ts'
import {
  bodyWeightIn,
  bodyWeightKg,
  DEFAULT_WEIGHT_UNIT,
  isWeightUnit,
} from '../../shared/domain/weight.ts'
import { formatDuration, heightCm, heightText, milesToM } from '../../shared/units.ts'
import { ApiError, fieldErrors } from '../api/client.ts'
import { rulesRef } from '../api/explain.ts'
import { usePlanNotice } from '../api/planNotice.ts'
import { useUsualStart } from '../api/places.ts'
import { useProfile, useUpdateProfile } from '../api/profile.ts'
import { useSaveScreening, useScreenings } from '../api/screenings.ts'
import { useSettings } from '../api/settings.ts'
import { useRunnerToday, useRunnerZone, useServerZone } from '../api/today.ts'
import { useZones } from '../api/zones.ts'
import { Button } from '../components/Button.tsx'
import { PlaceSearch } from '../components/PlaceSearch.tsx'
import { useOnline } from '../components/useOnline.ts'
import { PlanNoticeStanding } from '../components/PlanNotice.tsx'
import { ErrorState } from '../components/ErrorState.tsx'
import { useLoadView } from '../components/loadView.ts'
import { ExplainButton } from '../components/ExplainButton.tsx'
import { Field, Input, Select } from '../components/Field.tsx'
import { PageHeader } from '../components/PageHeader.tsx'
import { Segmented } from '../components/Segmented.tsx'
import { Sheet } from '../components/Sheet.tsx'
import { useToast } from '../components/Toast.tsx'
import { ZoneSummary } from '../components/ZoneSummary.tsx'
import { formatLongDate } from '../components/format.ts'
import { LATITUDE_REFUSAL, LONGITUDE_REFUSAL, parseCoordinate } from '../components/goalFormat.ts'
import { strengthProfileHint } from '../components/strength/profileHint.ts'
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

/** Height and body weight are typed in the runner's units and stored in centimetres and kilograms. */
interface BodyUnits {
  units: Units
  weightUnit: WeightUnit
}

const heightLabel = (units: Units) => (units === 'mi' ? 'Height (in)' : 'Height (cm)')
const weightLabel = (unit: WeightUnit) => (unit === 'lb' ? 'Weight (lb)' : 'Weight (kg)')

/**
 * `prefillZone` is true on the first load only: a stored 'UTC' (a profile never filled in) then
 * shows the browser's zone. After a save the draft takes the saved zone as it is, so a runner who
 * chose the "Not set" entry keeps seeing it.
 */
function toDraft(profile: AthleteProfile, body: BodyUnits, prefillZone = true): Draft {
  const { units, weightUnit } = body
  const timezone =
    prefillZone && profile.timezone === 'UTC' ? (browserTimezone() ?? 'UTC') : profile.timezone
  const availability = {} as Draft['availability']
  for (const { value } of WEEKDAYS) {
    const day = profile.availability[value]
    availability[value] = { available: day.available, maxMin: text(day.maxMin) }
  }
  return {
    birthYear: text(profile.birthYear),
    sex: profile.sex ?? '',
    heightCm: profile.heightCm === null ? '' : heightText(profile.heightCm, units),
    weightKg:
      profile.weightKg === null ? '' : String(bodyWeightIn(profile.weightKg * 1000, weightUnit)),
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

/**
 * The picker's entries: the unset entry (stored 'UTC') first, then the UTC entry (stored `Etc/UTC`),
 * then every other zone the browser knows and the draft's own.
 */
function timezoneOptions(
  current: string,
  serverZone: string | null,
): Array<{ value: string; label: string }> {
  let zones: string[] = []
  try {
    zones = Intl.supportedValuesOf('timeZone')
  } catch {
    zones = []
  }
  const rest = new Set([...zones, current])
  rest.delete(ZONE_UNSET_VALUE)
  rest.delete(ZONE_UTC_VALUE)
  return [
    { value: ZONE_UNSET_VALUE, label: zoneUnsetLabel(serverZone) },
    { value: ZONE_UTC_VALUE, label: zoneUtcLabel() },
    ...[...rest].sort().map((zone) => ({ value: zone, label: zone })),
  ]
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

/** Blank is null; text that is not a coordinate within `limit` is reported against `path`. */
function parseHomeCoordinate(
  raw: string,
  limit: number,
  path: string,
  refusal: string,
  problems: Problems,
): number | null {
  if (raw.trim() === '') return null
  const value = parseCoordinate(raw, limit)
  if (value === null) problems.add(path, refusal)
  return value
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

function toProfile(
  draft: Draft,
  initial: AthleteProfile,
  body: BodyUnits,
  problems: Problems,
): AthleteProfile {
  const { units, weightUnit } = body
  // Text left as shown keeps the stored value, so a save never drifts a height or weight that was only shown rounded.
  const shown = toDraft(initial, body)
  // Untouched means the text is the one shown for the stored value; every other number is converted.
  const typedHeight =
    draft.heightCm === shown.heightCm
      ? undefined
      : parseNumber(draft.heightCm, 'heightCm', problems, { integer: false })
  const typedWeight =
    draft.weightKg === shown.weightKg
      ? undefined
      : parseNumber(draft.weightKg, 'weightKg', problems, { integer: false })
  const height =
    typedHeight === undefined
      ? initial.heightCm
      : typedHeight === null
        ? null
        : heightCm(typedHeight, units)
  const weight =
    typedWeight === undefined
      ? initial.weightKg
      : typedWeight === null
        ? null
        : bodyWeightKg(typedWeight, weightUnit)
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
  const lat = parseHomeCoordinate(draft.homeLat, 90, 'homeLat', LATITUDE_REFUSAL, problems)
  const lng = parseHomeCoordinate(draft.homeLng, 180, 'homeLng', LONGITUDE_REFUSAL, problems)
  const strength = Number(draft.strength) as AthleteProfile['strengthPreference']
  return {
    birthYear: parseNumber(draft.birthYear, 'birthYear', problems, int),
    sex: draft.sex === '' ? null : draft.sex,
    heightCm: height,
    weightKg: weight,
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
    homeLat: lat,
    homeLng: lng,
    useHomeWeather: draft.useHomeWeather,
  }
}

function emptyInjury(): InjuryDraft {
  return { area: '', side: '', year: '', month: '', kind: 'other', notes: '' }
}

type LocationNoteId = Extract<keyof typeof TEMPLATES, `profile.location.${string}`>

function ProfileForm({ initial, units, weightUnit }: { initial: AthleteProfile } & BodyUnits) {
  const body: BodyUnits = { units, weightUnit }
  const toast = useToast()
  const update = useUpdateProfile()
  const [draft, setDraft] = useState<Draft>(() => toDraft(initial, body))
  const [localErrors, setLocalErrors] = useState<Record<string, string>>({})
  const [locationNote, setLocationNote] = useState<string | undefined>()
  const [locating, setLocating] = useState(false)
  const latRef = useRef<HTMLInputElement>(null)
  const usualStart = useUsualStart()
  const online = useOnline()
  // The fallback timer of a location request; null when none is waiting.
  const locationTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      if (locationTimer.current !== null) clearTimeout(locationTimer.current)
    }
  }, [])

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
    const profile = toProfile(draft, initial, body, problems)
    setLocalErrors(problems.errors)
    if (problems.any) {
      // Drop the previous attempt's server errors so only this attempt's problems show.
      update.reset()
      return
    }
    update.mutate(profile, {
      onSuccess: (saved) => {
        setDraft(toDraft(saved, body, false))
        toast.show('Profile saved')
      },
    })
  }

  function fillFromUsualStart() {
    const sayStart = (
      id: 'places.start.none' | 'places.start.unavailable' | 'places.start.offline',
    ) => {
      setLocationNote(render(TEMPLATES[id], {}, 'km'))
    }
    if (!online) {
      sayStart('places.start.offline')
      return
    }
    setLocationNote(undefined)
    void usualStart.refetch().then(({ data, isError }) => {
      if (!mounted.current) return
      if (isError || data === undefined) {
        sayStart('places.start.unavailable')
        return
      }
      const start = data.start
      if (start === null) {
        sayStart('places.start.none')
        return
      }
      setDraft((current) => ({
        ...current,
        homeLat: String(start.lat),
        homeLng: String(start.lng),
      }))
      setLocationNote(
        render(
          TEMPLATES['places.start.found'],
          { runs: { kind: 'count', n: start.runs }, of: { kind: 'count', n: start.of } },
          'km',
        ),
      )
    })
  }

  function useMyLocation() {
    const say = (id: LocationNoteId) => {
      setLocationNote(render(TEMPLATES[id], {}, 'km'))
    }
    // Browsers expose geolocation only in a secure context; over plain http the call fails at once
    // with a refusal the runner never made.
    if (window.isSecureContext === false) {
      say('profile.location.insecure')
      return
    }
    if (!('geolocation' in navigator)) {
      say('profile.location.no-api')
      return
    }
    setLocationNote(undefined)
    setLocating(true)
    // The API's own timeout starts only after permission is granted, and a prompt dismissed
    // without an answer (Firefox, "Not now") calls neither callback. This timer ends the wait; the
    // request then counts as settled and a late answer is ignored.
    let settled = false
    const settle = (): boolean => {
      if (settled || !mounted.current) return false
      settled = true
      if (locationTimer.current !== null) clearTimeout(locationTimer.current)
      locationTimer.current = null
      setLocating(false)
      return true
    }
    locationTimer.current = setTimeout(() => {
      if (settle()) say('profile.location.timeout')
    }, 20000)
    navigator.geolocation.getCurrentPosition(
      (position) => {
        if (!settle()) return
        setDraft((current) => ({
          ...current,
          homeLat: String(round2(position.coords.latitude)),
          homeLng: String(round2(position.coords.longitude)),
        }))
      },
      (failure) => {
        if (!settle()) return
        // 1 PERMISSION_DENIED, 2 POSITION_UNAVAILABLE, 3 TIMEOUT.
        say(
          failure.code === 1
            ? 'profile.location.denied'
            : failure.code === 3
              ? 'profile.location.timeout'
              : 'profile.location.unavailable',
        )
      },
      // The home location is kept to 0.01 degrees (about 1 km), so a coarse, cached fix is enough
      // and high accuracy would only slow the answer.
      { timeout: 15000, maximumAge: 600000, enableHighAccuracy: false },
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

  // The zone the days follow, from the session user and never from the draft. It is the runner's
  // own zone once one is saved, so the unset entry names the server's zone from `serverTz`.
  const daysZone = useRunnerZone()
  const serverZone = useServerZone()
  const runnerToday = useRunnerToday()
  const zones = timezoneOptions(draft.timezone, serverZone)
  const saveNote =
    draft.timezone !== initial.timezone ? zoneSaveNoteText(draft.timezone, serverZone) : null

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
            {numberField(heightLabel(units), 'heightCm', 'heightCm', { decimal: true })}
            {numberField(weightLabel(weightUnit), 'weightKg', 'weightKg', { decimal: true })}
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
                  // the pace needs a colon, which the number pad has not got
                  inputMode="text"
                  autoComplete="off"
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
          <p className={styles.note}>{strengthProfileHint(units)}</p>
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
          <p className={styles.note}>
            {draft.injuries.some((injury) => injury.kind === 'bone-stress')
              ? 'Bone stress history: listed. The plan adds weekly load more slowly, and pain at one spot on a bone pauses progression until a clinician has seen it.'
              : 'Bone stress history: none listed. If one applies, add it above; it changes how fast the plan adds load.'}
          </p>
          <p className={styles.note}>
            {render(TEMPLATES['warning-signs.note'], {}, 'km')}:{' '}
            <Link to={WARNING_SIGNS_PATH}>{WARNING_SIGNS_NAME}</Link>
          </p>
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
          <PlaceSearch
            onChoose={(place) => {
              setLocationNote(undefined)
              setDraft((current) => ({
                ...current,
                homeLat: String(place.lat),
                homeLng: String(place.lng),
              }))
              latRef.current?.focus()
            }}
          />
          <div className={styles.locationBlock}>
            <div className={styles.actions}>
              <Button busy={locating} onClick={useMyLocation}>
                Use my location
              </Button>
              <Button busy={usualStart.isFetching} onClick={fillFromUsualStart}>
                {render(TEMPLATES['places.start.button'], {}, 'km')}
              </Button>
            </div>
            {/* Mounted while empty, so the first message is announced. */}
            <p className={styles.note} role="status">
              {locationNote}
            </p>
          </div>
          <div className={styles.grid}>
            <Field label="Home latitude" error={errors['homeLat']}>
              {(control) => (
                <Input
                  {...control}
                  ref={latRef}
                  type="text"
                  // south is negative, and a decimal keypad has no minus
                  inputMode="text"
                  autoComplete="off"
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
                  // west is negative, and a decimal keypad has no minus
                  inputMode="text"
                  autoComplete="off"
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
                    <option key={zone.value} value={zone.value}>
                      {zone.label}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </div>
          {daysZone !== null ? (
            <p className={styles.note}>{zoneLineText(daysZone, runnerToday, initial.timezone)}</p>
          ) : null}
          {saveNote !== null ? <p className={styles.note}>{saveNote}</p> : null}
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

/** The current zone set: each boundary with the source it came from, then the three zones. */
function ZonesSection({ units }: { units: Units }) {
  const headingId = useId()
  const zones = useZones()
  let body
  if (zones.isError) {
    body = <p className={styles.note}>The zones did not load.</p>
  } else if (zones.isPending) {
    body = null
  } else {
    body = <ZoneSummary set={zones.data} units={units} />
  }
  return (
    <section className={styles.section} aria-labelledby={headingId}>
      <h2 id={headingId} className={styles.heading}>
        Zones
      </h2>
      <p className={styles.note}>
        {render(TEMPLATES['zones.note.ranges'], {}, 'km')}{' '}
        {render(TEMPLATES['zones.note.pace'], {}, 'km')}{' '}
        {render(TEMPLATES['zones.note.hr'], {}, 'km')}{' '}
        <Link to="/review">{render(TEMPLATES['paces.link.review'], {}, 'km')}</Link>
      </p>
      {body}
      <div>
        <Link to="/paces">{render(TEMPLATES['paces.link.from-profile'], {}, 'km')}</Link>
      </div>
      <div>
        <Link to="/plan-inputs">
          {render(TEMPLATES['plan-inputs.link.from-profile'], {}, 'km')}
        </Link>
      </div>
      <div>
        <ExplainButton subject="zones" rules={['C1', 'C2']} explain={{ subject: 'zone' }} />
      </div>
    </section>
  )
}

/** One question per sign of low energy availability [rules n-4]; ticking a box means "yes". */
const SCREEN_QUESTIONS = [
  { key: 'unintendedWeightLoss', label: 'Unintended weight loss in the last few months' },
  { key: 'menstrualChanges', label: render(TEMPLATES['profile.screening.cycle'], {}, 'km') },
  { key: 'recurrentInjuryOrIllness', label: 'Repeated bone stress injuries, or frequent illness' },
  { key: 'persistentFatigue', label: 'Tiredness that does not lift with rest' },
  { key: 'giSymptoms', label: 'Stomach or gut symptoms that keep coming back' },
  { key: 'disorderedEating', label: 'Worry about food, or restricting it to control weight' },
] as const

/** The screen is repeated every 12 weeks [rules n-4]. */
const RESCREEN_DAYS = 84

function ScreeningSheet({ onClose }: { onClose: () => void }) {
  const formId = useId()
  const toast = useToast()
  const save = useSaveScreening()
  const [answers, setAnswers] = useState<Record<string, boolean>>(
    Object.fromEntries(SCREEN_QUESTIONS.map(({ key }) => [key, false])),
  )
  const [failure, setFailure] = useState<string | null>(null)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setFailure(null)
    try {
      await save.mutateAsync({ answers })
      toast.show('Screen saved')
      onClose()
    } catch (err) {
      setFailure(
        `Screen not saved. ${err instanceof ApiError ? err.message : 'The server did not respond.'}`,
      )
    }
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title="Energy availability screen"
      footer={
        <Button type="submit" form={formId} variant="primary" loading={save.isPending}>
          Save screen
        </Button>
      }
    >
      <form
        id={formId}
        className={styles.form}
        onSubmit={(event) => {
          void submit(event)
        }}
      >
        <fieldset className={styles.screen}>
          <legend className={styles.note}>Tick any that apply. Leave the rest blank.</legend>
          {SCREEN_QUESTIONS.map(({ key, label }) => (
            <label key={key} className={styles.check}>
              <input
                type="checkbox"
                checked={answers[key] === true}
                onChange={(event) => {
                  setAnswers((current) => ({ ...current, [key]: event.target.checked }))
                }}
              />
              {label}
            </label>
          ))}
        </fieldset>
        {failure !== null ? (
          <p role="alert" className={styles.error}>
            {failure}
          </p>
        ) : null}
      </form>
    </Sheet>
  )
}

/** The health notice (FS1): an account from before it sees it here, once, with its plan untouched. */
function NoticeSection() {
  const notice = usePlanNotice()
  if (notice.data === undefined) return null
  return <PlanNoticeStanding notice={notice.data} />
}

/** The REDs screen: when it was last done, when the next is due, and the entry point. */
function ScreeningSection() {
  const today = useRunnerToday()
  const headingId = useId()
  const screenings = useScreenings()
  const [open, setOpen] = useState(false)
  const latest = screenings.data?.[0]
  const nextDue = latest ? addDays(latest.date, RESCREEN_DAYS) : null

  let body
  if (screenings.isError) {
    body = <p className={styles.note}>The screens did not load.</p>
  } else if (screenings.isPending) {
    body = null
  } else if (!latest || nextDue === null) {
    body = (
      <p className={styles.note}>
        No screen yet. It asks about six common signs of low energy availability and takes about a
        minute.
      </p>
    )
  } else {
    body = (
      <>
        <p className={styles.note}>
          {`Last screened ${formatLongDate(latest.date)}: ${String(latest.flags)} ${latest.flags === 1 ? 'sign' : 'signs'}.`}
        </p>
        <p className={styles.note}>
          {nextDue <= today
            ? 'A new screen is due now.'
            : `Next screen due ${formatLongDate(nextDue)}.`}
        </p>
        {latest.flags >= 2 ? (
          <p className={styles.callout}>
            Two or more signs came up. Progression holds, and a sports medicine clinician or
            dietitian can help. This screen is not a diagnosis.
          </p>
        ) : null}
      </>
    )
  }

  return (
    <section className={styles.section} aria-labelledby={headingId}>
      <h2 id={headingId} className={styles.heading}>
        Energy availability screen
      </h2>
      {body}
      <div className={styles.row}>
        <Button
          onClick={() => {
            setOpen(true)
          }}
        >
          {latest ? 'Screen again' : 'Start screen'}
        </Button>
        <ExplainButton
          subject="energy availability screen"
          rules={['n-4']}
          explain={rulesRef(['n-4'])}
        />
      </div>
      {open ? (
        <ScreeningSheet
          onClose={() => {
            setOpen(false)
          }}
        />
      ) : null}
    </section>
  )
}

export function ProfilePage() {
  const profile = useProfile()
  // Pace is typed in the runner's unit; a failed settings load falls back to the stored km.
  const settings = useSettings()
  const view = useLoadView(profile)

  if (view === 'failed' || view === 'retrying') {
    return (
      <>
        <PageHeader title="Profile" />
        <ErrorState
          subject="The profile"
          onRetry={() => profile.refetch()}
          error={profile.error}
          retrying={view === 'retrying'}
        />
      </>
    )
  }
  if (profile.data === undefined || settings.isPending) {
    return <div className="skeleton" aria-busy="true" aria-label="Loading" />
  }
  const units = settings.data?.units ?? 'km'
  // Without settings the form shows the stored kilograms; with them, a stored answer that is not a unit reads as the default.
  const weightUnit: WeightUnit =
    settings.data === undefined
      ? 'kg'
      : isWeightUnit(settings.data.weightUnit)
        ? settings.data.weightUnit
        : DEFAULT_WEIGHT_UNIT
  return (
    <>
      <ProfileForm initial={profile.data} units={units} weightUnit={weightUnit} />
      <div className={styles.extras}>
        <ZonesSection units={units} />
        <ScreeningSection />
        <NoticeSection />
      </div>
    </>
  )
}
