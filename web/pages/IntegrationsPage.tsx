import { useId, useState, type FormEvent, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { IntegrationStatus } from '../../shared/types.ts'
import {
  useConnectIntegration,
  useCreatePushToken,
  useDisconnectIntegration,
  useIntegrations,
  useSyncIntegration,
  type ConnectResult,
} from '../api/integrations.ts'
import { ApiError, fieldErrors } from '../api/client.ts'
import { Button } from '../components/Button.tsx'
import { DataInUse } from '../components/DataInUse.tsx'
import { Field, Input, Textarea } from '../components/Field.tsx'
import { PageHeader } from '../components/PageHeader.tsx'
import { Skeleton } from '../components/Skeleton.tsx'
import { SyncHistory } from '../components/SyncHistory.tsx'
import { WristSettings } from '../components/WristSettings.tsx'
import { useToast } from '../components/Toast.tsx'
import styles from './IntegrationsPage.module.css'

const STATUS_LABEL: Record<IntegrationStatus['status'], string> = {
  disconnected: 'Not connected',
  connected: 'Connected',
  needs_auth: 'Needs reconnecting',
  error: 'Needs attention',
}

const GARMIN_RISK =
  'Garmin Connect is an unofficial connection: Garmin has not approved it and may block or rate-limit the sign-in at any time. Only tokens are stored, never the password. It is off until connected, and disconnecting forgets the tokens.'

function formatWhen(iso: string): string {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString()
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined
}

/** The non-secret part of the connection worth showing on a connected card. */
function configSummary(provider: string, config: Record<string, unknown>): ReactNode {
  if (provider === 'folder') {
    const path = text(config['path'])
    return path === undefined ? null : (
      <p className={styles.meta}>
        Watching <code>{path}</code>
      </p>
    )
  }
  if (provider === 'intervals') {
    const id = text(config['athleteId'])
    return id === undefined ? null : <p className={styles.meta}>Athlete {id}</p>
  }
  if (provider === 'strava') {
    const id = text(config['clientId'])
    return id === undefined ? null : <p className={styles.meta}>Application {id}</p>
  }
  return null
}

interface FormProps {
  submit: (input: unknown) => void
  pending: boolean
  errors: Record<string, string>
  failure: string | undefined
}

function FormAlert({ failure }: { failure: string | undefined }) {
  return failure === undefined ? null : (
    <p role="alert" className={styles.alert}>
      {failure}
    </p>
  )
}

function onSubmitWith(action: () => void) {
  return (event: FormEvent) => {
    event.preventDefault()
    action()
  }
}

/** `reconnect`: the key was refused, so the same form asks for a new one and says so on its button. */
function IntervalsForm({
  submit,
  pending,
  errors,
  failure,
  reconnect,
}: FormProps & { reconnect: boolean }) {
  const [athleteId, setAthleteId] = useState('')
  const [apiKey, setApiKey] = useState('')
  return (
    <form
      className={styles.form}
      noValidate
      onSubmit={onSubmitWith(() => {
        submit({ athleteId, apiKey })
      })}
    >
      <Field
        label="Athlete id"
        hint="Shown on the intervals.icu settings page, for example i12345."
        error={errors['athleteId']}
      >
        {(control) => (
          <Input
            {...control}
            type="text"
            value={athleteId}
            autoComplete="off"
            onChange={(event) => {
              setAthleteId(event.target.value)
            }}
          />
        )}
      </Field>
      <Field
        label="API key"
        hint="Create one under Settings, Developer Settings. It is stored encrypted."
        error={errors['apiKey']}
      >
        {(control) => (
          <Input
            {...control}
            type="password"
            value={apiKey}
            autoComplete="off"
            onChange={(event) => {
              setApiKey(event.target.value)
            }}
          />
        )}
      </Field>
      <FormAlert failure={failure} />
      <div>
        <Button type="submit" variant="primary" loading={pending}>
          {reconnect ? 'Reconnect' : 'Connect'}
        </Button>
      </div>
    </form>
  )
}

function StravaSteps() {
  const host = window.location.host
  return (
    <ol className={styles.steps}>
      <li>Open strava.com/settings/api and create an API application (any name and category).</li>
      <li>
        Set Authorization Callback Domain to <code>{host}</code>.
      </li>
      <li>Copy the client id and client secret into the form below.</li>
      <li>
        Choose Connect and authorise, then approve access on Strava. Activities arrive on the next
        sync.
      </li>
    </ol>
  )
}

function StravaForm({ submit, pending, errors, failure }: FormProps) {
  const [clientId, setClientId] = useState('')
  const [clientSecret, setClientSecret] = useState('')
  const [publicBaseUrl, setPublicBaseUrl] = useState('')
  return (
    <>
      <StravaSteps />
      <form
        className={styles.form}
        noValidate
        onSubmit={onSubmitWith(() => {
          const base = publicBaseUrl.trim()
          submit({ clientId, clientSecret, ...(base === '' ? {} : { publicBaseUrl: base }) })
        })}
      >
        <Field label="Client id" error={errors['clientId']}>
          {(control) => (
            <Input
              {...control}
              type="text"
              value={clientId}
              autoComplete="off"
              onChange={(event) => {
                setClientId(event.target.value)
              }}
            />
          )}
        </Field>
        <Field label="Client secret" hint="Stored encrypted." error={errors['clientSecret']}>
          {(control) => (
            <Input
              {...control}
              type="password"
              value={clientSecret}
              autoComplete="off"
              onChange={(event) => {
                setClientSecret(event.target.value)
              }}
            />
          )}
        </Field>
        <Field
          label="Public address (optional)"
          hint="Only when this app is reached through a different address than the one in the browser, for example https://running.example.com."
          error={errors['publicBaseUrl']}
        >
          {(control) => (
            <Input
              {...control}
              type="url"
              value={publicBaseUrl}
              autoComplete="off"
              onChange={(event) => {
                setPublicBaseUrl(event.target.value)
              }}
            />
          )}
        </Field>
        <FormAlert failure={failure} />
        <div>
          <Button type="submit" variant="primary" loading={pending}>
            Connect and authorise
          </Button>
        </div>
      </form>
    </>
  )
}

function GarminForm({
  submit,
  pending,
  errors,
  failure,
  mfaPending,
}: FormProps & { mfaPending: boolean }) {
  const [mode, setMode] = useState<'login' | 'tokens'>('login')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [tokens, setTokens] = useState('')
  const [code, setCode] = useState('')
  const [acknowledged, setAcknowledged] = useState(false)
  const [ackError, setAckError] = useState(false)
  const ackId = useId()

  function withAck(build: () => unknown) {
    if (!acknowledged) {
      setAckError(true)
      return
    }
    setAckError(false)
    submit(build())
  }

  const acknowledgement = (
    <>
      <div className={styles.check}>
        <input
          id={ackId}
          type="checkbox"
          checked={acknowledged}
          onChange={(event) => {
            setAcknowledged(event.target.checked)
            setAckError(false)
          }}
        />
        <label htmlFor={ackId}>I understand this is unofficial and Garmin may block it</label>
      </div>
      {ackError || errors['acknowledgeRisk'] !== undefined ? (
        <p role="alert" className={styles.alert}>
          Tick the box to confirm you understand this is unofficial and Garmin may block it.
        </p>
      ) : null}
    </>
  )

  if (mfaPending) {
    return (
      <form
        className={styles.form}
        noValidate
        onSubmit={onSubmitWith(() => {
          withAck(() => ({ mode: 'mfa', code, acknowledgeRisk: true }))
        })}
      >
        <Field
          label="Verification code"
          hint="Garmin sent a code to finish the sign-in. It expires after 10 minutes."
          error={errors['code']}
        >
          {(control) => (
            <Input
              {...control}
              type="text"
              inputMode="numeric"
              value={code}
              autoComplete="one-time-code"
              onChange={(event) => {
                setCode(event.target.value)
              }}
            />
          )}
        </Field>
        {acknowledgement}
        <FormAlert failure={failure} />
        <div>
          <Button type="submit" variant="primary" loading={pending}>
            Verify
          </Button>
        </div>
      </form>
    )
  }

  if (mode === 'tokens') {
    return (
      <form
        className={styles.form}
        noValidate
        onSubmit={onSubmitWith(() => {
          withAck(() => ({ mode: 'tokens', tokens, acknowledgeRisk: true }))
        })}
      >
        <p className={styles.note}>
          If the sign-in is blocked (HTTP 403) or rate limited (HTTP 429), paste the token file that
          python-garminconnect writes after a login from another machine.
        </p>
        <Field
          label="Token JSON"
          hint="Needs access_token, refresh_token and expires_in or expires_at."
          error={errors['tokens']}
        >
          {(control) => (
            <Textarea
              {...control}
              rows={5}
              value={tokens}
              autoComplete="off"
              spellCheck={false}
              onChange={(event) => {
                setTokens(event.target.value)
              }}
            />
          )}
        </Field>
        {acknowledgement}
        <FormAlert failure={failure} />
        <div className={styles.row}>
          <Button type="submit" variant="primary" loading={pending}>
            Connect
          </Button>
          <Button
            variant="quiet"
            onClick={() => {
              setMode('login')
            }}
          >
            Sign in instead
          </Button>
        </div>
      </form>
    )
  }

  return (
    <form
      className={styles.form}
      noValidate
      onSubmit={onSubmitWith(() => {
        withAck(() => ({ mode: 'login', username, password, acknowledgeRisk: true }))
      })}
    >
      <Field label="Username" error={errors['username']}>
        {(control) => (
          <Input
            {...control}
            type="text"
            value={username}
            autoComplete="off"
            onChange={(event) => {
              setUsername(event.target.value)
            }}
          />
        )}
      </Field>
      <Field label="Password" hint="Used once to sign in; not stored." error={errors['password']}>
        {(control) => (
          <Input
            {...control}
            type="password"
            value={password}
            autoComplete="off"
            onChange={(event) => {
              setPassword(event.target.value)
            }}
          />
        )}
      </Field>
      {acknowledgement}
      <FormAlert failure={failure} />
      <div className={styles.row}>
        <Button type="submit" variant="primary" loading={pending}>
          Connect
        </Button>
        <Button
          variant="quiet"
          onClick={() => {
            setMode('tokens')
          }}
        >
          Paste tokens instead
        </Button>
      </div>
    </form>
  )
}

function FolderForm({ submit, pending, errors, failure }: FormProps) {
  const [path, setPath] = useState('')
  return (
    <form
      className={styles.form}
      noValidate
      onSubmit={onSubmitWith(() => {
        submit({ path })
      })}
    >
      <Field
        label="Folder path"
        hint="A folder on the server. In Docker it must be mounted into the container."
        error={errors['path']}
      >
        {(control) => (
          <Input
            {...control}
            type="text"
            value={path}
            autoComplete="off"
            onChange={(event) => {
              setPath(event.target.value)
            }}
          />
        )}
      </Field>
      <FormAlert failure={failure} />
      <div>
        <Button type="submit" variant="primary" loading={pending}>
          Connect
        </Button>
      </div>
    </form>
  )
}

function PushSetup({ provider, pushEnabled }: { provider: string; pushEnabled: boolean }) {
  const toast = useToast()
  const create = useCreatePushToken()
  const [token, setToken] = useState<string | null>(null)
  const url = `${window.location.origin}/api/ingest/${provider}`

  function onCreate() {
    create.mutate(provider, {
      onSuccess: (result) => {
        setToken(result.token)
      },
    })
  }

  async function onCopy() {
    if (token === null) return
    try {
      await navigator.clipboard.writeText(token)
      toast.show('Token copied')
    } catch {
      toast.show('Copy failed; select the token and copy it by hand')
    }
  }

  return (
    <>
      <p className={styles.note}>
        Health Auto Export (iOS, Premium tier) posts workouts and daily metrics to this server. To
        bring in older history, use Import and choose the Apple Health export file.
      </p>
      {token !== null ? (
        <div className={styles.tokenBox}>
          <code className={styles.token}>{token}</code>
          <p className={styles.note}>
            This token is shown once. Copy it now; creating another replaces it.
          </p>
          <div>
            <Button
              onClick={() => {
                void onCopy()
              }}
            >
              Copy token
            </Button>
          </div>
        </div>
      ) : null}
      {pushEnabled || token !== null ? (
        <ol className={styles.steps}>
          <li>
            Add a REST API automation and set the URL to <code>{url}</code>.
          </li>
          <li>Add a header named Authorization with the value Bearer followed by the token.</li>
          <li>
            Choose JSON version 2, turn Include Route Data on, and set the sync to Since Last Sync.
          </li>
        </ol>
      ) : null}
      {create.isError ? (
        <p role="alert" className={styles.alert}>
          The push token was not created. The server did not accept the request; try again.
        </p>
      ) : null}
      <div>
        <Button onClick={onCreate} loading={create.isPending}>
          {pushEnabled ? 'Create new push token' : 'Create push token'}
        </Button>
      </div>
    </>
  )
}

function SyncControls({ provider }: { provider: string }) {
  const toast = useToast()
  const sync = useSyncIntegration()
  const [from, setFrom] = useState('')

  function onSync() {
    sync.mutate(
      { provider, ...(from === '' ? {} : { from }) },
      {
        onSuccess: () => {
          toast.show('Sync started')
        },
      },
    )
  }

  return (
    <div className={styles.row}>
      <div className={styles.dateField}>
        <Field label="Backfill from" hint="Optional; the default is the last year.">
          {(control) => (
            <Input
              {...control}
              type="date"
              value={from}
              onChange={(event) => {
                setFrom(event.target.value)
              }}
            />
          )}
        </Field>
      </div>
      <Button onClick={onSync} loading={sync.isPending}>
        Sync now
      </Button>
      {sync.isError ? (
        <p role="alert" className={styles.alert}>
          Sync did not start. The server did not accept the request; try again.
        </p>
      ) : null}
    </div>
  )
}

/** The fields each connect form shows an error beside; any other field error goes in the alert. */
const FORM_FIELDS: Record<string, string[]> = {
  intervals: ['athleteId', 'apiKey'],
  strava: ['clientId', 'clientSecret', 'publicBaseUrl'],
  garmin: ['username', 'password', 'code', 'tokens', 'acknowledgeRisk'],
  folder: ['path'],
}

function failureMessage(provider: string, error: unknown): string | undefined {
  if (error === null || error === undefined) return undefined
  if (!(error instanceof ApiError)) return 'Not connected. The server did not respond; try again.'
  const errors = fieldErrors(error)
  const keys = Object.keys(errors)
  if (keys.length === 0) return error.message
  const shown = FORM_FIELDS[provider] ?? []
  const stray = keys.filter((key) => !shown.includes(key)).map((key) => errors[key])
  return stray.length === 0 ? undefined : stray.join(' ')
}

function ProviderCard({ item }: { item: IntegrationStatus }) {
  const { provider, info } = item
  const headingId = useId()
  const toast = useToast()
  const connect = useConnectIntegration()
  const disconnect = useDisconnectIntegration()
  const [editing, setEditing] = useState(false)
  const [mfaPending, setMfaPending] = useState(false)

  const channels = info.channels
  const isPull = channels.includes('pull')
  const isPush = channels.includes('push')
  const isFolder = channels.includes('folder')
  const hasConnection = item.status !== 'disconnected'
  // `error` is a failed run with the credentials still in place: keep Sync now, not the form.
  const usable = item.status === 'connected' || item.status === 'error'
  const showForm = (isPull || isFolder) && (!usable || editing || mfaPending)

  function submit(input: unknown) {
    connect.mutate(
      { provider, input },
      {
        onSuccess: (result: ConnectResult) => {
          if (result.authorizeUrl !== undefined) {
            window.location.assign(result.authorizeUrl)
            return
          }
          if (result.config['mfaRequired'] === true) {
            setMfaPending(true)
            return
          }
          setMfaPending(false)
          setEditing(false)
          toast.show(`${info.label} connected`)
        },
      },
    )
  }

  const formProps: FormProps = {
    submit,
    pending: connect.isPending,
    errors: fieldErrors(connect.error),
    failure: failureMessage(provider, connect.error),
  }

  let form: ReactNode = null
  if (showForm) {
    switch (provider) {
      case 'intervals':
        form = <IntervalsForm {...formProps} reconnect={item.status === 'needs_auth'} />
        break
      case 'strava':
        form = <StravaForm {...formProps} />
        break
      case 'garmin':
        form = <GarminForm {...formProps} mfaPending={mfaPending} />
        break
      case 'folder':
        form = <FolderForm {...formProps} />
        break
      default:
        form = null
    }
  }

  const paused = item.lastSyncStatus === 'paused'

  return (
    <section className={styles.card} aria-labelledby={headingId}>
      <div className={styles.head}>
        <h2 id={headingId} className={styles.name}>
          {info.label}
        </h2>
        {info.experimental ? <span className={styles.badge}>Experimental</span> : null}
        <span
          className={`${styles.state} ${item.status === 'connected' ? styles.stateOn : ''}`.trim()}
        >
          {STATUS_LABEL[item.status]}
        </span>
      </div>

      {info.experimental ? <p className={styles.risk}>{GARMIN_RISK}</p> : null}

      {hasConnection ? configSummary(provider, item.config) : null}
      {item.lastSyncAt !== null ? (
        <p className={styles.meta}>Last sync {formatWhen(item.lastSyncAt)}</p>
      ) : null}
      {paused ? (
        <p className={styles.note}>
          The last run paused to stay within the service&apos;s limits. It will continue from where
          it stopped on the next scheduled run.
        </p>
      ) : null}
      {item.lastError !== null && item.lastError !== '' ? (
        <p className={styles.note}>{item.lastError}</p>
      ) : null}

      {isPush ? <PushSetup provider={provider} pushEnabled={item.pushEnabled} /> : null}

      {form}

      {isPull && usable ? <SyncControls provider={provider} /> : null}

      {channels.includes('publish') && usable ? <WristSettings /> : null}

      {isFolder && usable ? (
        <p className={styles.note}>The folder is scanned every 5 minutes.</p>
      ) : null}

      {hasConnection ? <SyncHistory provider={provider} /> : null}

      <div className={styles.row}>
        {usable && (isPull || isFolder) && !editing && !mfaPending ? (
          <Button
            variant="quiet"
            onClick={() => {
              setEditing(true)
            }}
          >
            Change connection
          </Button>
        ) : null}
        {hasConnection || item.pushEnabled ? (
          <Button
            variant="quiet"
            loading={disconnect.isPending}
            onClick={() => {
              disconnect.mutate(provider, {
                onSuccess: () => {
                  setEditing(false)
                  setMfaPending(false)
                  toast.show(`${info.label} disconnected`)
                },
              })
            }}
          >
            Disconnect
          </Button>
        ) : null}
      </div>
      {hasConnection || item.pushEnabled ? (
        <p className={styles.note}>Disconnecting forgets the credentials; activities stay.</p>
      ) : null}
      {disconnect.isError ? (
        <p role="alert" className={styles.alert}>
          Not disconnected. The server did not accept the request; try again.
        </p>
      ) : null}

      <p className={styles.note}>
        <a className={styles.link} href={info.docsUrl} target="_blank" rel="noreferrer">
          About {info.label}
        </a>
      </p>
    </section>
  )
}

function CallbackNotice({ list }: { list: IntegrationStatus[] }) {
  const [params] = useSearchParams()
  const connected = params.get('connected')
  const error = params.get('error')
  if (error !== null && error !== '') {
    return (
      <p role="alert" className={styles.alert}>
        The authorisation did not finish: {error}
      </p>
    )
  }
  if (connected !== null && connected !== '') {
    const label = list.find((item) => item.provider === connected)?.info.label ?? connected
    return <p className={styles.notice}>{label} is connected.</p>
  }
  return null
}

export function IntegrationsPage() {
  const integrations = useIntegrations()

  if (integrations.isError) {
    return (
      <>
        <PageHeader title="Integrations" />
        <p role="alert" className={styles.alert}>
          Integrations did not load. The server did not respond; reload the page to try again.
        </p>
      </>
    )
  }
  if (integrations.isPending) {
    return (
      <>
        <PageHeader title="Integrations" />
        <Skeleton lines={4} />
      </>
    )
  }

  return (
    <>
      <PageHeader
        title="Integrations"
        context="Bring activities and daily health data in from other services."
      />
      <DataInUse />
      <CallbackNotice list={integrations.data} />
      <div className={styles.list}>
        {integrations.data.map((item) => (
          <ProviderCard key={item.provider} item={item} />
        ))}
      </div>
    </>
  )
}
