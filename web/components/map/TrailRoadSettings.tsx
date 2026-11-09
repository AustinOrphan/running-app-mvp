import { render } from '../../../shared/copy/template.ts'
import { TEMPLATES } from '../../../shared/copy/templates.ts'
import { SURFACE_COPYRIGHT_URL, SURFACE_CREDIT } from '../../../shared/copy/surface.ts'
import { formatLongDate } from '../../../shared/dates.ts'
import type { Units } from '../../../shared/types.ts'
import { ApiError } from '../../api/client.ts'
import { useDownloadMapArea, useMapArea, useRemoveMapArea } from '../../api/mapArea.ts'
import { Button } from '../Button.tsx'
import styles from './TrailRoadSettings.module.css'

/** The templates of this block that have no slots. */
type SlotlessId =
  | 'surface.heading'
  | 'surface.what'
  | 'surface.sent'
  | 'surface.when'
  | 'surface.download'
  | 'surface.again'
  | 'surface.remove'
  | 'surface.busy'
  | 'surface.done'
  | 'surface.outdated'
  | 'surface.removed-note'
  | 'surface.error'

/** The server's own sentence for a refusal (it says what OpenStreetMap did and that nothing changed). */
function refusalText(error: unknown, units: Units): string {
  return error instanceof ApiError && error.message !== ''
    ? error.message
    : render(TEMPLATES['surface.error'], {}, units)
}

/**
 * The "Trail and road" block of Settings, Maps (M1d): what the download does, what it sends and when,
 * the button, and after a download the area's date, the runs inside it, "Download again" and "Remove".
 * It makes no request of its own to OpenStreetMap: the button asks this server, which makes the one
 * request.
 */
export function TrailRoadSettings({ units }: { units: Units }) {
  const query = useMapArea()
  const download = useDownloadMapArea()
  const remove = useRemoveMapArea()
  const area = query.data?.area ?? null
  const working = download.isPending || (query.data?.busy ?? false)
  const t = (id: SlotlessId) => render(TEMPLATES[id], {}, units)

  return (
    <div className={styles.block} role="group" aria-labelledby="trail-road-heading">
      <h3 id="trail-road-heading" className={styles.heading}>
        {t('surface.heading')}
      </h3>
      <p className={styles.note}>{t('surface.what')}</p>
      <p className={styles.note}>{t('surface.sent')}</p>
      <p className={styles.note}>{t('surface.when')}</p>

      {area ? (
        <div className={styles.facts}>
          <p className={styles.fact}>
            {render(
              TEMPLATES['surface.fetched'],
              {
                date: formatLongDate(area.fetchedAt.slice(0, 10)),
                ways: area.wayCount.toLocaleString('en'),
                runs: String(area.runs),
              },
              units,
            )}
          </p>
          {area.dataTimestamp ? (
            <p className={styles.note}>
              {render(
                TEMPLATES['surface.data-date'],
                { date: formatLongDate(area.dataTimestamp.slice(0, 10)) },
                units,
              )}
            </p>
          ) : null}
          <p className={styles.note} role="status">
            {area.done < area.runs
              ? render(
                  TEMPLATES['surface.progress'],
                  { done: String(area.done), runs: String(area.runs) },
                  units,
                )
              : t('surface.done')}
          </p>
          {area.outdated ? <p className={styles.note}>{t('surface.outdated')}</p> : null}
        </div>
      ) : null}

      <div className={styles.actions}>
        <Button
          variant={area ? 'secondary' : 'primary'}
          busy={working}
          onClick={() => {
            download.mutate()
          }}
        >
          {area ? t('surface.again') : t('surface.download')}
        </Button>
        {area ? (
          <Button
            variant="quiet"
            busy={remove.isPending || working}
            onClick={() => {
              remove.mutate()
            }}
          >
            {t('surface.remove')}
          </Button>
        ) : null}
      </div>
      <div role="status" aria-live="polite">
        {working ? <p className={styles.note}>{t('surface.busy')}</p> : null}
      </div>
      {download.isError ? (
        <p role="alert" className={styles.alert}>
          {refusalText(download.error, units)}
        </p>
      ) : null}
      {remove.isError ? (
        <p role="alert" className={styles.alert}>
          {refusalText(remove.error, units)}
        </p>
      ) : null}
      {area ? <p className={styles.note}>{t('surface.removed-note')}</p> : null}
      <p className={styles.note}>
        <a className={styles.link} href={SURFACE_COPYRIGHT_URL} target="_blank" rel="noreferrer">
          {SURFACE_CREDIT}
        </a>
      </p>
    </div>
  )
}
