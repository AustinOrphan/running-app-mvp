import { Link } from 'react-router-dom'
import { useRacePlan } from '../api/race.ts'
import { Chevron, destinationGroups } from '../components/destinations.tsx'
import { PageHeader } from '../components/PageHeader.tsx'
import styles from './MorePage.module.css'

/**
 * The phone-width list for every page that is not a tab, in three groups (Training, Data, You)
 * with the tab bar's icons. The side rail lists the same groups, so the theme choice is not here:
 * Settings has it.
 */
export function MorePage() {
  // The race plan exists for the goal race of an ultra goal only; the row waits for the answer.
  const hasRacePlan = useRacePlan().data?.plan != null

  return (
    <>
      <PageHeader title="More" />
      <nav aria-label="More pages" className={styles.groups}>
        {destinationGroups(hasRacePlan).map((group) => (
          <section key={group.id} aria-labelledby={`more-${group.id}`} className={styles.group}>
            <h2 id={`more-${group.id}`} className={styles.title}>
              {group.title}
            </h2>
            <ul className={styles.list}>
              {group.items.map((item) => (
                <li key={item.to}>
                  <Link to={item.to} className={styles.row}>
                    <span className={styles.icon}>{item.icon}</span>
                    <span className={styles.text}>
                      <span className={styles.label}>{item.label}</span>
                      <span className={styles.note}>{item.note}</span>
                    </span>
                    <Chevron />
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </nav>
    </>
  )
}
