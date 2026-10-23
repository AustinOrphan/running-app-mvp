import { Link } from 'react-router-dom'
import { Segmented } from '../components/Segmented.tsx'
import { PageHeader } from '../components/PageHeader.tsx'
import { useTheme, type Theme } from '../components/Nav.tsx'
import styles from './MorePage.module.css'

const links = [
  { to: '/brief', label: 'Weekly brief', note: 'What changed and the next key session' },
  { to: '/goals', label: 'Goals', note: 'Races you are training for' },
  { to: '/stats', label: 'Stats', note: 'Fastest efforts, monthly and yearly totals' },
  { to: '/integrations', label: 'Integrations', note: 'Sync activities from other services' },
  { to: '/profile', label: 'Profile', note: 'Heart rate, availability and injury history' },
  { to: '/research', label: 'Research', note: 'The papers and rules behind the plan' },
  { to: '/settings', label: 'Settings', note: 'Units, display name, export' },
]

/** The phone-width list for pages that are not in the tab bar, plus the theme choice. */
export function MorePage() {
  const { theme, setTheme } = useTheme()

  return (
    <>
      <PageHeader title="More" />
      <nav aria-label="More pages">
        <ul className={styles.list}>
          {links.map((link) => (
            <li key={link.to}>
              <Link to={link.to} className={styles.row}>
                <span className={styles.label}>{link.label}</span>
                <span className={styles.note}>{link.note}</span>
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <section className={styles.theme}>
        <Segmented<Theme>
          label="Theme"
          value={theme}
          onChange={setTheme}
          options={[
            { value: 'system', label: 'System' },
            { value: 'light', label: 'Light' },
            { value: 'dark', label: 'Dark' },
          ]}
        />
      </section>
    </>
  )
}
