import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { render } from '../../shared/copy/template.ts'
import { TEMPLATES } from '../../shared/copy/templates.ts'
import type { Units, UserSettings } from '../../shared/types.ts'
import { useLogout } from '../api/auth.ts'
import { fieldErrors } from '../api/client.ts'
import { useSettings, useUpdateSettings, type SettingsPatch } from '../api/settings.ts'
import { Button } from '../components/Button.tsx'
import { Field, Input } from '../components/Field.tsx'
import { useTheme, type Theme } from '../components/Nav.tsx'
import { PageHeader } from '../components/PageHeader.tsx'
import { Segmented } from '../components/Segmented.tsx'
import { useToast } from '../components/Toast.tsx'
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

function SettingsForm({ initial }: { initial: UserSettings }) {
  const navigate = useNavigate()
  const toast = useToast()
  const { theme, setTheme } = useTheme()
  const update = useUpdateSettings()
  const logout = useLogout()
  const offline = useOfflineStatus()

  // What the server holds, as of the last successful save; the form sends only the differences.
  const [saved, setSaved] = useState(initial)
  const [units, setUnits] = useState<Units>(initial.units)
  const [displayName, setDisplayName] = useState(initial.displayName ?? '')

  const errors = fieldErrors(update.error)
  const otherError =
    update.isError && Object.keys(errors).length === 0
      ? 'Settings not saved. The server did not accept the change; try again.'
      : undefined

  function save(patch: SettingsPatch, onFailure?: () => void) {
    update.mutate(patch, {
      onSuccess: (next) => {
        setSaved(next)
        toast.show('Settings saved')
      },
      onError: onFailure,
    })
  }

  function onUnitsChange(next: Units) {
    if (next === units) return
    const previous = units
    setUnits(next)
    save({ units: next }, () => {
      setUnits(previous)
    })
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    const name = displayName.trim()
    if (name === (saved.displayName ?? '')) {
      toast.show('Settings saved')
      return
    }
    save({ displayName: name })
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
      <form className={`${styles.section} ${styles.first}`} onSubmit={onSubmit} noValidate>
        <Segmented<Units>
          label="Distance units"
          value={units}
          onChange={onUnitsChange}
          options={[
            { value: 'mi', label: 'Miles' },
            { value: 'km', label: 'Kilometres' },
          ]}
        />
        <Field label="Display name" error={errors['displayName']}>
          {(control) => (
            <Input
              {...control}
              type="text"
              value={displayName}
              autoComplete="name"
              onChange={(event) => {
                setDisplayName(event.target.value)
              }}
            />
          )}
        </Field>
        {otherError !== undefined ? (
          <p role="alert" className={styles.alert}>
            {otherError}
          </p>
        ) : null}
        <div>
          <Button type="submit" variant="primary" loading={update.isPending}>
            Save settings
          </Button>
        </div>
      </form>

      <section className={styles.section} aria-labelledby="appearance-heading">
        <h2 id="appearance-heading" className={styles.heading}>
          Appearance
        </h2>
        <Segmented<Theme>
          label="Theme"
          value={theme}
          onChange={setTheme}
          options={[
            { value: 'system', label: 'System' },
            { value: 'light', label: 'Light' },
            { value: 'dark', label: 'Dark' },
          ]}
        />
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
