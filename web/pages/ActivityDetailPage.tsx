import { useId, useState, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import type { Activity, ActivityDetail, HrHistogram, Lap, Units } from '../../shared/types.ts'
import { formatDistance, formatDuration, formatPace } from '../../shared/units.ts'
import { useActivityDetail, useDeleteActivity, useSaveFeedback } from '../api/activities.ts'
import { ApiError } from '../api/client.ts'
import { usePlan } from '../api/plan.ts'
import { useSettings } from '../api/settings.ts'
import { Button } from '../components/Button.tsx'
import { StreamChart } from '../components/charts/lazyCharts.tsx'
import { buildSeries, type StreamChannel } from '../components/charts/streamSeries.ts'
import { FeedbackFields, type FeedbackValues } from '../components/FeelPicker.tsx'
import { FuelSection } from '../components/fuel/FuelSection.tsx'
import { ratingCounts, unratedEffortNote } from '../components/engineText.ts'
import { formatLongDate } from '../components/format.ts'
import { PageHeader } from '../components/PageHeader.tsx'
import { Skeleton } from '../components/Skeleton.tsx'
import { StandoutCard } from '../components/StandoutCard.tsx'
import { useToast } from '../components/Toast.tsx'
import { ActivityForm, sourceLabel, TYPE_LABELS } from './ActivityForm.tsx'
import styles from './ActivityDetailPage.module.css'

const M_PER_FOOT = 0.3048
const KM_PER_MILE = 1.609344
const HR_BAND_BPM = 10
const EN_DASH = '–'

const WEATHER_SOURCES: Record<NonNullable<Activity['weatherSource']>, string> = {
  'open-meteo': 'Open-Meteo',
  provider: 'The recording source',
  manual: 'Entered by hand',
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  const id = useId()
  return (
    <section aria-labelledby={id} className={styles.section}>
      <h2 id={id} className={styles.heading}>
        {title}
      </h2>
      {children}
    </section>
  )
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.figure}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  )
}

function elevation(metres: number, units: Units): string {
  return units === 'mi' ? `${String(Math.round(metres / M_PER_FOOT))} ft` : `${String(metres)} m`
}

function temperature(celsius: number, units: Units): string {
  return units === 'mi'
    ? `${String(Math.round((celsius * 9) / 5 + 32))} °F`
    : `${String(Math.round(celsius))} °C`
}

function wind(kph: number, units: Units): string {
  return units === 'mi'
    ? `${String(Math.round(kph / KM_PER_MILE))} mph`
    : `${String(Math.round(kph))} km/h`
}

function Summary({ activity, units }: { activity: Activity; units: Units }) {
  const hasPace =
    (activity.type === 'run' || activity.type === 'race') &&
    activity.distanceM !== null &&
    activity.distanceM > 0
  const movingDiffers =
    activity.movingSec !== null && Math.abs(activity.movingSec - activity.durationSec) >= 1
  const subtype = activity.subtype
  const source = sourceLabel(activity.source) ?? 'Entered by hand'
  return (
    <Section title="Summary">
      <dl className={styles.figures}>
        <Figure label="Duration" value={formatDuration(activity.durationSec)} />
        {activity.movingSec !== null && movingDiffers ? (
          <Figure label="Moving time" value={formatDuration(activity.movingSec)} />
        ) : null}
        {activity.distanceM !== null && activity.type !== 'strength' ? (
          <Figure label="Distance" value={formatDistance(activity.distanceM, units)} />
        ) : null}
        {hasPace && activity.distanceM !== null ? (
          <Figure
            label="Pace"
            value={formatPace(activity.durationSec, activity.distanceM, units)}
          />
        ) : null}
        {hasPace && activity.distanceM !== null && activity.movingSec !== null && movingDiffers ? (
          <Figure
            label="Moving pace"
            value={formatPace(activity.movingSec, activity.distanceM, units)}
          />
        ) : null}
        {hasPace && activity.gapDistanceM !== null && activity.gapDistanceM > 0 ? (
          <Figure
            label="Grade-adjusted pace"
            value={formatPace(activity.durationSec, activity.gapDistanceM, units)}
          />
        ) : null}
        {activity.elevationGainM !== null ? (
          <Figure label="Elevation gain" value={elevation(activity.elevationGainM, units)} />
        ) : null}
        {activity.elevationLossM !== null ? (
          <Figure label="Elevation loss" value={elevation(activity.elevationLossM, units)} />
        ) : null}
        {activity.avgHr !== null ? (
          <Figure label="Average HR" value={`${String(activity.avgHr)} bpm`} />
        ) : null}
        {activity.maxHr !== null ? (
          <Figure label="Max HR" value={`${String(activity.maxHr)} bpm`} />
        ) : null}
        {activity.avgCadence !== null ? (
          <Figure label="Cadence" value={`${String(activity.avgCadence)} spm`} />
        ) : null}
        {activity.avgPowerW !== null ? (
          <Figure label="Power" value={`${String(activity.avgPowerW)} W`} />
        ) : null}
        {subtype !== null ? (
          <Figure label="Kind" value={subtype.charAt(0).toUpperCase() + subtype.slice(1)} />
        ) : null}
        {activity.deviceName !== null ? (
          <Figure label="Device" value={activity.deviceName} />
        ) : null}
        <Figure label="Source" value={source} />
      </dl>
      {activity.duplicateStatus === 'confirmed' ? (
        <p className={styles.note}>Marked as a duplicate. It is not counted in totals.</p>
      ) : null}
      {activity.duplicateStatus === 'possible' ? (
        <p className={styles.note}>
          Possible duplicate of another activity. Resolve it on the{' '}
          <Link to="/activities?duplicates=1">activities page</Link>.
        </p>
      ) : null}
    </Section>
  )
}

