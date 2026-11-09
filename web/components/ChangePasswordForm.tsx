import { useState, type FormEvent } from 'react'
import { render } from '../../shared/copy/template.ts'
import { TEMPLATES } from '../../shared/copy/templates.ts'
import { useChangePassword } from '../api/auth.ts'
import { ApiError, fieldErrors } from '../api/client.ts'
import { Button } from './Button.tsx'
import { Field, Input } from './Field.tsx'
import { PasswordInput } from './PasswordInput.tsx'
import styles from './ChangePasswordForm.module.css'

/** No sentence of this form holds a distance or a pace, so the unit system cannot change a word. */
const WORDS_UNITS = 'km'

function refusalMessage(error: unknown): string {
  if (error instanceof ApiError && error.status === 429) {
    return render(TEMPLATES['account.password.too-many'], {}, WORDS_UNITS)
  }
  return render(TEMPLATES['account.password.not-changed'], {}, WORDS_UNITS)
}

/**
 * The current password, the new one and its confirmation. Used by the Password block of Settings and
 * by the screen that follows a first sign-in with a temporary password. `onChanged` runs after the
 * server has accepted the change.
 */
export function ChangePasswordForm({ onChanged }: { onChanged?: () => void }) {
  const change = useChangePassword()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [visible, setVisible] = useState(false)
  const [mismatch, setMismatch] = useState(false)
  const [done, setDone] = useState(false)

  const errors = fieldErrors(change.error)
  const formError =
    change.isError && Object.keys(errors).length === 0 ? refusalMessage(change.error) : undefined

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    setDone(false)
    if (next !== confirm) {
      setMismatch(true)
      return
    }
    setMismatch(false)
    change.mutate(
      { currentPassword: current, newPassword: next },
      {
        onSuccess: () => {
          setCurrent('')
          setNext('')
          setConfirm('')
          setDone(true)
          onChanged?.()
        },
      },
    )
  }

  return (
    <form className={styles.form} onSubmit={onSubmit} noValidate>
      <Field label="Current password" error={errors['currentPassword']}>
        {(control) => (
          <PasswordInput
            control={control}
            visible={visible}
            onToggle={() => {
              setVisible((value) => !value)
            }}
            toggleLabel="passwords"
            value={current}
            onChange={setCurrent}
            autoComplete="current-password"
          />
        )}
      </Field>
      <Field
        label="New password"
        hint={render(TEMPLATES['account.password.rules'], {}, WORDS_UNITS)}
        error={errors['newPassword']}
      >
        {(control) => (
          <Input
            {...control}
            type={visible ? 'text' : 'password'}
            value={next}
            autoComplete="new-password"
            onChange={(event) => {
              setNext(event.target.value)
            }}
          />
        )}
      </Field>
      <Field
        label="Confirm new password"
        error={
          mismatch ? render(TEMPLATES['account.password.mismatch'], {}, WORDS_UNITS) : undefined
        }
      >
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
      <div role="status" aria-live="polite">
        {done ? (
          <p className={styles.done}>
            {render(TEMPLATES['account.password.changed'], {}, WORDS_UNITS)}
          </p>
        ) : null}
      </div>
      {formError !== undefined ? (
        <p role="alert" className={styles.alert}>
          {formError}
        </p>
      ) : null}
      <div>
        <Button type="submit" variant="primary" loading={change.isPending}>
          {render(TEMPLATES['account.password.submit'], {}, WORDS_UNITS)}
        </Button>
      </div>
    </form>
  )
}
