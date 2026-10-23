import { useEffect, useId, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  ACTIVITY_MORE_ERROR,
  activityCountText,
  activityMoreLabel,
} from '../../shared/copy/activityList.ts'
import { todayIso } from '../../shared/dates.ts'
import type { ActivityListItem, ActivityType, Units } from '../../shared/types.ts'
import { formatDistance, formatDuration, formatPace } from '../../shared/units.ts'
import {
  ACTIVITY_VIEW_PAGE,
  useActivities,
  useActivityPages,
  useResolveDuplicate,
} from '../api/activities.ts'
import { ApiError } from '../api/client.ts'
import { useSettings } from '../api/settings.ts'
import { Button } from '../components/Button.tsx'
import { EmptyState } from '../components/EmptyState.tsx'
import { Field, Input } from '../components/Field.tsx'
import { formatShortDate, formatWeekday } from '../components/format.ts'
import { PageHeader } from '../components/PageHeader.tsx'
import { Segmented } from '../components/Segmented.tsx'
import { Skeleton } from '../components/Skeleton.tsx'
import { ActivityForm, sourceLabel, TYPE_LABELS } from './ActivityForm.tsx'
import styles from './ActivitiesPage.module.css'
import { ImportDialog } from './ImportDialog.tsx'

type TypeFilter = ActivityType | 'all'

const FILTER_OPTIONS: Array<{ value: TypeFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'run', label: 'Run' },
  { value: 'race', label: 'Race' },
  { value: 'strength', label: 'Strength' },
  { value: 'cross', label: 'Cross' },
]

const EN_DASH = '–'

function dateHeading(date: string): string {
  const base = `${formatWeekday(date)} ${formatShortDate(date)}`
  // Older years carry the year so a long list stays unambiguous.
  return date.slice(0, 4) === todayIso().slice(0, 4) ? base : `${base} ${date.slice(0, 4)}`
}

/** Consecutive rows with the same date; the API already sorts newest first. */
function groupByDate(rows: ActivityListItem[]): Array<{ date: string; rows: ActivityListItem[] }> {
  const groups: Array<{ date: string; rows: ActivityListItem[] }> = []
  for (const row of rows) {
    const last = groups.at(-1)
    if (last?.date === row.date) last.rows.push(row)
    else groups.push({ date: row.date, rows: [row] })
  }
  return groups
}

function ActivityRow({
  activity,
  units,
  onEdit,
  restorable = false,
}: {
  activity: ActivityListItem
  units: Units
  onEdit: () => void
  /** Offers to undo a confirmed duplicate, so the row counts again. */
  restorable?: boolean
}) {
  const resolve = useResolveDuplicate()
  const hasDistance = activity.type !== 'strength'
  const showPace =
    (activity.type === 'run' || activity.type === 'race') &&
    activity.distanceM !== null &&
    activity.distanceM > 0
  const source = sourceLabel(activity.source)

  return (
    <li className={styles.item}>
      <div className={styles.main}>
        <button type="button" className={styles.row} onClick={onEdit}>
          <span className={styles.type}>{TYPE_LABELS[activity.type]}</span>
          <span className={styles.figure}>{formatDuration(activity.durationSec)}</span>
          {hasDistance ? (
            <span className={styles.figure}>
              {activity.distanceM === null ? EN_DASH : formatDistance(activity.distanceM, units)}
            </span>
          ) : null}
          {showPace && activity.distanceM !== null ? (
            <span className={styles.pace}>
              {formatPace(activity.durationSec, activity.distanceM, units)}
            </span>
          ) : null}
          {source !== null ? <span className={styles.source}>{source}</span> : null}
          {activity.duplicateStatus === 'confirmed' ? (
            <span className={styles.source}>Duplicate, not counted</span>
          ) : null}
        </button>
        <Link
          to={`/activities/${encodeURIComponent(activity.id)}`}
          className={styles.detailLink}
          aria-label={`Details, ${TYPE_LABELS[activity.type]} on ${formatShortDate(activity.date)}`}
        >
          Details
        </Link>
      </div>
      {restorable && activity.duplicateStatus === 'confirmed' ? (
        <div className={styles.duplicate}>
          <div className={styles.duplicateActions}>
            <Button
              variant="quiet"
              loading={resolve.isPending}
              onClick={() => {
                resolve.mutate({ id: activity.id, status: 'dismissed' })
              }}
            >
              Restore
            </Button>
          </div>
          {resolve.isError ? (
            <p role="alert" className={styles.error}>
              {`Not saved. ${resolve.error instanceof ApiError ? resolve.error.message : 'Something went wrong.'} Try again.`}
            </p>
          ) : null}
        </div>
      ) : null}
      {activity.duplicateStatus === 'possible' ? (
        <div className={styles.duplicate}>
          <span className={styles.badge}>Possible duplicate</span>
          <p className={styles.duplicateNote}>
            Another run on this day is within 80 m. The imported one is counted.
          </p>
          <div className={styles.duplicateActions}>
            <Button
              variant="secondary"
              loading={resolve.isPending}
              onClick={() => {
                resolve.mutate({ id: activity.id, status: 'confirmed' })
              }}
            >
              Confirm duplicate
            </Button>
            <Button
              variant="quiet"
              loading={resolve.isPending}
              onClick={() => {
                resolve.mutate({ id: activity.id, status: 'dismissed' })
              }}
            >
              Not a duplicate
            </Button>
          </div>
          {resolve.isError ? (
            <p role="alert" className={styles.error}>
              {`Not saved. ${resolve.error instanceof ApiError ? resolve.error.message : 'Something went wrong.'} Try again.`}
            </p>
          ) : null}
        </div>
      ) : null}
    </li>
  )
}

