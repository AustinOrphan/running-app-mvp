import { useId, useState } from 'react'
import { PARQ_PLUS_URL, PLAN_NOTICE_VERSION } from '../../shared/domain/planNotice.ts'
import { render } from '../../shared/copy/template.ts'
import { TEMPLATES } from '../../shared/copy/templates.ts'
import type { PlanNoticeView } from '../../shared/types.ts'
import { useConfirmPlanNotice } from '../api/planNotice.ts'
import { Button } from './Button.tsx'
import styles from './PlanNotice.module.css'

function words(id: keyof typeof TEMPLATES): string {
  return render(TEMPLATES[id], {}, 'km')
}

/** The link to the official page. The form itself is never shown or asked for in the app. */
function ParqLink() {
  return (
    <a href={PARQ_PLUS_URL} target="_blank" rel="noopener" className={styles.link}>
      {words('plannotice.link')}
    </a>
  )
}

/**
 * The health notice (FS1): shown in place of the generate form until it is confirmed, and in the
 * Profile for an account that already had a plan. It says the app is not medical advice, points to
 * the official PAR-Q+ and asks for one deliberate confirmation. A runner whose profile birth year
 * makes them under 18 gets the age sentence and no way to confirm.
 */
export function PlanNotice({ notice }: { notice: PlanNoticeView }) {
  const headingId = useId()
  const confirm = useConfirmPlanNotice()
  const [adult, setAdult] = useState(false)

  if (notice.age === 'under') {
    return (
      <section className={styles.notice} aria-labelledby={headingId}>
        <h2 id={headingId} className={styles.heading}>
          {words('plannotice.title')}
        </h2>
        <p className={styles.callout}>{words('plannotice.under')}</p>
        <p className={styles.text}>{words('plannotice.age')}</p>
      </section>
    )
  }

  const needsAge = notice.age === 'ask'
  return (
    <section className={styles.notice} aria-labelledby={headingId}>
      <h2 id={headingId} className={styles.heading}>
        {words('plannotice.title')}
      </h2>
      <p className={styles.lead}>{words('plannotice.not-medical')}</p>
      <p className={styles.text}>{words('plannotice.parq')}</p>
      <p className={styles.text}>{words('plannotice.follow')}</p>
      <p className={styles.text}>{words('plannotice.keeps')}</p>
      <div>
        <ParqLink />
      </div>
      <p className={styles.text}>{words('plannotice.age')}</p>
      {needsAge ? (
        <label className={styles.check}>
          <input
            type="checkbox"
            checked={adult}
            onChange={(event) => {
              setAdult(event.target.checked)
            }}
          />
          {words('plannotice.age-check')}
        </label>
      ) : null}
      {confirm.isError ? (
        <p role="alert" className={styles.error}>
          {confirm.error.message}
        </p>
      ) : null}
      <div>
        <Button
          variant="primary"
          loading={confirm.isPending}
          disabled={needsAge && !adult}
          onClick={() => {
            confirm.mutate({
              version: PLAN_NOTICE_VERSION,
              ...(needsAge ? { ageConfirmed: true } : {}),
            })
          }}
        >
          {words('plannotice.confirm')}
        </Button>
      </div>
    </section>
  )
}

/** The Profile's block: the notice itself until it is confirmed, then the date and the link. */
export function PlanNoticeStanding({ notice }: { notice: PlanNoticeView }) {
  const headingId = useId()
  if (notice.confirmedAt === null || notice.confirmedVersion === null || notice.age === 'under') {
    return <PlanNotice notice={notice} />
  }
  return (
    <section className={styles.notice} aria-labelledby={headingId}>
      <h2 id={headingId} className={styles.heading}>
        {words('plannotice.profile-title')}
      </h2>
      <p className={styles.text}>
        {render(
          TEMPLATES['plannotice.confirmed'],
          { date: new Date(notice.confirmedAt).toLocaleDateString() },
          'km',
        )}
      </p>
      <div>
        <ParqLink />
      </div>
    </section>
  )
}
