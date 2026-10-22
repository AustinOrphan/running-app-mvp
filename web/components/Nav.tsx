import { useCallback, useSyncExternalStore, type ReactNode } from 'react'
import { Link, useLocation } from 'react-router-dom'
import styles from './Nav.module.css'

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
    paths: ['/more', '/goals', '/stats', '/settings'],
    icon: (
      <Icon>
        <path d="M5 12h.01M12 12h.01M19 12h.01" strokeWidth="3" />
      </Icon>
    ),
  },
]

const secondary = [
  { to: '/goals', label: 'Goals' },
  { to: '/stats', label: 'Stats' },
  { to: '/settings', label: 'Settings' },
]

function isCurrent(pathname: string, paths: string[]): boolean {
  return paths.some((path) =>
    path === '/' ? pathname === '/' : pathname === path || pathname.startsWith(`${path}/`),
  )
}

/** A bottom tab bar below 900px and a left rail from 900px; the same five items in both. */
export function Nav() {
  const { pathname } = useLocation()
  const { theme, setTheme } = useTheme()
  const nextTheme = themeOrder[(themeOrder.indexOf(theme) + 1) % themeOrder.length] ?? 'system'

  return (
    <div className={styles.chrome}>
      <div className={styles.wordmark}>Running log</div>
      <nav aria-label="Primary" className={styles.primary}>
        <ul className={styles.list}>
          {primary.map((item) => {
            const current = isCurrent(pathname, item.paths)
            return (
              <li key={item.to} className={styles.entry}>
                <Link
                  to={item.to}
                  className={styles.link}
                  aria-current={current ? 'page' : undefined}
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
        <ul className={styles.list}>
          {secondary.map((item) => (
            <li key={item.to} className={styles.entry}>
              <Link
                to={item.to}
                className={styles.sublink}
                aria-current={isCurrent(pathname, [item.to]) ? 'page' : undefined}
              >
                {item.label}
              </Link>
            </li>
          ))}
        </ul>
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
