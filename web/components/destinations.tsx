// Every page the app has that is not a tab, in the three groups the More page and the side rail
// share (Training, Data, You), with the icon set of the tab bar: 24 px, 1.75 stroke, round caps.
import type { ReactNode } from 'react'
import { render } from '../../shared/copy/template.ts'
import { TEMPLATES } from '../../shared/copy/templates.ts'
import { WARNING_SIGNS_PATH } from '../../shared/copy/warningSigns.ts'
import styles from './destinations.module.css'

/** A 24 px stroke icon in the tab bar's style; decorative, so hidden from assistive technology. */
export function NavIcon({ children }: { children: ReactNode }) {
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

/** The mark at the end of a More row. */
export function Chevron() {
  return (
    <svg
      className={styles.chevron}
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="m9 6 6 6-6 6" />
    </svg>
  )
}

export interface Destination {
  to: string
  label: string
  /** The line under the label on the More page. */
  note: string
  icon: ReactNode
}

export interface DestinationGroup {
  /** Stable key, also used for the group's accessible name. */
  id: 'training' | 'data' | 'you'
  title: string
  items: Destination[]
}

const note = (id: keyof typeof TEMPLATES): string => render(TEMPLATES[id], {}, 'km')

const brief: Destination = {
  to: '/brief',
  label: 'Weekly brief',
  note: 'What changed and the next key session',
  icon: (
    <NavIcon>
      <path d="M7 3h7l4 4v14H7z" />
      <path d="M14 3v4h4M10 12h5M10 16h5" />
    </NavIcon>
  ),
}

const goals: Destination = {
  to: '/goals',
  label: 'Goals',
  note: 'Races you are training for',
  icon: (
    <NavIcon>
      <path d="M6 21V4M6 5h11l-2 4 2 4H6" />
    </NavIcon>
  ),
}

/** Listed only while the current goal is an ultra with a race still to come. */
const racePlan: Destination = {
  to: '/race',
  label: 'Race plan',
  note: note('race.plan.more-note'),
  icon: (
    <NavIcon>
      <circle cx="6" cy="18" r="2" />
      <circle cx="18" cy="6" r="2" />
      <path d="M8 18h6a3 3 0 0 0 0-6h-4a3 3 0 0 1 0-6h6" />
    </NavIcon>
  ),
}

const paces: Destination = {
  to: '/paces',
  label: 'My paces',
  note: note('paces.more-note'),
  icon: (
    <NavIcon>
      <circle cx="12" cy="13" r="8" />
      <path d="M12 13l3-3M10 2.5h4" />
    </NavIcon>
  ),
}

const strength: Destination = {
  to: '/strength',
  label: 'Strength',
  note: note('strength.page.more-note'),
  icon: (
    <NavIcon>
      <path d="M3 9v6M6 7v10M18 7v10M21 9v6M6 12h12" />
    </NavIcon>
  ),
}

const fuel: Destination = {
  to: '/fuel',
  label: 'Fuel lab',
  note: 'Fuel targets, products and gut training',
  icon: (
    <NavIcon>
      <path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z" />
    </NavIcon>
  ),
}

const stats: Destination = {
  to: '/stats',
  label: 'Stats',
  note: 'Fastest efforts, monthly and yearly totals',
  icon: (
    <NavIcon>
      <path d="M5 20V11M12 20V5M19 20v-7" />
    </NavIcon>
  ),
}

const trends: Destination = {
  to: '/trends',
  label: 'Trends',
  note: note('trends.more-note'),
  icon: (
    <NavIcon>
      <path d="M3 17l5-5 4 4 8-9" />
      <path d="M15 7h5v5" />
    </NavIcon>
  ),
}

const integrations: Destination = {
  to: '/integrations',
  label: 'Integrations',
  note: 'Sync activities from other services',
  icon: (
    <NavIcon>
      <path d="M9 7V3M15 7V3M7 7h10v4a5 5 0 0 1-10 0zM12 16v5" />
    </NavIcon>
  ),
}

const research: Destination = {
  to: '/research',
  label: 'Research',
  note: note('research.context'),
  icon: (
    <NavIcon>
      <path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z" />
      <path d="M4 21V5M9 8h6" />
    </NavIcon>
  ),
}

const profile: Destination = {
  to: '/profile',
  label: 'Profile',
  note: 'Heart rate, availability and injury history',
  icon: (
    <NavIcon>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21a8 8 0 0 1 16 0" />
    </NavIcon>
  ),
}

const warningSigns: Destination = {
  to: WARNING_SIGNS_PATH,
  label: note('warning-signs.name'),
  note: note('warning-signs.note'),
  icon: (
    <NavIcon>
      <path d="M12 3 2.5 20h19z" />
      <path d="M12 10v4.5M12 17.5v.01" />
    </NavIcon>
  ),
}

const settings: Destination = {
  to: '/settings',
  label: 'Settings',
  note: 'Units, display name, export',
  icon: (
    <NavIcon>
      <path d="M4 7h10M18 7h2M4 17h2M10 17h10" />
      <circle cx="16" cy="7" r="2" />
      <circle cx="8" cy="17" r="2" />
    </NavIcon>
  ),
}

/**
 * The groups, in order. Every route the app has besides the five tabs is in exactly one of them,
 * so the More page on a phone and the rail from 720 px reach the same places. The race plan joins
 * Training once it exists.
 */
export function destinationGroups(hasRacePlan: boolean): DestinationGroup[] {
  return [
    {
      id: 'training',
      title: note('nav.group.training'),
      items: [brief, goals, ...(hasRacePlan ? [racePlan] : []), paces, strength, fuel],
    },
    {
      id: 'data',
      title: note('nav.group.data'),
      items: [stats, trends, integrations, research],
    },
    { id: 'you', title: note('nav.group.you'), items: [profile, warningSigns, settings] },
  ]
}

/** The path prefixes that the More tab stands for, derived from the groups so they cannot drift. */
export const MORE_PATHS: string[] = [
  '/more',
  ...destinationGroups(true).flatMap((group) => group.items.map((item) => item.to)),
]
