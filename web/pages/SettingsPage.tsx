import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { render } from '../../shared/copy/template.ts'
import { TEMPLATES } from '../../shared/copy/templates.ts'
import { trendsText } from '../../shared/copy/trends.ts'
import { DEFAULT_WEIGHT_UNIT, isWeightUnit } from '../../shared/domain/weight.ts'
import type { Units, UserSettings, WeightUnit } from '../../shared/types.ts'
import { useLogout } from '../api/auth.ts'
import { fieldErrors } from '../api/client.ts'
import { useSettings, useUpdateSettings, type SettingsPatch } from '../api/settings.ts'
import { Button } from '../components/Button.tsx'
import { Field, Input } from '../components/Field.tsx'
import { useTheme, type Theme } from '../components/Nav.tsx'
import { PageHeader } from '../components/PageHeader.tsx'
import { Segmented } from '../components/Segmented.tsx'
import { useOfflineStatus, type OfflineStatus } from '../pwa/register.ts'
import styles from './SettingsPage.module.css'

/** The sentence of the "Offline use" row for each state of the service worker, by cause. */
const OFFLINE_USE = {
  ready: TEMPLATES['today.offline.use-ready'],
  installing: TEMPLATES['today.offline.use-installing'],
  development: TEMPLATES['today.offline.use-development'],
  'no-https': TEMPLATES['today.offline.use-no-https'],
  unsupported: TEMPLATES['today.offline.use-unsupported'],
  refused: TEMPLATES['today.offline.use-refused'],
} satisfies Record<OfflineStatus, (typeof TEMPLATES)['today.offline.use-ready']>

/** How long "Saved" stays, and how long the name field waits after the last key before it saves. */
const SAVED_MS = 3000
const NAME_PAUSE_MS = 800

