import { render } from '../../../shared/copy/template.ts'
import { TEMPLATES } from '../../../shared/copy/templates.ts'
import { areaSizeText } from '../../../shared/copy/surface.ts'
import { formatLongDate, isoDateInZone } from '../../../shared/dates.ts'
import type { Units } from '../../../shared/types.ts'
import { ApiError } from '../../api/client.ts'
import { useDownloadMapArea, useMapArea, useRemoveMapArea } from '../../api/mapArea.ts'
import { Button } from '../Button.tsx'
import { useOnline } from '../useOnline.ts'
import { SurfaceCredit } from './SurfaceCredit.tsx'
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
  | 'surface.loading'
  | 'surface.unavailable'
  | 'surface.offline'

/** The server's own sentence for a refusal (it says what OpenStreetMap did and that nothing changed). */
function refusalText(error: unknown, units: Units): string {
  // The server's own sentence says what OpenStreetMap did and that nothing changed. A dropped
  // connection (status 0) or an answer that was not the server's JSON gets the app's wording.
  const own =
    error instanceof ApiError &&
    error.status !== 0 &&
    error.message !== '' &&
    error.message !== 'The server returned an unexpected response.'
  return own ? error.message : render(TEMPLATES['surface.error'], {}, units)
}

/**
 * The "Trail and road" block of Settings, Maps (M1d): what the download does, what it sends and when,
 * the button, and after a download the area's date, the runs inside it, "Download again" and "Remove".
 * It makes no request of its own to OpenStreetMap: the button asks this server, which makes the one
 * request.
 */
export function TrailRoadSettings({ units }: { units: Units }) {
  const online = useOnline()
  const query = useMapArea()
  const download = useDownloadMapArea()
  const remove = useRemoveMapArea()
  const view = query.data
  const area = view?.area ?? null
  const day = (iso: string) => formatLongDate(isoDateInZone(new Date(iso), view?.tz ?? 'UTC'))
  const working = download.isPending || (view?.busy ?? false)
  const t = (id: SlotlessId) => render(TEMPLATES[id], {}, units)

  return (
    <div className={styles.block} role="group" aria-labelledby="trail-road-heading">
      <h3 id="trail-road-heading" className={styles.heading}>
        {t('surface.heading')}
      </h3>
      <p className={styles.note}>{t('surface.what')}</p>
      <p className={styles.note}>{t('surface.sent')}</p>
      <p className={styles.note}>{t('surface.when')}</p>

      {view === undefined ? (
        <p className={styles.note} role="status">
          {t(
            !online ? 'surface.offline' : query.isError ? 'surface.unavailable' : 'surface.loading',
          )}
        </p>
      ) : null}

      {area ? (
        <div className={styles.facts}>
          <p className={styles.fact}>
            {render(
              TEMPLATES['surface.fetched'],
              {
                date: day(area.fetchedAt),
                size: areaSizeText(area, units),
                ways: area.wayCount.toLocaleString('en'),
                runs: String(area.runs),
              },
              units,
            )}
          </p>
          {area.dataTimestamp ? (
            <p className={styles.note}>
              {render(TEMPLATES['surface.data-date'], { date: day(area.dataTimestamp) }, units)}
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

      {view === undefined ? null : (
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
      )}
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
        <SurfaceCredit className={styles.link} />
      </p>
    </div>
  )
}
