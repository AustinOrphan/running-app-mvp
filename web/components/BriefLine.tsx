import { Link } from 'react-router-dom'
import { briefText, renderBriefLine } from '../../shared/copy/briefRender.ts'
import { newMarker } from '../../shared/copy/revisionView.ts'
import type { BriefListItem, Units } from '../../shared/types.ts'
import styles from './BriefLine.module.css'

/**
 * Today's line on the weekly brief: how many sessions the update changed and the next key session,
 * worded by `renderBriefLine` from the `brief` slot of the Today payload (the item of
 * `GET /api/briefs`). The whole line is the link to the brief, so the tap target is the 52 px the
 * `brief` slot allows, and one quiet "New" marker stands in front of it until the brief has been
 * opened (`seen`, which follows the `seenAt` of the revision the brief describes). An update that
 * was undone changed nothing now, so it reads as no changes.
 */
export function BriefLine({ item, units }: { item: BriefListItem; units: Units }) {
  const sentence = renderBriefLine(
    { changeCount: item.undone ? 0 : item.changeCount, nextKey: item.nextKey },
    units,
  )
  return (
    <section aria-label={briefText('brief.title', units)} className={styles.line}>
      <Link to="/brief" className={styles.link}>
        <span className={styles.text}>
          {item.seen ? null : <span className={styles.marker}>{newMarker(units)}</span>}
          {sentence} <span className={styles.open}>{briefText('brief.open', units)}</span>
        </span>
      </Link>
    </section>
  )
}