function SettingsForm({ initial }: { initial: UserSettings }) {
  const navigate = useNavigate()
  const { theme, setTheme } = useTheme()
  const update = useUpdateSettings()
  const logout = useLogout()
  const offline = useOfflineStatus()

  // What the server holds, as of the last successful save; the form sends only the differences.
  const [saved, setSaved] = useState(initial)
  const [units, setUnits] = useState<Units>(initial.units)
  // an answer kept from before the unit existed has none, and reads as the default (pounds)
  const [weightUnit, setWeightUnit] = useState<WeightUnit>(
    isWeightUnit(initial.weightUnit) ? initial.weightUnit : DEFAULT_WEIGHT_UNIT,
  )
  // a cached answer from before the switch existed has none, and reads as off
  const [showBodyWeight, setShowBodyWeight] = useState(initial.showBodyWeight === true)
  const [displayName, setDisplayName] = useState(initial.displayName ?? '')

  const [flash, setFlash] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const [nameError, setNameError] = useState<string | null>(null)
  const flashTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const nameTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(
    () => () => {
      clearTimeout(flashTimer.current)
      clearTimeout(nameTimer.current)
    },
    [],
  )

  /** The one "Saved" of the page: shown for three seconds, announced politely. */
  function confirm() {
    setFlash(true)
    clearTimeout(flashTimer.current)
    flashTimer.current = setTimeout(() => {
      setFlash(false)
    }, SAVED_MS)
  }

  /** Saves one change now. A refusal is reported by `onFailure`; the typed value is the caller's to keep. */
  function save(patch: SettingsPatch, onFailure: (error: unknown) => void) {
    setFailure(null)
    setNameError(null)
    update.mutateAsync(patch).then(
      (next) => {
        setSaved(next)
        confirm()
      },
      (error: unknown) => {
        setFlash(false)
        onFailure(error)
      },
    )
  }

  function onUnitsChange(next: Units) {
    if (next === units) return
    const previous = units
    setUnits(next)
    save({ units: next }, () => {
      setUnits(previous)
      setFailure(render(TEMPLATES['settings.not-saved'], {}, previous))
    })
  }

  function onWeightUnitChange(next: WeightUnit) {
    if (next === weightUnit) return
    const previous = weightUnit
    setWeightUnit(next)
    save({ weightUnit: next }, () => {
      setWeightUnit(previous)
      setFailure(render(TEMPLATES['settings.not-saved'], {}, units))
    })
  }

  function onShowBodyWeightChange(next: boolean) {
    const previous = showBodyWeight
    setShowBodyWeight(next)
    save({ showBodyWeight: next }, () => {
      setShowBodyWeight(previous)
      setFailure(render(TEMPLATES['settings.not-saved'], {}, units))
    })
  }

  function onThemeChange(next: Theme) {
    setTheme(next)
    confirm()
  }

  /** Saves the display name if it differs from what the server holds; the typed text always stays. */
  function saveName(value: string) {
    clearTimeout(nameTimer.current)
    const name = value.trim()
    if (name === (saved.displayName ?? '')) return
    save({ displayName: name }, (error) => {
      setNameError(
        fieldErrors(error)['displayName'] ??
          render(TEMPLATES['settings.name-not-saved'], {}, units),
      )
    })
  }

  function onNameChange(value: string) {
    setDisplayName(value)
    clearTimeout(nameTimer.current)
    nameTimer.current = setTimeout(() => {
      saveName(value)
    }, NAME_PAUSE_MS)
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    saveName(displayName)
  }

  function onSignOut() {
    logout.mutate(undefined, {
      onSuccess: () => {
        void navigate('/login', { replace: true })
      },
    })
  }

  return (
    <>
      <PageHeader title="Settings" context={saved.email} />
      <div className={styles.status} role="status" aria-live="polite" aria-label="Save status">
        {flash ? (
          <span className={styles.saved}>{render(TEMPLATES['settings.saved'], {}, units)}</span>
        ) : null}
      </div>
      <form className={`${styles.section} ${styles.first}`} onSubmit={onSubmit} noValidate>
        <Segmented<Units>
          label="Distance units"
          hint="Distances, pace and climb."
          value={units}
          onChange={onUnitsChange}
          options={[
            { value: 'mi', label: 'Miles' },
            { value: 'km', label: 'Kilometres' },
          ]}
        />
        <Segmented<WeightUnit>
          label={render(TEMPLATES['strength.page.weight-units'], {}, units)}
          hint="Body weight and strength loads."
          value={weightUnit}
          onChange={onWeightUnitChange}
          options={[
            { value: 'lb', label: render(TEMPLATES['strength.page.unit-pounds'], {}, units) },
            { value: 'kg', label: render(TEMPLATES['strength.page.unit-kilograms'], {}, units) },
          ]}
        />
        <Field label="Display name" error={nameError ?? undefined}>
          {(control) => (
            <Input
              {...control}
              type="text"
              value={displayName}
              autoComplete="name"
              onChange={(event) => {
                onNameChange(event.target.value)
              }}
              onBlur={() => {
                saveName(displayName)
              }}
            />
          )}
        </Field>
        {failure === null ? null : (
          <p role="alert" className={styles.alert}>
            {failure}
          </p>
        )}
      </form>

      <section className={styles.section} aria-labelledby="appearance-heading">
        <h2 id="appearance-heading" className={styles.heading}>
          Appearance
        </h2>
        <Segmented<Theme>
          label="Theme"
          value={theme}
          onChange={onThemeChange}
          options={[
            { value: 'system', label: 'System' },
            { value: 'light', label: 'Light' },
            { value: 'dark', label: 'Dark' },
          ]}
        />
      </section>

      <section className={styles.section} aria-labelledby="trends-heading">
        <h2 id="trends-heading" className={styles.heading}>
          {trendsText('trends.settings.heading')}
        </h2>
        <label className={styles.check}>
          <input
            type="checkbox"
            checked={showBodyWeight}
            aria-describedby="trends-weight-note"
            onChange={(event) => {
              onShowBodyWeightChange(event.target.checked)
            }}
          />
          {trendsText('trends.settings.show-weight')}
        </label>
        <p id="trends-weight-note" className={styles.note}>
          {trendsText('trends.settings.hiding-note')}
        </p>
      </section>

      <section className={styles.section} aria-labelledby="data-heading">
        <h2 id="data-heading" className={styles.heading}>
          Your data
        </h2>
        <p className={styles.note}>Download every activity as a CSV file.</p>
        <p>
          <a className={styles.link} href="/api/activities/export.csv">
            Export activities
          </a>
        </p>
        <p className={styles.note}>{render(OFFLINE_USE[offline], {}, units)}</p>
      </section>

      <section className={styles.section} aria-labelledby="session-heading">
        <h2 id="session-heading" className={styles.heading}>
          Session
        </h2>
        {logout.isError ? (
          <p role="alert" className={styles.alert}>
            Not signed out. The server did not respond; try again.
          </p>
        ) : null}
        <div>
          <Button onClick={onSignOut} loading={logout.isPending}>
            Sign out
          </Button>
        </div>
      </section>
    </>
  )
}

export function SettingsPage() {
  const settings = useSettings()

  if (settings.isError) {
    return (
      <>
        <PageHeader title="Settings" />
        <p role="alert" className={styles.alert}>
          Settings did not load. The server did not respond; reload the page to try again.
        </p>
      </>
    )
  }
  if (settings.isPending) {
    return <div className="skeleton" aria-busy="true" aria-label="Loading" />
  }
  return <SettingsForm initial={settings.data} />
}
