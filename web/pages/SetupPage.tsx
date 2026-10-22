import { useState, type FormEvent } from 'react'
import { Navigate } from 'react-router-dom'
import { useSetup, useSetupStatus } from '../api/auth.ts'
import { ApiError, fieldErrors } from '../api/client.ts'
import { Button } from '../components/Button.tsx'
import { Field, Input } from '../components/Field.tsx'
import { PasswordInput } from './LoginPage.tsx'
import styles from './SetupPage.module.css'

function setupMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 409) return 'An account already exists. Sign in instead.'
    if (error.status === 0) {
      return 'The server did not respond. Your entries are still in the form; try again.'
    }
  }
  return 'The account was not created. Check the details and try again.'
}

export function SetupPage() {
  const status = useSetupStatus()
  const setup = useSetup()
  const [email, setEmail] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [visible, setVisible] = useState(false)
  const [mismatch, setMismatch] = useState(false)

  // Checked first: creating the account marks setup as done, which must not bounce to /login.
  if (setup.isSuccess) return <Navigate to="/" replace />
  if (status.isError) {
    return (
      <main className={styles.page}>
        <p role="alert" className={styles.alert}>
          The server did not respond. Reload the page to try again.
        </p>
      </main>
    )
  }
  if (status.isPending) {
    return (
      <main className={styles.page} aria-busy="true">
        <div className="skeleton" aria-label="Loading" />
      </main>
    )
  }
  if (!status.data.needsSetup) return <Navigate to="/login" replace />

  const errors = fieldErrors(setup.error)
  const formError =
    setup.isError && Object.keys(errors).length === 0 ? setupMessage(setup.error) : undefined

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    if (password !== confirm) {
      setMismatch(true)
      return
    }
    setMismatch(false)
    const name = displayName.trim()
    setup.mutate({
      email: email.trim(),
      password,
      ...(name === '' ? {} : { displayName: name }),
    })
  }

  return (
    <main className={styles.page}>
      <form className={styles.form} onSubmit={onSubmit} noValidate>
        <h1>Set up your training log</h1>
        <p className={styles.intro}>Create the one account for this install.</p>
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
        <Field label="Display name (optional)" error={errors['displayName']}>
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
        <Field label="Password" hint="At least 12 characters." error={errors['password']}>
          {(control) => (
            <PasswordInput
              control={control}
              visible={visible}
              onToggle={() => {
                setVisible((current) => !current)
              }}
              toggleLabel="passwords"
              value={password}
              onChange={setPassword}
              autoComplete="new-password"
            />
          )}
        </Field>
        <Field label="Confirm password" error={mismatch ? 'Passwords do not match' : undefined}>
          {(control) => (
            <Input
              {...control}
              type={visible ? 'text' : 'password'}
              value={confirm}
              autoComplete="new-password"
              onChange={(event) => {
                setConfirm(event.target.value)
                setMismatch(false)
              }}
            />
          )}
        </Field>
        <Button type="submit" variant="primary" loading={setup.isPending}>
          Create account
        </Button>
      </form>
    </main>
  )
}
