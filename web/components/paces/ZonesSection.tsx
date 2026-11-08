import { useId } from 'react'
import { Link } from 'react-router-dom'
import { pacesText } from '../../../shared/copy/myPaces.ts'
import type { Units } from '../../../shared/types.ts'
import { useZones } from '../../api/zones.ts'
import { Skeleton } from '../Skeleton.tsx'
import { ZoneSummary } from '../ZoneSummary.tsx'
import { HowMade } from './HowMade.tsx'
import styles from './Paces.module.css'

/**
 * The zones as the runner trains by them: the Profile's data (`useZones`) in the Profile's
 * rendering (`ZoneSummary`), so heart rate and pace per zone, the source of each boundary and its
 * day are the same figures in both places. This page adds the words about where they come from.
 */
export function ZonesSection({ units }: { units: Units }) {
  const headingId = useId()
  const zones = useZones()
  let body
  if (zones.isError) {
    body = <p className={styles.note}>{pacesText('paces.zones.error')}</p>
  } else if (zones.isPending) {
    body = <Skeleton lines={4} />
  } else {
    body = <ZoneSummary set={zones.data} units={units} />
  }
  return (
    <section id="zones" className={styles.section} aria-labelledby={headingId}>
      <h2 id={headingId} className={styles.heading}>
        {pacesText('paces.zones.heading')}
      </h2>
      <p className={styles.note}>{pacesText('paces.zones.context')}</p>
      {body}
      <div className={styles.actions}>
        <Link to="/profile" className={styles.link}>
          {pacesText('paces.link.profile')}
        </Link>
        <Link to="/review" className={styles.link}>
          {pacesText('paces.link.review')}
        </Link>
      </div>
      <HowMade
        lines={[
          pacesText('paces.zones.how-thresholds'),
          pacesText('paces.zones.how-proxy'),
          pacesText('paces.zones.how-range'),
        ]}
        subject="the zones"
        rules={['C1', 'C2', 'C4', 'C7']}
      />
    </section>
  )
}