const CHANNELS: StreamChannel[] = ['pace', 'hr', 'alt']

function Charts({ detail, units }: { detail: ActivityDetail; units: Units }) {
  const { activity, stream } = detail
  const channels = CHANNELS.filter(
    (channel) => channel !== 'pace' || activity.type === 'run' || activity.type === 'race',
  )
  const hasData =
    stream !== null &&
    channels.some((channel) => buildSeries(stream, channel, units).some((p) => p.y !== null))
  return (
    <Section title="Charts">
      {stream !== null && hasData ? (
        <div className={styles.charts}>
          {channels.map((channel) => (
            <StreamChart key={channel} stream={stream} channel={channel} units={units} />
          ))}
        </div>
      ) : (
        <p className={styles.muted}>No chart data for this activity.</p>
      )}
    </Section>
  )
}

function LapsTable({ laps, units, hasPace }: { laps: Lap[]; units: Units; hasPace: boolean }) {
  const id = useId()
  const showDistance = laps.some((l) => l.distanceM !== null)
  const showHr = laps.some((l) => l.avgHr !== null)
  const showMaxHr = laps.some((l) => l.maxHr !== null)
  const showCadence = laps.some((l) => l.avgCadence !== null)
  return (
    <section aria-labelledby={id} className={styles.section}>
      <h2 id={id} className={styles.heading}>
        Laps
      </h2>
      <div
        className={styles.tableScroll}
        role="region"
        aria-label="Laps table, scrolls sideways"
        tabIndex={0}
      >
        <table aria-labelledby={id} className={styles.table}>
          <thead>
            <tr>
              <th scope="col">Lap</th>
              <th scope="col">Time</th>
              {showDistance ? <th scope="col">Distance</th> : null}
              {showDistance && hasPace ? <th scope="col">Pace</th> : null}
              {showHr ? <th scope="col">Avg HR</th> : null}
              {showMaxHr ? <th scope="col">Max HR</th> : null}
              {showCadence ? <th scope="col">Cadence</th> : null}
            </tr>
          </thead>
          <tbody>
            {laps.map((lap, index) => (
              <tr key={lap.startSec}>
                <th scope="row">{String(index + 1)}</th>
                <td>{formatDuration(lap.durationSec)}</td>
                {showDistance ? (
                  <td>{lap.distanceM === null ? EN_DASH : formatDistance(lap.distanceM, units)}</td>
                ) : null}
                {showDistance && hasPace ? (
                  <td>
                    {lap.distanceM === null
                      ? EN_DASH
                      : formatPace(lap.durationSec, lap.distanceM, units)}
                  </td>
                ) : null}
                {showHr ? <td>{lap.avgHr === null ? EN_DASH : String(lap.avgHr)}</td> : null}
                {showMaxHr ? <td>{lap.maxHr === null ? EN_DASH : String(lap.maxHr)}</td> : null}
                {showCadence ? (
                  <td>{lap.avgCadence === null ? EN_DASH : String(lap.avgCadence)}</td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function Weather({ activity, units }: { activity: Activity; units: Units }) {
  const { tempC, dewPointC, humidityPct, windKph, weatherSource } = activity
  if (tempC === null && dewPointC === null && humidityPct === null && windKph === null) return null
  return (
    <Section title="Weather">
      <dl className={styles.figures}>
        {tempC !== null ? <Figure label="Temperature" value={temperature(tempC, units)} /> : null}
        {dewPointC !== null ? (
          <Figure label="Dew point" value={temperature(dewPointC, units)} />
        ) : null}
        {humidityPct !== null ? (
          <Figure label="Humidity" value={`${String(humidityPct)}%`} />
        ) : null}
        {windKph !== null ? <Figure label="Wind" value={wind(windKph, units)} /> : null}
      </dl>
      {weatherSource !== null ? (
        <p className={styles.muted}>{`Source: ${WEATHER_SOURCES[weatherSource]}.`}</p>
      ) : null}
    </Section>
  )
}

interface Band {
  from: number
  sec: number
}

/** Seconds per 10 bpm band, from the first band with time to the last. */
function hrBands(histogram: HrHistogram): Band[] {
  const totals = new Map<number, number>()
  histogram.sec.forEach((sec, index) => {
    if (sec <= 0) return
    const bpm = histogram.start + index * histogram.width
    const from = Math.floor(bpm / HR_BAND_BPM) * HR_BAND_BPM
    totals.set(from, (totals.get(from) ?? 0) + sec)
  })
  if (totals.size === 0) return []
  const starts = [...totals.keys()]
  const first = Math.min(...starts)
  const last = Math.max(...starts)
  const bands: Band[] = []
  for (let from = first; from <= last; from += HR_BAND_BPM) {
    bands.push({ from, sec: totals.get(from) ?? 0 })
  }
  return bands
}

function HeartRate({ activity }: { activity: Activity }) {
  const bands = activity.hrHistogram === null ? [] : hrBands(activity.hrHistogram)
  const decoupling = activity.decouplingPct
  if (bands.length === 0 && decoupling === null) return null
  const total = bands.reduce((sum, b) => sum + b.sec, 0)
  const peak = Math.max(1, ...bands.map((b) => b.sec))
  return (
    <Section title="Heart rate distribution">
      {bands.length > 0 ? (
        <ul aria-label="Time in 10 bpm bands" className={styles.bands}>
          {bands.map((band) => (
            <li key={band.from} className={styles.band}>
              <span className={styles.bandLabel}>
                {`${String(band.from)}${EN_DASH}${String(band.from + HR_BAND_BPM - 1)} bpm`}
              </span>
              <span className={styles.bandTrack} aria-hidden="true">
                <span
                  className={styles.bandFill}
                  style={{ width: `${String((band.sec / peak) * 100)}%` }}
                />
              </span>
              <span className={styles.bandTime}>
                {`${formatDuration(band.sec)} (${String(Math.round((band.sec / total) * 100))}%)`}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {decoupling !== null ? (
        <dl className={styles.figures}>
          <Figure label="Aerobic decoupling" value={`${decoupling.toFixed(1)}%`} />
        </dl>
      ) : null}
      {decoupling !== null ? (
        <p className={styles.muted}>
          Heart rate against pace, second half compared with the first. Positive means heart rate
          rose relative to pace.
        </p>
      ) : null}
    </Section>
  )
}

function Feedback({ activity }: { activity: Activity }) {
  const save = useSaveFeedback(activity.id)
  const toast = useToast()
  // The assessment of the planned session this activity fulfils, from the plan that other pages
  // share. While the plan loads, or when no session is assessed, the section has no note.
  const plan = usePlan()
  const execution =
    plan.data?.sessions.find((session) => session.activityId === activity.id)?.execution ?? null
  const [value, setValue] = useState<FeedbackValues>({
    rpe: activity.rpe,
    feel: activity.feel,
    pain: activity.pain,
  })

  return (
    <Section title="How did it go?">
      {execution !== null && !ratingCounts(execution.completion, activity) ? (
        <p className={styles.note}>
          {unratedEffortNote(execution.effort.score, execution.completion)}
        </p>
      ) : null}
      <FeedbackFields value={value} onChange={setValue} />
      <div className={styles.actions}>
        <Button
          variant="primary"
          loading={save.isPending}
          onClick={() => {
            // The section starts again from the stored values once they refetch, which unmounts
            // this component before a per-call callback of `mutate` would run; the promise does not.
            save.mutateAsync(value).then(
              () => {
                toast.show('Feedback saved')
              },
              () => {
                // The failure is shown in the section's alert.
              },
            )
          }}
        >
          Save
        </Button>
      </div>
      {save.isError ? (
        <p role="alert" className={styles.error}>
          {`Feedback not saved. ${save.error instanceof ApiError ? save.error.message : 'Something went wrong.'} Try again.`}
        </p>
      ) : null}
    </Section>
  )
}

function DeleteActivity({ activity }: { activity: Activity }) {
  const [confirming, setConfirming] = useState(false)
  const remove = useDeleteActivity()
  const toast = useToast()
  const navigate = useNavigate()

  async function run() {
    try {
      await remove.mutateAsync(activity.id)
    } catch {
      return
    }
    toast.show('Activity deleted')
    void navigate('/activities')
  }

  return (
    <div className={styles.danger}>
      {confirming ? (
        <>
          <p>Delete this activity?</p>
          <div className={styles.actions}>
            <Button
              variant="danger"
              loading={remove.isPending}
              onClick={() => {
                void run()
              }}
            >
              Delete activity
            </Button>
            <Button
              variant="quiet"
              onClick={() => {
                setConfirming(false)
              }}
            >
              Keep
            </Button>
          </div>
          {remove.isError ? (
            <p role="alert" className={styles.error}>
              {`Activity not deleted. ${remove.error instanceof ApiError ? remove.error.message : 'Something went wrong.'} Try again.`}
            </p>
          ) : null}
        </>
      ) : (
        <Button
          variant="danger"
          onClick={() => {
            setConfirming(true)
          }}
        >
          Delete
        </Button>
      )}
    </div>
  )
}

export function ActivityDetailPage() {
  const { id } = useParams()
  const detail = useActivityDetail(id)
  const settings = useSettings()
  const [editing, setEditing] = useState(false)

  if (detail.isError) {
    const missing = detail.error instanceof ApiError && detail.error.status === 404
    return (
      <>
        <PageHeader title="Activity" />
        {missing ? (
          <p>
            This activity was not found. <Link to="/activities">All activities</Link>
          </p>
        ) : (
          <p role="alert">The activity did not load. Reload the page to try again.</p>
        )}
      </>
    )
  }
  if (detail.data === undefined || settings.data === undefined) {
    return (
      <>
        <PageHeader title="Activity" />
        <Skeleton lines={5} />
      </>
    )
  }

  const units = settings.data.units
  const { activity, laps, hasFile } = detail.data
  const when = `${formatLongDate(activity.date)}${activity.startTime !== null ? `, ${activity.startTime}` : ''}`
  const hasPace =
    (activity.type === 'run' || activity.type === 'race') &&
    activity.distanceM !== null &&
    activity.distanceM > 0

  return (
    <>
      <PageHeader
        title={TYPE_LABELS[activity.type]}
        context={when}
        actions={
          <Button
            onClick={() => {
              setEditing(true)
            }}
          >
            Edit
          </Button>
        }
      />
      <p className={styles.back}>
        <Link to="/activities">All activities</Link>
      </p>

      <Summary activity={activity} units={units} />
      <Charts detail={detail.data} units={units} />
      {laps !== null && laps.length > 0 ? (
        <LapsTable laps={laps} units={units} hasPace={hasPace} />
      ) : null}
      <Weather activity={activity} units={units} />
      <HeartRate activity={activity} />
      {activity.type === 'run' || activity.type === 'race' ? (
        <StandoutCard activityId={activity.id} units={units} />
      ) : null}
      <FuelSection activity={activity} />
      {/* Keyed on the stored values, so the pickers start again from them when they change. */}
      <Feedback
        key={`${activity.id}:${String(activity.rpe)}:${String(activity.feel)}:${String(activity.pain)}`}
        activity={activity}
      />
      {activity.notes !== null ? (
        <Section title="Notes">
          <p className={styles.notes}>{activity.notes}</p>
        </Section>
      ) : null}
      {hasFile ? (
        <p className={styles.file}>
          <a href={`/api/activities/${encodeURIComponent(activity.id)}/file`} download>
            Download original file
          </a>
        </p>
      ) : null}
      <DeleteActivity activity={activity} />

      <ActivityForm
        open={editing}
        activity={activity}
        onClose={() => {
          setEditing(false)
        }}
      />
    </>
  )
}
