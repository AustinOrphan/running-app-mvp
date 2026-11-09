import { render } from '../../shared/copy/template.ts'
import { TEMPLATES } from '../../shared/copy/templates.ts'
import { ChangePasswordForm } from '../components/ChangePasswordForm.tsx'
import styles from './SetupPage.module.css'

/**
 * Shown after a sign-in with a temporary password (an account made by `create-user`), in place of
 * every other page. The form clears the flag on success, and the gate then lets the app through.
 */
export function ChangePasswordPage() {
  return (
    <main className={styles.page}>
      <div className={styles.form}>
        <p className={styles.wordmark}>Running log</p>
        <h1>{render(TEMPLATES['account.password.forced-title'], {}, 'km')}</h1>
        <p className={styles.intro}>
          {render(TEMPLATES['account.password.forced-intro'], {}, 'km')}
        </p>
        <ChangePasswordForm />
      </div>
    </main>
  )
}
