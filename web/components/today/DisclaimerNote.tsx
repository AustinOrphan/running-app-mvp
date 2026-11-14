import { Link } from 'react-router-dom'
import { WARNING_SIGNS_PATH } from '../../../shared/copy/warningSigns.ts'
import styles from './DisclaimerNote.module.css'

export function DisclaimerNote() {
  return (
    <section aria-label="Disclaimer" className={styles.section}>
      <p className={styles.caption}>
        This plan is a sketch built from published research on groups of runners and from
        conservative defaults where research is missing. It cannot guarantee safety or performance,
        and it is not medical, nutrition or injury advice. Stop and see a qualified clinician for
        pain, illness or{' '}
        <Link to={WARNING_SIGNS_PATH} className={styles.link}>
          warning signs
        </Link>
        .
      </p>
      <p className={styles.caption}>
        <Link to="/research" className={styles.link}>
          How the numbers are graded
        </Link>
      </p>
    </section>
  )
}
