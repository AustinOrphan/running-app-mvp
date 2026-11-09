import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { render } from '../../shared/copy/template.ts'
import { TEMPLATES } from '../../shared/copy/templates.ts'
import { trendsText } from '../../shared/copy/trends.ts'
import { DEFAULT_WEIGHT_UNIT, isWeightUnit } from '../../shared/domain/weight.ts'
import type { Units, UserSettings, WeightUnit } from '../../shared/types.ts'
import { useLogout } from '../api/auth.ts'
import { useWaitingRecords } from '../api/activityOutbox.ts'
import { fieldErrors } from '../api/client.ts'
import { exportRefusal, useDownloadExport, type ExportRefusal } from '../api/export.ts'
import { useSettings, useUpdateSettings, type SettingsPatch } from '../api/settings.ts'
import { Button } from '../components/Button.tsx'
import { ChangePasswordForm } from '../components/ChangePasswordForm.tsx'
import { ErrorState } from '../components/ErrorState.tsx'
import { useLoadView } from '../components/loadView.ts'
import { Field, Input } from '../components/Field.tsx'
import { useCondensedFigures } from '../components/figureType.ts'
import { TrailRoadSettings } from '../components/map/TrailRoadSettings.tsx'
import { useMapTiles } from '../components/map/useMapTiles.ts'
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

/** The line under the export button for each kind of refusal. */
const EXPORT_REFUSAL_COPY = {
  running: TEMPLATES['export.running'],
  rate: TEMPLATES['export.rate'],
  'too-big': TEMPLATES['export.too-big'],
  error: TEMPLATES['export.error'],
} satisfies Record<ExportRefusal, (typeof TEMPLATES)['export.error']>

/** The settings that save by themselves, each with its own rollback. */
type SettingKey = 'units' | 'weightUnit' | 'showBodyWeight' | 'hideMapEnds' | 'displayName'

/** How long "Saved" stays, and how long the name field waits after the last key before it saves. */
const SAVED_MS = 3000
const NAME_PAUSE_MS = 800

