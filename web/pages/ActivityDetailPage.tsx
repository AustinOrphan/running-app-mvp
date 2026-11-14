import { useQueryClient } from '@tanstack/react-query'
import { useId, useState, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  againstThePlanHeading,
  movingPaceLabel,
  noLinkedSession,
  planNotLoaded,
  paceLabel,
  plannedAgainstRan,
  type PlanOnTheDay,
} from '../../shared/copy/activityPage.ts'
import { formatAirTemperature } from '../../shared/copy/quantity.ts'
import { movingTimeDiffers } from '../../shared/domain/movingTime.ts'
import { mondayOf } from '../../shared/dates.ts'
import { runChartContext } from '../../shared/domain/runChartContext.ts'
import type {
  Activity,
  ActivityDetail,
  HrHistogram,
  Lap,
  PlanWithSessions,
  Units,
} from '../../shared/types.ts'
import { hasTrack } from '../../shared/importers/files/track.ts'
import { ROUTE_HEADING, ROUTE_SECTION_NAME } from '../../shared/copy/runMap.ts'
import { surfaceLine } from '../../shared/copy/surface.ts'
import { render } from '../../shared/copy/template.ts'
import { TEMPLATES } from '../../shared/copy/templates.ts'
import { formatDistance, formatDuration, formatPace } from '../../shared/units.ts'
import {
  useActivityDetail,
  useActivityTrack,
  useDeleteActivity,
  useSaveFeedback,
} from '../api/activities.ts'
import { ApiError, keys } from '../api/client.ts'
import { usePlan } from '../api/plan.ts'
import { usePlanInputs } from '../api/planInputs.ts'
import { useToday } from '../api/today.ts'
import { useSettings } from '../api/settings.ts'
import { useZones } from '../api/zones.ts'
import { Button } from '../components/Button.tsx'
import { ConfirmSheet } from '../components/ConfirmSheet.tsx'
import { TrashGlyph } from '../components/Glyphs.tsx'
import { StreamChart } from '../components/charts/lazyCharts.tsx'
import { buildSeries, type StreamChannel } from '../components/charts/streamSeries.ts'
import {
  FeedbackFields,
  feedbackPatch,
  showHeatMark,
  type FeedbackValues,
} from '../components/FeelPicker.tsx'
import { ErrorState } from '../components/ErrorState.tsx'
import { useLoadView } from '../components/loadView.ts'
import { Figure } from '../components/Figure.tsx'
import { hasPlanBars, PlanBars } from '../components/PlanBars.tsx'
import { createDistanceCursor, type DistanceCursor } from '../components/map/distanceCursor.ts'
import { SurfaceCredit } from '../components/map/SurfaceCredit.tsx'
import { RunMap, RunMapLoading } from '../components/map/RunMap.tsx'
import { FuelSection } from '../components/fuel/FuelSection.tsx'
import { ActivitySets } from '../components/strength/ActivitySets.tsx'
import {
  assessmentLines,
  ratingCounts,
  unratedEffortNote,
  withoutMinutesShare,
} from '../components/engineText.ts'
import { WarningSignsText } from '../components/WarningSignsText.tsx'
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

function Section({
  title,
  label,
  children,
}: {
  title: string
  /** An accessible name that differs from the heading's text. */
  label?: string
  children: ReactNode
}) {
  const id = useId()
  return (
    <section
      {...(label === undefined ? { 'aria-labelledby': id } : { 'aria-label': label })}
      className={styles.section}
    >
      <h2 id={id} className={styles.heading}>
        {title}
      </h2>
      {children}
    </section>
  )
}

function Reading({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.figure}>
      <dt>{label}</dt>
      <dd className="figure-type">{value}</dd>
    </div>
  )
}

function elevation(metres: number, units: Units): string {
  return units === 'mi' ? `${String(Math.round(metres / M_PER_FOOT))} ft` : `${String(metres)} m`
}

function wind(kph: number, units: Units): string {
  return units === 'mi'
    ? `${String(Math.round(kph / KM_PER_MILE))} mph`
    : `${String(Math.round(kph))} km/h`
}

