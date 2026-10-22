import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { Activity, ActivityType, Units } from '../../shared/types.ts'
import { formatDistance, formatDuration, formatPace } from '../../shared/units.ts'
import { useActivities, useResolveDuplicate } from '../api/activities.ts'
import { ApiError } from '../api/client.ts'
import { useSettings } from '../api/settings.ts'
import { Button } from '../components/Button.tsx'
import { EmptyState } from '../components/EmptyState.tsx'
import { Field, Input } from '../components/Field.tsx'
import { formatShortDate, formatWeekday } from '../components/format.ts'
import { PageHeader } from '../components/PageHeader.tsx'
import { Segmented } from '../components/Segmented.tsx'
import { Skeleton } from '../components/Skeleton.tsx'
import { ActivityForm, TYPE_LABELS } from './ActivityForm.tsx'
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

const SOURCE_LABELS: Record<Activity['source'], string | null> = {
  manual: null,
  smashrun: 'Smashrun',
  csv: 'CSV',
}

const EN_DASH = '–'

function dateHeading(date: string): string {
  const base = `${formatWeekday(date)} ${formatShortDate(date)}`
  // Older years carry the year so a long list stays unambiguous.
  return date.slice(0, 4) === new Date().getFullYear().toString()
    ? base
    : `${base} ${date.slice(0, 4)}`
}

/** Consecutive rows with the same date; the API already sorts newest first. */
function groupByDate(rows: Activity[]): Array<{ date: string; rows: Activity[] }> {
  const groups: Array<{ date: string; rows: Activity[] }> = []
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
}: {
  activity: Activity
  units: Units
  onEdit: () => void
}) {
  const resolve = useResolveDuplicate()
  const hasDistance = activity.type !== 'strength'
  const showPace =
    (activity.type === 'run' || activity.type === 'race') &&
    activity.distanceM !== null &&
    activity.distanceM > 0
  const source = SOURCE_LABELS[activity.source]

  return (
    <li className={styles.item}>
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

  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [editing, setEditing] = useState<Activity | null>(null)
  const [importing, setImporting] = useState(false)

  const settings = useSettings()
  const units: Units = settings.data?.units ?? 'mi'
  const activities = useActivities({
    ...(from !== '' ? { from } : {}),
    ...(to !== '' ? { to } : {}),
    ...(typeFilter !== 'all' ? { type: typeFilter } : {}),
  })

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
  const rows = (activities.data ?? []).filter(
    (row) => !duplicatesOnly || row.duplicateStatus === 'possible',
  )
  const loading = activities.isPending || settings.isPending
  const noneAtAll = activities.isSuccess && activities.data.length === 0 && !filtersActive
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
  if (activities.isError) {
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
      <PageHeader
        title="Activities"
        context={
          activities.isSuccess && activities.data.length > 0
            ? `${activities.data.length} ${activities.data.length === 1 ? 'activity' : 'activities'}`
            : undefined
        }
      />

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