function SettingsForm({ initial }: { initial: UserSettings }) {
  const navigate = useNavigate()
  const { theme, setTheme } = useTheme()
  const condensed = useCondensedFigures()
  const mapTiles = useMapTiles()
  const update = useUpdateSettings()
  const logout = useLogout()
  const download = useDownloadExport()
  const offline = useOfflineStatus()
  // A run or rating that has not gone up is named before a sign-out clears it.
  const waiting = useWaitingRecords()
  const [confirming, setConfirming] = useState(false)
  const warning = useRef<HTMLParagraphElement>(null)
  const signOut = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (confirming) warning.current?.focus()
  }, [confirming])

  // What the server holds, as of the last successful save; the form sends only the differences.
  const [saved, setSaved] = useState(initial)
  const [units, setUnits] = useState<Units>(initial.units)
  // an answer kept from before the unit existed has none, and reads as the default (pounds)
  const [weightUnit, setWeightUnit] = useState<WeightUnit>(
    isWeightUnit(initial.weightUnit) ? initial.weightUnit : DEFAULT_WEIGHT_UNIT,
  )
  // a cached answer from before the switch existed has none, and reads as off
  const [showBodyWeight, setShowBodyWeight] = useState(initial.showBodyWeight === true)
  const [hideMapEnds, setHideMapEnds] = useState(initial.hideMapEnds !== false)
  const [displayName, setDisplayName] = useState(initial.displayName ?? '')

  const [flash, setFlash] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const [nameError, setNameError] = useState<string | null>(null)
  const flashTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const nameTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  // The newest save of all: only its answer may change `saved` and the Saved flash. The newest save
  // of each field: only its failure rolls that field back or sets its error, so a failure that a later
  // save of the same field has replaced does nothing, and any other failure is never lost.
  const newest = useRef(0)
  const newestOf = useRef<Partial<Record<SettingKey, number>>>({})
  // For the cleanup: the name as typed, the name the server holds, and whether a save is waiting.
  const typedName = useRef(initial.displayName ?? '')
  const heldName = useRef(initial.displayName ?? '')
  const namePending = useRef(false)
  const sendLeftover = useRef<(name: string) => void>(() => {})
  useEffect(() => {
    sendLeftover.current = (name) => {
      // The page is going away with a change not yet sent: send it, with nobody left to show the answer.
      update.mutateAsync({ displayName: name }).catch(() => {})
    }
  })

  useEffect(
    () => () => {
      clearTimeout(flashTimer.current)
      clearTimeout(nameTimer.current)
      const name = typedName.current.trim()
      if (namePending.current && name !== heldName.current) sendLeftover.current(name)
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
  function save(key: SettingKey, patch: SettingsPatch, onFailure: (error: unknown) => void) {
    const mine = ++newest.current
    newestOf.current[key] = mine
    setFailure(null)
    update.mutateAsync(patch).then(
      (next) => {
        if (mine !== newest.current) return
        heldName.current = next.displayName ?? ''
        setSaved(next)
        confirm()
      },
      (error: unknown) => {
        if (mine === newest.current) setFlash(false)
        if (newestOf.current[key] === mine) onFailure(error)
      },
    )
  }

  function onUnitsChange(next: Units) {
    if (next === units) return
    const previous = units
    setUnits(next)
    save('units', { units: next }, () => {
      setUnits(previous)
      setFailure(render(TEMPLATES['settings.not-saved'], {}, previous))
    })
  }

  function onWeightUnitChange(next: WeightUnit) {
    if (next === weightUnit) return
    const previous = weightUnit
    setWeightUnit(next)
    save('weightUnit', { weightUnit: next }, () => {
      setWeightUnit(previous)
      setFailure(render(TEMPLATES['settings.not-saved'], {}, units))
    })
  }

  function onShowBodyWeightChange(next: boolean) {
    const previous = showBodyWeight
    setShowBodyWeight(next)
    save('showBodyWeight', { showBodyWeight: next }, () => {
      setShowBodyWeight(previous)
      setFailure(render(TEMPLATES['settings.not-saved'], {}, units))
    })
  }

  function onHideMapEndsChange(next: boolean) {
    const previous = hideMapEnds
    setHideMapEnds(next)
    save('hideMapEnds', { hideMapEnds: next }, () => {
      setHideMapEnds(previous)
      setFailure(render(TEMPLATES['settings.not-saved'], {}, units))
    })
  }

  function onThemeChange(next: Theme) {
    setTheme(next)
    confirm()
  }

  function onCondensedChange(next: boolean) {
    condensed.setOn(next)
    confirm()
  }

  function onMapTilesChange(next: boolean) {
    mapTiles.setOn(next)
    confirm()
  }

  /** Saves the display name if it differs from what the server holds; the typed text always stays. */
  function saveName(value: string) {
    clearTimeout(nameTimer.current)
    namePending.current = false
    const name = value.trim()
    if (name === heldName.current) return
    setNameError(null)
    save('displayName', { displayName: name }, (error) => {
      setNameError(
        fieldErrors(error)['displayName'] ??
          render(TEMPLATES['settings.name-not-saved'], {}, units),
      )
    })
  }

  function onNameChange(value: string) {
    setDisplayName(value)
    typedName.current = value
    namePending.current = true
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
    if (waiting !== null && !confirming) {
      setConfirming(true)
      return
    }
    setConfirming(false)
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
        {/* the field's own error is not a live region: this says it aloud once */}
        {nameError === null ? null : (
          <p role="alert" className={styles.visuallyHidden}>
            {render(TEMPLATES['settings.name-alert'], {}, units)}
          </p>
        )}
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
        <label className={styles.check}>
          <input
            type="checkbox"
            checked={condensed.on}
            aria-describedby="condensed-note"
            onChange={(event) => {
              onCondensedChange(event.target.checked)
            }}
          />
          Condensed figures
        </label>
        <p id="condensed-note" className={styles.note}>
          Narrower, bolder numbers. This device only.
        </p>
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

      <section className={styles.section} aria-labelledby="maps-heading">
        <h2 id="maps-heading" className={styles.heading}>
          Maps
        </h2>
        <label className={styles.check}>
          <input
            type="checkbox"
            checked={hideMapEnds}
            aria-describedby="maps-ends-note"
            onChange={(event) => {
              onHideMapEndsChange(event.target.checked)
            }}
          />
          Hide the first and last 200 m of each map
        </label>
        <p id="maps-ends-note" className={styles.note}>
          A screenshot of a map then does not show where a run started or finished. The whole route
          stays stored on this server.
        </p>
        <label className={styles.check}>
          <input
            type="checkbox"
            checked={mapTiles.on}
            aria-describedby="maps-tiles-note"
            onChange={(event) => {
              onMapTilesChange(event.target.checked)
            }}
          />
          Map tiles
        </label>
        <p id="maps-tiles-note" className={styles.note}>
          Loads map tiles from OpenStreetMap, which sees the area of each run you open (the tile
          addresses, not the route). This device only.
        </p>
        <TrailRoadSettings units={units} />
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
        <p className={styles.note}>{render(TEMPLATES['export.included'], {}, units)}</p>
        <p className={styles.note}>{render(TEMPLATES['export.not-included'], {}, units)}</p>
        <div>
          <Button
            onClick={() => {
              download.mutate()
            }}
            busy={download.isPending}
            aria-describedby="export-status"
          >
            {render(TEMPLATES['export.button'], {}, units)}
          </Button>
        </div>
        <div id="export-status" role="status" aria-live="polite">
          {download.isPending ? (
            <p className={styles.note}>{render(TEMPLATES['export.busy'], {}, units)}</p>
          ) : null}
          {download.isSuccess ? (
            <p className={styles.note}>{render(TEMPLATES['export.started'], {}, units)}</p>
          ) : null}
        </div>
        {download.isError ? (
          <p role="alert" className={styles.alert}>
            {render(EXPORT_REFUSAL_COPY[exportRefusal(download.error)], {}, units)}
          </p>
        ) : null}
        <p className={styles.note}>{render(OFFLINE_USE[offline], {}, units)}</p>
      </section>

      <section className={styles.section} aria-labelledby="password-heading">
        <h2 id="password-heading" className={styles.heading}>
          {render(TEMPLATES['account.password.heading'], {}, units)}
        </h2>
        <ChangePasswordForm />
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
        {confirming && waiting !== null ? (
          <p ref={warning} tabIndex={-1} role="alert" className={styles.alert}>
            {render(TEMPLATES['today.signout-waiting'], { what: waiting }, units)}
          </p>
        ) : null}
        <div className={styles.signOutActions}>
          <Button ref={signOut} onClick={onSignOut} loading={logout.isPending}>
            {confirming && waiting !== null
              ? render(TEMPLATES['today.signout-anyway'], {}, units)
              : 'Sign out'}
          </Button>
          {confirming && waiting !== null ? (
            <Button
              variant="quiet"
              onClick={() => {
                setConfirming(false)
                // Cancel leaves with the warning; focus goes back to the button that asked.
                signOut.current?.focus()
              }}
            >
              {render(TEMPLATES['today.signout-cancel'], {}, units)}
            </Button>
          ) : null}
        </div>
      </section>
    </>
  )
}

export function SettingsPage() {
  const settings = useSettings()
  const view = useLoadView(settings)

  if (view === 'failed' || view === 'retrying') {
    return (
      <>
        <PageHeader title="Settings" />
        <ErrorState
          subject="Settings"
          onRetry={() => settings.refetch()}
          retrying={view === 'retrying'}
        />
      </>
    )
  }
  if (settings.data === undefined) {
    return <div className="skeleton" aria-busy="true" aria-label="Loading" />
  }
  return <SettingsForm initial={settings.data} />
}