/** A distance as its number and unit, so the lead figure can set the unit smaller. */
function distanceParts(metres: number, units: Units): { value: string; unit?: string } {
  const [value = '', unit] = formatDistance(metres, units).split(' ')
  return unit === undefined ? { value } : { value, unit }
}

/**
 * The summary in three tiers: duration and distance as the lead figures; pace, climb and heart rate
 * as the readings under them; kind, device and source as one muted line, because they describe the
 * record and are not a figure of the run.
 */
function Summary({ activity, units }: { activity: Activity; units: Units }) {
  const hasPace =
    (activity.type === 'run' || activity.type === 'race') &&
    activity.distanceM !== null &&
    activity.distanceM > 0
  const movingDiffers = movingTimeDiffers(activity)
  // With a moving time that differs, the moving pace leads and the elapsed pace is the second
  // figure, each named; with only one pace, it is the elapsed one and is "Pace".
  const movingPace = hasPace && movingDiffers && activity.movingSec !== null
  const subtype = activity.subtype
  const distance =
    activity.distanceM !== null && activity.type !== 'strength'
      ? distanceParts(activity.distanceM, units)
      : null
  const surface =
    activity.surfaceBins !== null && (activity.type === 'run' || activity.type === 'race')
      ? surfaceLine(activity.surfaceBins)
      : null
  const described = [
    subtype === null ? null : subtype.charAt(0).toUpperCase() + subtype.slice(1),
    activity.deviceName,
    sourceLabel(activity.source) ?? 'Entered by hand',
  ].filter((part) => part !== null)
  // The four a runner reads first, then the figures only some recordings have.
  const readings = [
    movingPace && activity.distanceM !== null && activity.movingSec !== null ? (
      <Reading
        key="moving-pace"
        label={movingPaceLabel(units)}
        value={formatPace(activity.movingSec, activity.distanceM, units)}
      />
    ) : null,
    hasPace && activity.distanceM !== null ? (
      <Reading
        key="pace"
        label={paceLabel(movingPace, units)}
        value={formatPace(activity.durationSec, activity.distanceM, units)}
      />
    ) : null,
    activity.elevationGainM !== null ? (
      <Reading
        key="gain"
        label="Elevation gain"
        value={elevation(activity.elevationGainM, units)}
      />
    ) : null,
    activity.avgHr !== null ? (
      <Reading key="avg-hr" label="Average HR" value={`${String(activity.avgHr)} bpm`} />
    ) : null,
    activity.maxHr !== null ? (
      <Reading key="max-hr" label="Max HR" value={`${String(activity.maxHr)} bpm`} />
    ) : null,
    activity.movingSec !== null && movingDiffers ? (
      <Reading key="moving" label="Moving time" value={formatDuration(activity.movingSec)} />
    ) : null,
    hasPace && activity.gapDistanceM !== null && activity.gapDistanceM > 0 ? (
      <Reading
        key="gap"
        label="Grade-adjusted pace"
        value={formatPace(activity.durationSec, activity.gapDistanceM, units)}
      />
    ) : null,
    activity.elevationLossM !== null ? (
      <Reading
        key="loss"
        label="Elevation loss"
        value={elevation(activity.elevationLossM, units)}
      />
    ) : null,
    activity.avgCadence !== null ? (
      <Reading key="cadence" label="Cadence" value={`${String(activity.avgCadence)} spm`} />
    ) : null,
    activity.avgPowerW !== null ? (
      <Reading key="power" label="Power" value={`${String(activity.avgPowerW)} W`} />
    ) : null,
  ].filter((reading) => reading !== null)
  return (
    <Section title="Summary">
      <dl className={styles.lead}>
        <Figure label="Duration" value={formatDuration(activity.durationSec)} />
        {distance === null ? null : (
          <Figure
            label="Distance"
            value={distance.value}
            {...(distance.unit === undefined ? {} : { unit: distance.unit })}
          />
        )}
      </dl>
      {readings.length > 0 ? <dl className={styles.readings}>{readings}</dl> : null}
      <p className={styles.muted}>{described.join(' · ')}</p>
      {surface === null ? null : (
        <>
          <p className={styles.surface}>{surface.line}</p>
          {surface.unmatchedPct === null ? null : (
            <p className={styles.note}>
              {render(
                TEMPLATES['surface.not-matched'],
                { share: `${String(surface.unmatchedPct)} %` },
                units,
              )}
            </p>
          )}
          <p className={styles.muted}>
            <SurfaceCredit />
          </p>
        </>
      )}
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

/**
 * The route on a map, between the figures and the charts. A run with no track (a treadmill run, no
 * positions, or nothing left once the ends are hidden) has no section at all.
 */
function RouteMap({
  activity,
  units,
  cursor,
}: {
  activity: Activity
  units: Units
  cursor: DistanceCursor
}) {
  const track = useActivityTrack(activity.id)
  const loadView = useLoadView(track)
  if (track.data === null) return null
  if (loadView === 'failed' || loadView === 'retrying') {
    return (
      <Section title={ROUTE_HEADING} label={ROUTE_SECTION_NAME}>
        <ErrorState
          subject="The route"
          retrying={loadView === 'retrying'}
          onRetry={() => track.refetch()}
        />
      </Section>
    )
  }
  return (
    <Section title={ROUTE_HEADING} label={ROUTE_SECTION_NAME}>
      {track.data === undefined ? (
        <RunMapLoading />
      ) : (
        <RunMap track={track.data} units={units} distanceM={activity.distanceM} cursor={cursor} />
      )}
    </Section>
  )
}

const CHANNELS: StreamChannel[] = ['pace', 'hr', 'alt']

/**
 * The charts of the recording's stream, stacked on one distance axis with one cursor; nothing at
 * all for an activity that has no stream to draw. The planned pace comes from the session this run
 * filled (the plan other pages share) and the easy ceiling from the zones; each is drawn only when
 * it is there, and a plan or zones that did not load leave the charts as they were.
 */
function Charts({
  detail,
  units,
  cursor,
}: {
  detail: ActivityDetail
  units: Units
  cursor: DistanceCursor
}) {
  const { activity, stream } = detail
  const plan = usePlan()
  const zones = useZones()
  const channels = CHANNELS.filter(
    (channel) => channel !== 'pace' || activity.type === 'run' || activity.type === 'race',
  )
  const hasData =
    stream !== null &&
    channels.some((channel) => buildSeries(stream, channel, units).some((p) => p.y !== null))
  if (stream === null || !hasData) return null
  const isRun = activity.type === 'run' || activity.type === 'race'
  const session = plan.data?.sessions.find((candidate) => candidate.activityId === activity.id)
  // What the plan and the zones add is drawn once the plan is read, for a run only: until then it
  // is not known whether the run filled a session the ceiling would not suit.
  const context =
    isRun && plan.isSuccess
      ? runChartContext(session, zones.data ?? null)
      : { plannedPaceSecPerKm: null, easyCeilingBpm: null }
  return (
    <Section title="Charts">
      <div className={styles.charts}>
        <StreamChart
          stream={stream}
          channels={channels}
          units={units}
          cursor={cursor}
          plannedPaceSecPerKm={context.plannedPaceSecPerKm}
          easyCeilingBpm={context.easyCeilingBpm}
        />
      </div>
    </Section>
  )
}

/**
 * How the activity went against the plan: the session it filled and the activity side by side, then
 * the sentences of the session's assessment. An effort verdict that heart rate and pace inferred is
 * not among them (`assessmentLines`): it shows only with the runner's own rating behind it, as
 * "What stood out" states an effort only from a rating. An activity no session is linked to gets one
 * neutral line. A skeleton stands in until the plan is read, and a plan that could not be read gets
 * one line saying so, not a guess about the run.
 */
function AgainstThePlan({ activity, units }: { activity: Activity; units: Units }) {
  const queryClient = useQueryClient()
  // A plan that was marked old by a write (a run just logged links to its session on the server) is
  // read again as the block mounts; what it holds until then is the plan from before the write, in
  // which the run is not linked yet. The block shows nothing of that plan: it waits for the read, and
  // only for that one, since a plan read after the block mounted is the plan as it is and a later
  // read (after a rating is saved) leaves the block as it is. If that read fails, the block says
  // so; it never falls back to the plan from before. A query that failed keeps its error status
  // while the next read runs, so the line shows only when no read is in flight.
  const [mount] = useState(() => ({
    at: Date.now(),
    invalidated: queryClient.getQueryState([keys.plan])?.isInvalidated === true,
  }))
  const plan = usePlan()
  const fromBefore = mount.invalidated && plan.dataUpdatedAt < mount.at
  const title = againstThePlanHeading(units)
  if (plan.data === undefined || fromBefore) {
    return (
      <Section title={title}>
        {plan.isError && !plan.isFetching ? (
          <p className={styles.line}>{planNotLoaded(units)}</p>
        ) : (
          <Skeleton lines={2} />
        )}
      </Section>
    )
  }
  const sessions = plan.data?.sessions ?? []
  const session = sessions.find((candidate) => candidate.activityId === activity.id)
  if (session === undefined) {
    // The current plan is the one this page reads. A run from before its first week was never
    // meant to stand against it, and a session of an archived plan is not looked for, so the block
    // says nothing about it instead of calling it unplanned.
    if (plan.data !== null && activity.date < firstWeekOf(plan.data)) return null
    // a rest day is not a session the runner was asked to do
    const onTheDay: PlanOnTheDay =
      plan.data === null
        ? 'no-plan'
        : sessions.some(
              (candidate) => candidate.date === activity.date && candidate.kind !== 'rest',
            )
          ? 'other-session'
          : 'no-session'
    return (
      <Section title={title}>
        <p className={styles.line}>{noLinkedSession(onTheDay, units)}</p>
      </Section>
    )
  }
  const { execution } = session
  const assessed = execution === null ? [] : assessmentLines(execution, session.target.rpe)
  // The bars say how the time compares with the plan; the sentence that says it in a percentage
  // would read as a target met, so it stands aside for them.
  const lines = hasPlanBars(session, activity) ? withoutMinutesShare(assessed) : assessed
  return (
    <Section title={title}>
      <p className={styles.line}>{plannedAgainstRan(session, activity, units)}</p>
      {lines.map((line) => (
        <p key={line} className={styles.line}>
          <WarningSignsText text={line} />
        </p>
      ))}
      <PlanBars session={session} activity={activity} units={units} />
    </Section>
  )
}

/** The Monday of the plan's first week: the day before it is not part of the plan. */
function firstWeekOf(plan: PlanWithSessions): string {
  const [first] = plan.weeks.map((week) => week.weekStart).sort()
  return first ?? mondayOf(plan.startDate)
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
        {tempC !== null ? (
          <Reading label="Temperature" value={formatAirTemperature(tempC, units)} />
        ) : null}
        {dewPointC !== null ? (
          <Reading label="Dew point" value={formatAirTemperature(dewPointC, units)} />
        ) : null}
        {humidityPct !== null ? (
          <Reading label="Humidity" value={`${String(humidityPct)}%`} />
        ) : null}
        {windKph !== null ? <Reading label="Wind" value={wind(windKph, units)} /> : null}
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
          <Reading label="Aerobic decoupling" value={`${decoupling.toFixed(1)}%`} />
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

function Feedback({ activity, units }: { activity: Activity; units: Units }) {
  const save = useSaveFeedback(activity.id)
  // Whether Today says what counts as a heat day: the Heat mark is offered only then.
  const today = useToday()
  const toast = useToast()
  // The assessment of the planned session this activity fulfils, from the plan that other pages
  // share. While the plan loads, or when no session is assessed, the section has no note.
  const plan = usePlan()
  const execution =
    plan.data?.sessions.find((session) => session.activityId === activity.id)?.execution ?? null
  // Whether the plan reads watch ratings yet (the spread check of rule B1); until it does, a watch
  // rating does not count toward the effort verdict and the verdict keeps its caveat.
  const isWatch = activity.rpeSource === 'watch'
  const planInputs = usePlanInputs(isWatch)
  // Held only once the answer is in and says no; while it is pending or failed nothing is claimed.
  const watchHeld = isWatch && planInputs.isSuccess && !planInputs.data.runs.watchRatings.used
  const counted = watchHeld ? { rpe: null, feel: activity.feel } : activity
  const [value, setValue] = useState<FeedbackValues>({
    rpe: activity.rpe,
    feel: activity.feel,
    pain: activity.pain,
    heatExposure: activity.heatExposure,
  })

  return (
    <Section title="How did it go?">
      {execution !== null && !ratingCounts(execution.completion, counted) ? (
        <p className={styles.note}>
          {unratedEffortNote(execution.effort.score, execution.completion)}
        </p>
      ) : null}
      {activity.rpeSource === 'watch' && activity.rpe !== null ? (
        <p className={styles.note}>
          {render(
            TEMPLATES[
              watchHeld ? 'activity-page.rpe-from-watch-held' : 'activity-page.rpe-from-watch'
            ],
            {},
            'km',
          )}
        </p>
      ) : null}
      <FeedbackFields
        value={value}
        onChange={setValue}
        showHeat={showHeatMark(activity, today.data?.heat.heatDays ?? false)}
        units={units}
      />
      <div className={styles.actions}>
        <Button
          variant="primary"
          loading={save.isPending}
          onClick={() => {
            // The section starts again from the stored values once they refetch, which unmounts
            // this component before a per-call callback of `mutate` would run; the promise does not.
            save.mutateAsync(feedbackPatch(value, activity.rpe)).then(
              () => {
                toast.show(
                  value.rpe === activity.rpe &&
                    value.feel === activity.feel &&
                    value.pain === activity.pain
                    ? 'Heat saved'
                    : 'Feedback saved',
                )
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
      <Button
        variant="secondary"
        onClick={() => {
          remove.reset()
          setConfirming(true)
        }}
      >
        <TrashGlyph />
        Delete
      </Button>
      <ConfirmSheet
        open={confirming}
        title="Delete this activity?"
        confirmLabel="Delete activity"
        pending={remove.isPending}
        error={
          remove.isError
            ? `Activity not deleted. ${remove.error instanceof ApiError ? remove.error.message : 'Something went wrong.'} Try again.`
            : null
        }
        onConfirm={() => {
          void run()
        }}
        onClose={() => {
          setConfirming(false)
        }}
      />
    </div>
  )
}

export function ActivityDetailPage() {
  const { id } = useParams()
  const detail = useActivityDetail(id)
  const settings = useSettings()
  const [editing, setEditing] = useState(false)
  // The distance a chart points at, for the dot on the map. Held outside React state so that a
  // pointer moving over a chart renders nothing but the dot.
  const [cursor] = useState(createDistanceCursor)
  const loadView = useLoadView(detail)

  if (loadView === 'failed' || loadView === 'retrying') {
    const missing = detail.error instanceof ApiError && detail.error.status === 404
    return (
      <>
        <PageHeader title="Activity" />
        {missing ? (
          <p>
            This activity was not found. <Link to="/activities">All activities</Link>
          </p>
        ) : (
          <ErrorState
            subject="The activity"
            retrying={loadView === 'retrying'}
            onRetry={() => detail.refetch()}
          />
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

      {/* The figures, then the charts of the recording (a long run opens on its shape, not on ten
          empty rating buttons); how it stood against the plan, the ask for a rating and the fuel
          follow, and the rest of the recording's detail after them. */}
      <Summary activity={activity} units={units} />
      {hasTrack(activity.type, activity.subtype) ? (
        <RouteMap activity={activity} units={units} cursor={cursor} />
      ) : null}
      <Charts detail={detail.data} units={units} cursor={cursor} />
      {activity.type === 'strength' ? <ActivitySets activity={activity} /> : null}
      <AgainstThePlan activity={activity} units={units} />
      {/* Keyed on the stored values, so the pickers start again from them when they change. */}
      <Feedback
        key={`${activity.id}:${String(activity.rpe)}:${String(activity.feel)}:${String(activity.pain)}:${String(activity.heatExposure)}`}
        activity={activity}
        units={units}
      />
      <FuelSection activity={activity} />
      {laps !== null && laps.length > 0 ? (
        <LapsTable laps={laps} units={units} hasPace={hasPace} />
      ) : null}
      <Weather activity={activity} units={units} />
      <HeartRate activity={activity} />
      {activity.type === 'run' || activity.type === 'race' ? (
        <StandoutCard activityId={activity.id} units={units} />
      ) : null}
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
