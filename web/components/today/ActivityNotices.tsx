import { render } from '../../../shared/copy/template.ts'
import { TEMPLATES } from '../../../shared/copy/templates.ts'
import { useActivityNotices } from '../../api/activityOutbox.ts'
import { Button } from '../Button.tsx'
import styles from '../strength/StrengthLogNotices.module.css'

/**
 * What the outbox sent later and the server refused, for a run or a rating: one notice for each,
 * in the server's own words (a session another phone had already logged), with a control to
 * dismiss it. The sheet that made the write is closed by then, so nothing else on the page would
 * clear it. Nothing is shown with none.
 */
export function ActivityNotices() {
  const { notices, dismiss } = useActivityNotices()
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