export function ActivitiesPage() {
  const [params, setParams] = useSearchParams()
  const adding = params.get('new') === '1'
  const duplicatesOnly = params.get('duplicates') === '1'
  const confirmedHeadingId = useId()

  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [editing, setEditing] = useState<ActivityListItem | null>(null)
  const [importing, setImporting] = useState(false)

  const settings = useSettings()
  const units: Units = settings.data?.units ?? 'mi'
  // ISO dates compare as strings. A reversed range would be a 400, so it is not sent.
  const badRange = from !== '' && to !== '' && from > to
  const filters = {
    ...(from !== '' && !badRange ? { from } : {}),
    ...(to !== '' && !badRange ? { to } : {}),
    ...(typeFilter !== 'all' ? { type: typeFilter } : {}),
  }
  // The list shows a page at a time. The duplicates view reads every row instead: a possible
  // duplicate on a page that is not loaded would otherwise be missing from a view that says none.
  const paged = useActivityPages(filters, { enabled: !duplicatesOnly })
  const whole = useActivities(filters, { enabled: duplicatesOnly })
  const activities = duplicatesOnly ? whole : paged
  const loaded = duplicatesOnly ? whole.data : paged.data?.items
  const total = duplicatesOnly ? whole.data?.length : paged.data?.total
  // A page that failed leaves the rows already read in place; only a failed first read is an error.
  const moreFailed = !duplicatesOnly && paged.isFetchNextPageError
  const loadFailed = activities.isError && !moreFailed

  const moreButton = useRef<HTMLButtonElement>(null)
  const countStatus = useRef<HTMLParagraphElement>(null)
  const refocusMore = useRef(false)
  // The button is disabled while a page loads, which drops its focus; give it back afterwards.
  // The last page removes the button, so focus goes to the count line, which now reads the whole
  // list, instead of falling to the document.
  useEffect(() => {
    if (!paged.isFetchingNextPage && refocusMore.current) {
      refocusMore.current = false
      const target = moreButton.current ?? countStatus.current
      target?.focus()
    }
  }, [paged.isFetchingNextPage])

  function setFlag(name: 'new' | 'duplicates', on: boolean) {
    setParams(
      (current) => {
        const next = new URLSearchParams(current)
        if (on) next.set(name, '1')
        else next.delete(name)
        return next
      },
      { replace: !on },
    )
  }

  const filtersActive = typeFilter !== 'all' || from !== '' || to !== '' || duplicatesOnly
  const rows = (loaded ?? []).filter((row) => !duplicatesOnly || row.duplicateStatus === 'possible')
  // The duplicates view also lists confirmed rows, so a wrong confirmation can be undone.
  const confirmedRows = duplicatesOnly
    ? (loaded ?? []).filter((row) => row.duplicateStatus === 'confirmed')
    : []
  const loading = activities.isPending || settings.isPending
  const noneAtAll = activities.isSuccess && total === 0 && !filtersActive
  const countText =
    loaded === undefined || total === undefined || rows.length === 0
      ? undefined
      : duplicatesOnly
        ? activityCountText(rows.length, rows.length)
        : activityCountText(loaded.length, total)
  const remaining = total === undefined || loaded === undefined ? 0 : total - loaded.length
  const showMore = !duplicatesOnly && !badRange && !loadFailed && !loading && paged.hasNextPage
  // The empty state carries its own Log and Import buttons, so the bar and filters wait for data.
  const showControls = filtersActive || (!loading && !noneAtAll)

  const logButton = (
    <Button
      variant="primary"
      onClick={() => {
        setFlag('new', true)
      }}
    >
      Log activity
    </Button>
  )
  const importButton = (
    <Button
      onClick={() => {
        setImporting(true)
      }}
    >
      Import
    </Button>
  )

  let body
  if (badRange) {
    body = (
      <p role="alert" className={styles.error}>
        Use a start date on or before the end date.
      </p>
    )
  } else if (loadFailed) {
    body = (
      <p role="alert" className={styles.error}>
        Activities did not load. Reload the page to try again.
      </p>
    )
  } else if (loading) {
    body = <Skeleton lines={5} />
  } else if (noneAtAll) {
    body = (
      <EmptyState
        title="No activities yet."
        body="Log a run, or import a Smashrun export to bring your history in."
        action={
          <div className={styles.emptyActions}>
            {logButton}
            {importButton}
          </div>
        }
      />
    )
  } else if (rows.length === 0) {
    body = (
      <EmptyState
        title={duplicatesOnly ? 'No possible duplicates.' : 'No activities match these filters.'}
        body={
          duplicatesOnly
            ? 'Imports and new entries are checked against each other.'
            : 'Widen the dates or choose All types.'
        }
      />
    )
  } else {
    body = groupByDate(rows).map((group) => (
      <section key={group.date} className={styles.group}>
        <h2 className={styles.date}>{dateHeading(group.date)}</h2>
        <ul className={styles.list}>
          {group.rows.map((row) => (
            <ActivityRow
              key={row.id}
              activity={row}
              units={units}
              onEdit={() => {
                setEditing(row)
              }}
            />
          ))}
        </ul>
      </section>
    ))
  }

  return (
    <>
      <PageHeader title="Activities" />

      {/* Always mounted, so a screen reader hears the text change; empty while there is no count. */}
      <p ref={countStatus} role="status" tabIndex={-1} className={styles.count}>
        {countText !== undefined && !badRange && !loadFailed ? countText : ''}
      </p>

      {showControls ? (
        <div className={styles.bar}>
          {logButton}
          {importButton}
        </div>
      ) : null}

      {showControls ? (
        <div className={styles.filters}>
          <Segmented
            label="Filter by type"
            options={FILTER_OPTIONS}
            value={typeFilter}
            onChange={setTypeFilter}
          />
          <div className={styles.dates}>
            <Field label="From">
              {(control) => (
                <Input
                  {...control}
                  type="date"
                  max={to || undefined}
                  value={from}
                  onChange={(e) => {
                    setFrom(e.target.value)
                  }}
                />
              )}
            </Field>
            <Field label="To">
              {(control) => (
                <Input
                  {...control}
                  type="date"
                  min={from || undefined}
                  value={to}
                  onChange={(e) => {
                    setTo(e.target.value)
                  }}
                />
              )}
            </Field>
          </div>
          {duplicatesOnly ? (
            <p className={styles.notice}>
              Showing possible duplicates only.{' '}
              <Button
                variant="quiet"
                onClick={() => {
                  setFlag('duplicates', false)
                }}
              >
                Show all
              </Button>
            </p>
          ) : null}
        </div>
      ) : null}

      {body}

      {showMore ? (
        <div className={styles.more}>
          {moreFailed ? (
            <p role="alert" className={styles.error}>
              {ACTIVITY_MORE_ERROR}
            </p>
          ) : null}
          <Button
            ref={moreButton}
            loading={paged.isFetchingNextPage}
            onClick={() => {
              refocusMore.current = true
              void paged.fetchNextPage()
            }}
          >
            {activityMoreLabel(Math.min(ACTIVITY_VIEW_PAGE, remaining))}
          </Button>
        </div>
      ) : null}

      {confirmedRows.length > 0 && !loading && !badRange ? (
        <section aria-labelledby={confirmedHeadingId} className={styles.group}>
          <h2 id={confirmedHeadingId} className={styles.subheading}>
            Marked as duplicates
          </h2>
          <p className={styles.notice}>These are not counted. Restore a run to count it again.</p>
          {groupByDate(confirmedRows).map((group) => (
            <div key={group.date}>
              <h3 className={styles.date}>{dateHeading(group.date)}</h3>
              <ul className={styles.list}>
                {group.rows.map((row) => (
                  <ActivityRow
                    key={row.id}
                    activity={row}
                    units={units}
                    restorable
                    onEdit={() => {
                      setEditing(row)
                    }}
                  />
                ))}
              </ul>
            </div>
          ))}
        </section>
      ) : null}

      <ActivityForm
        open={adding || editing !== null}
        activity={editing ?? undefined}
        onClose={() => {
          setEditing(null)
          if (adding) setFlag('new', false)
        }}
      />
      <ImportDialog
        open={importing}
        onClose={() => {
          setImporting(false)
        }}
      />
    </>
  )
}
