import { useState } from 'react'
import { pacesText } from '../../shared/copy/myPaces.ts'
import { useMyPaces, type CustomCourse } from '../api/paces.ts'
import { useSettings } from '../api/settings.ts'
import { PageHeader } from '../components/PageHeader.tsx'
import { ErrorState } from '../components/ErrorState.tsx'
import { useLoadView } from '../components/loadView.ts'
import { Skeleton } from '../components/Skeleton.tsx'
import { EasyPaceSection } from '../components/paces/EasyPaceSection.tsx'
import { EventsSection } from '../components/paces/EventsSection.tsx'
import { TerrainSection } from '../components/paces/TerrainSection.tsx'
import { TestSection } from '../components/paces/TestSection.tsx'
import { ZonesSection } from '../components/paces/ZonesSection.tsx'
import styles from '../components/paces/Paces.module.css'

const JUMPS = [
  { href: '#easy', label: 'Easy pace' },
  { href: '#zones', label: 'Zones' },
  { href: '#grades', label: 'Climbs and descents' },
  { href: '#events', label: 'What you can run now' },
  { href: '#test', label: 'A short test' },
] as const

/**
 * My paces (rule C9, ADR 0020): the easy pace, the zones as the runner trains by them and what they
 * can run now at the standard distances and at one of their own, and their speed on each grade
 * (rule I13), all derived on the server from the
 * runner's own runs and stored nowhere. The page only lays out what `GET /api/paces` and
 * `GET /api/zones` send; the words are `shared/copy/myPaces.ts`.
 */
export function MyPacesPage() {
  const [course, setCourse] = useState<CustomCourse | null>(null)
  const settings = useSettings()
  const { paces, custom } = useMyPaces(course)
  const title = pacesText('paces.title')
  const context = pacesText('paces.context')
  // The page needs both reads; a failure of either is one failed load, and the retry asks again for
  // the one that failed.
  const loaded = useLoadView({
    data: paces.data !== undefined && settings.data !== undefined ? true : undefined,
    isError: paces.isError || settings.isError,
    isFetching: paces.isFetching || settings.isFetching,
  })

  if (loaded === 'failed' || loaded === 'retrying') {
    return (
      <>
        <PageHeader title={title} />
        <ErrorState
          subject={title}
          retrying={loaded === 'retrying'}
          onRetry={() =>
            Promise.all([
              paces.isError ? paces.refetch() : null,
              settings.isError ? settings.refetch() : null,
            ])
          }
        />
      </>
    )
  }
  if (paces.data === undefined || settings.data === undefined) {
    return (
      <>
        <PageHeader title={title} context={context} />
        <Skeleton lines={6} />
      </>
    )
  }

  const { units } = settings.data
  const view = paces.data
  // With no distance to predict, the test is the way in, so its steps open.
  const thin = view.events.every((row) => row.time === null)
  return (
    <>
      <PageHeader title={title} context={context} />
      <div className={styles.page}>
        <nav aria-label="On this page">
          <ul className={styles.jump}>
            {JUMPS.map((jump) => (
              <li key={jump.href}>
                <a href={jump.href} className={styles.chip}>
                  {jump.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <EasyPaceSection easy={view.easy} units={units} />
        <ZonesSection units={units} />
        <TerrainSection curve={view.terrain} units={units} />
        <EventsSection
          events={view.events}
          units={units}
          course={course}
          onCourse={setCourse}
          custom={course === null ? null : (custom.data ?? null)}
          customFailed={course !== null && custom.isError}
          busy={course !== null && custom.isFetching}
        />
        <TestSection test={view.test} units={units} thin={thin} />
      </div>
    </>
  )
}
