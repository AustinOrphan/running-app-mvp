import { render } from '../../../shared/copy/template.ts'
import { TEMPLATES } from '../../../shared/copy/templates.ts'
import { useStrengthLogNotices } from '../../api/strength.ts'
import { Button } from '../Button.tsx'
import styles from './StrengthLogNotices.module.css'

/**
 * What the outbox sent later and the server refused, for the strength logs: one notice for each, with
 * a control of its own to dismiss it (design 9.6). The sheet that made the log is closed by then, so
 * there is no next step on the surface that would clear the notice; Today's check-in row and the
 * Strength page show them with this one component, in the same words. Nothing is shown with none.
 */
export function StrengthLogNotices() {
  const { notices, dismiss } = useStrengthLogNotices()
  return (
    <>
      {notices.map((notice) => (
        <div key={notice.id} className={styles.dismissable}>
          <p role="alert" className={styles.notice}>
            {notice.message}
          </p>
          <Button
            variant="quiet"
            className={styles.dismiss}
            onClick={() => {
              dismiss(notice.id)
            }}
          >
            {render(TEMPLATES['today.outbox.dismiss'], {}, 'km')}
          </Button>
        </div>
      ))}
    </>
  )
}
