import { useState, type FormEvent } from 'react'
import { Navigate } from 'react-router-dom'
import { useLogin } from '../api/auth.ts'
import { ApiError, fieldErrors } from '../api/client.ts'
import { Button } from '../components/Button.tsx'
import { Field, Input, type FieldControlProps } from '../components/Field.tsx'
import styles from './LoginPage.module.css'

/** A password input with a show/hide toggle; `toggleLabel` completes "Show ..." and "Hide ...". */
export function PasswordInput({
  control,
  visible,
  onToggle,
  toggleLabel,
  value,
  onChange,
  autoComplete,
}: {
  control: FieldControlProps
  visible: boolean
  onToggle: () => void
  toggleLabel: string
  value: string
  onChange: (value: string) => void
  autoComplete: 'current-password' | 'new-password'
}) {
  return (
    <div className={styles.passwordWrap}>
      <Input
        {...control}
        type={visible ? 'text' : 'password'}
        value={value}
        autoComplete={autoComplete}
        onChange={(event) => {
          onChange(event.target.value)
        }}
        className={styles.passwordInput}
      />
      <button type="button" className={styles.toggle} onClick={onToggle}>
        {visible ? `Hide ${toggleLabel}` : `Show ${toggleLabel}`}
      </button>
    </div>
  )
}

/** "Try again in N minutes" from the limiter's retry time; falls back to the 15-minute window. */
function retryMessage(error: ApiError): string {
  const details = error.details as { retryAfterSec?: unknown } | undefined
  const seconds = typeof details?.retryAfterSec === 'number' ? details.retryAfterSec : 900
  const minutes = Math.max(1, Math.ceil(seconds / 60))
  return `Too many attempts. Try again in ${String(minutes)} ${minutes === 1 ? 'minute' : 'minutes'}.`
}

function loginMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 401) return 'Invalid email or password'
    if (error.status === 429) return retryMessage(error)
    if (error.status === 0) {
      return 'The server did not respond. Your entries are still in the form; try again.'
    }
  }
  return 'Sign-in failed. Check the details and try again.'
}

export function LoginPage() {
  const login = useLogin()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [visible, setVisible] = useState(false)

  if (login.isSuccess) return <Navigate to="/" replace />

  const errors = fieldErrors(login.error)
  const formError =
    login.isError && Object.keys(errors).length === 0 ? loginMessage(login.error) : undefined

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    login.mutate({ email: email.trim(), password })
  }

  return (
    <main className={styles.page}>
      <form className={styles.form} onSubmit={onSubmit} noValidate>
        <h1>Sign in</h1>
        {formError !== undefined ? (
          <p role="alert" className={styles.alert}>
            {formError}
          </p>
        ) : null}
        <Field label="Email" error={errors['email']}>
          {(control) => (
            <Input
              {...control}
              type="email"
              value={email}
              autoComplete="username"
              onChange={(event) => {
                setEmail(event.target.value)
              }}
            />
          )}
        </Field>
        <Field label="Password" error={errors['password']}>
          {(control) => (
            <PasswordInput
              control={control}
              visible={visible}
              onToggle={() => {
                setVisible((current) => !current)
              }}
              toggleLabel="password"
              value={password}
              onChange={setPassword}
              autoComplete="current-password"
            />
          )}
        </Field>
        <Button type="submit" variant="primary" loading={login.isPending}>
          Sign in
        </Button>
      </form>
    </main>
  )
}
