import { useCallback, useSyncExternalStore, type ReactNode } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useRacePlan } from '../api/race.ts'
import { destinationGroups, MORE_PATHS } from './destinations.tsx'
import styles from './Nav.module.css'
import { useMediaQuery } from './useMediaQuery.ts'

export type Theme = 'system' | 'light' | 'dark'

const THEME_KEY = 'rl_theme'
const themeListeners = new Set<() => void>()

function isTheme(value: unknown): value is Theme {
  return value === 'system' || value === 'light' || value === 'dark'
}

/** The DOM is the source of truth: a `data-theme` attribute, absent for `system`. */
function readTheme(): Theme {
  const value = document.documentElement.getAttribute('data-theme')
  return value === 'light' || value === 'dark' ? value : 'system'
}

function applyTheme(theme: Theme): void {
  if (theme === 'system') document.documentElement.removeAttribute('data-theme')
  else document.documentElement.setAttribute('data-theme', theme)
  for (const listener of themeListeners) listener()
}

/** Puts the remembered choice on `<html>`; storage can be blocked, so a failure is ignored. */
export function restoreTheme(): void {
  try {
    const stored = localStorage.getItem(THEME_KEY)
    if (isTheme(stored)) applyTheme(stored)
  } catch {
    /* private window or blocked storage: keep following the system */
  }
}

function subscribeTheme(listener: () => void): () => void {
  themeListeners.add(listener)
  return () => {
    themeListeners.delete(listener)
  }
}

/** Theme choice shared by every caller; `system` follows the OS, the others override it. */
export function useTheme(): { theme: Theme; setTheme: (t: Theme) => void } {
  const theme = useSyncExternalStore(subscribeTheme, readTheme, () => 'system' as const)
  const setTheme = useCallback((next: Theme) => {
    applyTheme(next)
    try {
      localStorage.setItem(THEME_KEY, next)
    } catch {
      /* the choice still applies for this visit */
    }
  }, [])
  return { theme, setTheme }
}

if (typeof document !== 'undefined') restoreTheme()

const themeOrder: Theme[] = ['system', 'light', 'dark']
const themeLabel: Record<Theme, string> = { system: 'System', light: 'Light', dark: 'Dark' }

interface Item {
  to: string
  label: string
  /** Paths (and their children) on which the item is current. */
  paths: string[]
  icon: ReactNode
}

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg
      className={styles.icon}
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  )
}

const primary: Item[] = [
  {
    to: '/',
    label: 'Today',
    paths: ['/'],
    icon: (
      <Icon>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 3v2M12 19v2M3 12h2M19 12h2" />
      </Icon>
    ),
  },
  {
    to: '/activities',
    label: 'Log',
    paths: ['/activities'],
    icon: (
      <Icon>
        <path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01" />
      </Icon>
    ),
  },
  {
    to: '/plan',
    label: 'Plan',
    paths: ['/plan'],
    icon: (
      <Icon>
        <rect x="4" y="5" width="16" height="15" rx="2" />
        <path d="M4 10h16M9 3v4M15 3v4" />
      </Icon>
    ),
  },
  {
    to: '/review',
    label: 'Review',
    paths: ['/review'],
    icon: (
      <Icon>
        <rect x="4" y="4" width="16" height="16" rx="2" />
        <path d="m8.5 12.5 2.5 2.5 4.5-5" />
      </Icon>
    ),
  },
  {
    to: '/more',
    label: 'More',
    paths: MORE_PATHS,
    icon: (
      <Icon>
        <path d="M5 12h.01M12 12h.01M19 12h.01" strokeWidth="3" />
      </Icon>
    ),
  },
]

function isCurrent(pathname: string, paths: string[]): boolean {
  return paths.some((path) =>
    path === '/' ? pathname === '/' : pathname === path || pathname.startsWith(`${path}/`),
  )
}

/** From this width the tab bar becomes a side rail (`Nav.module.css` and `Layout.module.css` agree). */
const RAIL_QUERY = '(min-width: 720px)'

/**
 * A bottom tab bar below 720px and a left rail from 720px. The tab bar has the five tabs. The rail
 * has the four daily tabs, then every other page in the groups of the More page (Training, Data,
 * You), so the More tab is hidden there and the rail reaches the same places. Exactly one link is
 * announced as current: the tab on a phone, and on the rail the page's own link, which is the one
 * that carries `aria-current` there (the hidden More tab does not).
 */
export function Nav() {
  const { pathname } = useLocation()
  const { theme, setTheme } = useTheme()
  const railed = useMediaQuery(RAIL_QUERY)
  // The race plan joins the Training group only for an ultra goal with a race still to come; the
  // rail asks only when it is on screen, so a phone does not spend a request on every page.
  const hasRacePlan = useRacePlan({ enabled: railed }).data?.plan != null
  const nextTheme = themeOrder[(themeOrder.indexOf(theme) + 1) % themeOrder.length] ?? 'system'

  return (
    <div className={styles.chrome} data-app-chrome>
      <div className={styles.wordmark}>Running log</div>
      <nav aria-label="Primary" className={styles.primary}>
        <ul className={styles.list}>
          {primary.map((item) => {
            const isMore = item.to === '/more'
            const current = isCurrent(pathname, item.paths)
            return (
              <li
                key={item.to}
                className={isMore ? `${styles.entry} ${styles.more}` : styles.entry}
              >
                <Link
                  to={item.to}
                  className={styles.link}
                  aria-current={current && !(isMore && railed) ? 'page' : undefined}
                >
                  {item.icon}
                  <span>{item.label}</span>
                </Link>
              </li>
            )
          })}
        </ul>
      </nav>
      <nav aria-label="Other pages" className={styles.secondary}>
        {destinationGroups(hasRacePlan).map((group) => (
          <div
            key={group.id}
            role="group"
            aria-labelledby={`rail-${group.id}`}
            className={styles.group}
          >
            <p id={`rail-${group.id}`} className={styles.groupTitle}>
              {group.title}
            </p>
            <ul className={styles.list}>
              {group.items.map((item) => {
                const current = isCurrent(pathname, [item.to])
                return (
                  <li key={item.to} className={styles.entry}>
                    <Link
                      to={item.to}
                      className={styles.sublink}
                      aria-current={current && railed ? 'page' : undefined}
                      data-current={current ? 'true' : undefined}
                    >
                      <span className={styles.subicon}>{item.icon}</span>
                      {item.label}
                    </Link>
                  </li>
                )
              })}
            </ul>
          </div>
        ))}
      </nav>
      <div className={styles.footer}>
        <button
          type="button"
          className={styles.theme}
          onClick={() => {
            setTheme(nextTheme)
          }}
        >
          Theme: {themeLabel[theme]}
        </button>
      </div>
    </div>
  )
}
