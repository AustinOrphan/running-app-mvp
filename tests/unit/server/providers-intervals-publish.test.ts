import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fakeFetch, type FakeRoute } from '../../fakeFetch.ts'
import {
  intervalsPublish,
  parseReference,
  renderIntervalsDescription,
  WARNING_NO_MAX_HR,
  WARNING_NO_THRESHOLD_PACE,
  WARNING_UNPARSED_STEPS,
} from '../../../server/providers/intervalsPublish.ts'
import {
  PublishError,
  PublishPause,
  RateLimitPause,
  type OutboundWorkout,
  type ProviderCtx,
  type PublishReference,
  type UpsertOutcome,
} from '../../../server/providers/types.ts'
import { easedSession } from '../../../shared/engine/readiness.ts'
import { prescribe } from '../../../shared/engine/sessions.ts'
import { rungSessions, sessionMin } from '../../../shared/engine/startWeeks.ts'
import { resolveTargets } from '../../../shared/engine/targets.ts'
import type { SessionKind, SessionSpec } from '../../../shared/engine/types.ts'
import type { Units } from '../../../shared/types.ts'
import { publicTitle, publishable } from '../../../shared/workouts/labels.ts'
import { toWorkoutPlan } from '../../../shared/workouts/plan.ts'
import type { WorkoutPlan } from '../../../shared/workouts/types.ts'
import { SESSION_KINDS, weekFixture, zoneSetFixture } from '../engine/fixtures.ts'

const BASE = 'https://intervals.icu/api/v1'
const EVENTS = `${BASE}/athlete/i1001/events`
const KEY = 'key-123'
const AUTH = `Basic ${Buffer.from(`API_KEY:${KEY}`).toString('base64')}`
const REF: PublishReference = { maxHr: 190, lthr: 170, thresholdPaceMps: 3.8 }
const zones = zoneSetFixture()

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  })
}

function makeCtx(routes: Record<string, FakeRoute>, over: Partial<ProviderCtx> = {}): ProviderCtx {
  return {
    fetch: fakeFetch(routes),
    timezone: 'UTC',
    secret: { apiKey: KEY },
    config: { athleteId: 'i1001' },
    saveSecret: async () => {},
    parseFile: () => {
      throw new Error('parseFile not expected')
    },
    sleep: async () => {},
    now: () => new Date('2026-03-10T12:00:00Z'),
    userId: 'u1',
    ...over,
  }
}

interface PlanOptions {
  eased?: boolean
  hot?: boolean
  units?: Units
  fuelLine?: string | null
  flags?: string[]
}

function sessionOf(kind: SessionKind, minutes: number, flags: string[] = []): SessionSpec {
  return {
    ...prescribe(kind, minutes, zones, weekFixture({ flags }), { goalPaceSecPerKm: 330 }),
    date: '2026-07-10',
    order: 1,
  }
}

function planOf(kind: SessionKind, minutes: number, options: PlanOptions = {}): WorkoutPlan {
  const base = sessionOf(kind, minutes, options.flags)
  const session = options.eased ? easedSession(base, zones) : base
  const targets = resolveTargets(session, zones, { hot: options.hot ?? false })
  return toWorkoutPlan(session, targets, {
    eased: options.eased ?? false,
    fuelLine: options.fuelLine ?? null,
    units: options.units ?? 'km',
  })
}

function outbound(index: number, over: Partial<OutboundWorkout> = {}): OutboundWorkout {
  const plan = over.plan ?? planOf('easy', 45)
  return {
    externalId: `rl-abc123-ext${String(index)}`,
    date: `2026-03-${String(10 + (index % 14)).padStart(2, '0')}`,
    name: plan.title,
    plan,
    remoteId: null,
    ...over,
  }
}

/** The events a bulk call created, as intervals.icu answers: an id and the echoed external id. */
function created(body: Array<Record<string, unknown>>, firstId = 9000): unknown[] {
  return body.map((event, i) => ({
    id: firstId + i,
    external_id: event['external_id'],
    workout_doc: { steps: [{ duration: 2700 }] },
    push_errors: [],
  }))
}

async function bodyOf(req: Request): Promise<Array<Record<string, unknown>>> {
  return (await req.json()) as Array<Record<string, unknown>>
}

// ---------------------------------------------------------------------------------------------
// The description
// ---------------------------------------------------------------------------------------------

const stepLines = (text: string): string[] => text.split('\n').filter((l) => l.startsWith('- '))

/** Seconds of a description: the `h`, `m` and `s` tokens of each step, times its repeat count. */
function secondsOfDescription(text: string): number {
  let total = 0
  let repeat = 1
  for (const line of text.split('\n')) {
    if (line === '') repeat = 1
    const times = /^(\d+)x$/.exec(line)
    if (times) repeat = Number(times[1])
    if (!line.startsWith('- ')) continue
    const token = /\s((?:\d+h)?(?:\d+m)?(?:\d+s)?)(?=\s|$)/.exec(line)?.[1] ?? ''
    const parts = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(token)
    const sec =
      Number(parts?.[1] ?? 0) * 3600 + Number(parts?.[2] ?? 0) * 60 + Number(parts?.[3] ?? 0)
    total += sec * repeat
  }
  return total
}

describe('renderIntervalsDescription', () => {
  it('writes an easy run as one heart-rate ceiling, in percent of maximum rounded down', () => {
    const plan = planOf('easy', 45)
    const ceiling = plan.targets.hrCeiling
    expect(ceiling).not.toBeNull()
    const high = Math.floor(((ceiling ?? 0) * 100) / 190)
    const low = Math.floor((40 * 100) / 190)
    const { text, warnings } = renderIntervalsDescription(plan, REF)
    expect(warnings).toEqual([])
    expect(text).toBe(
      `Heart rate under ${String(ceiling)} bpm\n\n- Run 45m ${String(low)}-${String(high)}% HR`,
    )
  })

  it('rounds down where a float would round the wrong way', () => {
    // 57 / 100 * 100 is 56.99999999999999 in floating point; the percentage is 57.
    const plan = planOf('easy', 30)
    const step = plan.nodes[0]
    if (step?.type !== 'step') throw new Error('expected a step')
    step.target = { kind: 'hr-ceiling', floorBpm: 40, ceilingBpm: 57 }
    const { text } = renderIntervalsDescription(plan, { ...REF, maxHr: 100 })
    expect(stepLines(text)).toEqual(['- Run 30m 40-57% HR'])
  })

  it('gives interval reps a pace band as percent of threshold pace and the recovery no target', () => {
    const plan = planOf('intervals', 60)
    const { text, warnings } = renderIntervalsDescription(plan, REF)
    expect(warnings).toEqual([])
    const [slow, fast] = plan.targets.paceSecPerKm ?? [0, 0]
    const pct = (sec: number) => Math.round(100000 / (3.8 * sec))
    expect(text).toMatch(/^\d+x\n- Fast \d+m(?:\d+s)? \d+-\d+% Pace\n- Recover \d+m(?:\d+s)?$/m)
    expect(text).toContain(`${String(pct(slow))}-${String(pct(fast))}% Pace`)
    expect(text).toMatch(/- Warm up \d+m\n/)
    expect(text).toMatch(/- Cool down \d+m/)
    // a fast rep is a larger percentage than a slow one
    expect(pct(fast)).toBeGreaterThan(pct(slow))
  })

  it('puts the absolute figures in one header line and the steps below it', () => {
    const { text } = renderIntervalsDescription(planOf('threshold', 50), REF)
    const [header, blank, ...rest] = text.split('\n')
    expect(header).toMatch(/^Pace \d:\d\d to \d:\d\d \/km$/)
    expect(blank).toBe('')
    expect(rest[0]).toMatch(/^- /)
  })

  it('writes the header in the runner’s units', () => {
    const km = renderIntervalsDescription(planOf('threshold', 50, { units: 'km' }), REF).text
    const mi = renderIntervalsDescription(planOf('threshold', 50, { units: 'mi' }), REF).text
    expect(km.split('\n')[0]).toMatch(/\/km$/)
    expect(mi.split('\n')[0]).toMatch(/\/mi$/)
    // the percentages do not depend on the display unit
    expect(stepLines(km)).toEqual(stepLines(mi))
  })

  it('writes a step open and warns when the remote has no maximum heart rate', () => {
    const plan = planOf('easy', 45)
    const { text, warnings } = renderIntervalsDescription(plan, { ...REF, maxHr: null })
    expect(warnings).toEqual([WARNING_NO_MAX_HR])
    expect(stepLines(text)).toEqual(['- Run 45m'])
    expect(text.split('\n')[0]).toBe(`Heart rate under ${String(plan.targets.hrCeiling)} bpm`)
  })

  it('writes a step open and warns when the remote has no threshold pace', () => {
    const { text, warnings } = renderIntervalsDescription(planOf('intervals', 60), {
      ...REF,
      thresholdPaceMps: null,
    })
    expect(warnings).toEqual([WARNING_NO_THRESHOLD_PACE])
    expect(text).not.toMatch(/% Pace/)
    expect(text.split('\n')[0]).toMatch(/^Pace \d:\d\d to \d:\d\d \/km$/)
  })

  it('warns once however many steps lack the figure', () => {
    const { warnings } = renderIntervalsDescription(planOf('hills', 60), {
      maxHr: null,
      lthr: null,
      thresholdPaceMps: null,
    })
    expect(warnings).toEqual([...new Set(warnings)].sort())
  })

  it('opens every step on a day steered by heat and keeps the note', () => {
    const plan = planOf('intervals', 60, { hot: true })
    const { text, warnings } = renderIntervalsDescription(plan, REF)
    expect(warnings).toEqual([])
    expect(plan.targets.hotNote).not.toBeNull()
    expect(text.split('\n')[0]).toBe(plan.targets.hotNote)
    expect(text).not.toMatch(/%/)
  })

  it('says "Eased for today" and never a reason', () => {
    const plan = planOf('intervals', 60, { eased: true })
    const { text } = renderIntervalsDescription(plan, REF)
    // the same line the shared plan writes
    expect(plan.description.split('\n')[0]).toBe('Eased for today')
    expect(text.split('\n')[0]).toBe('Eased for today')
    expect(text).not.toMatch(/injur|ill|pain|sick|tired|readiness|check-in/i)
  })

  it('ends with the fuel line, as it is', () => {
    const fuelLine = 'Tonight: carbohydrate 90 g per hour on this one.'
    const { text } = renderIntervalsDescription(planOf('long', 150, { fuelLine }), REF)
    expect(text.endsWith(`\n\n${fuelLine}`)).toBe(true)
  })

  it('names race-pace work "Race", because "pace" is a target keyword to intervals.icu', () => {
    const { text } = renderIntervalsDescription(planOf('race-pace', 60), REF)
    expect(stepLines(text).some((l) => /^- Race \d/.test(l))).toBe(true)
    expect(text).not.toMatch(/- Race pace/i)
  })

  it('names the walks of a run-walk session and not the run-walk programme', () => {
    const blueprint = rungSessions(1)[0]!
    const session: SessionSpec = {
      ...prescribe(
        'easy',
        sessionMin(blueprint),
        zones,
        weekFixture({ flags: ['restart-floor', 'run-walk', 'ladder-1'] }),
        {
          blueprint,
        },
      ),
      date: '2026-07-10',
      order: 1,
    }
    const plan = toWorkoutPlan(session, resolveTargets(session, zones, { hot: false }), {
      units: 'km',
    })
    const { text } = renderIntervalsDescription(plan, REF)
    expect(text.split('\n\n')).toEqual(['- Walk 5m', '7x\n- Run 1m\n- Walk 2m', '- Walk 5m'])
    expect(secondsOfDescription(text)).toBe(plan.totalSec)
    expect(text).not.toMatch(/run-walk|return|injur|restart/i)
  })

  it('lasts as long as the plan for every publishable kind, length and unit', () => {
    let checked = 0
    for (const kind of SESSION_KINDS.filter(publishable)) {
      for (const minutes of [20, 30, 45, 60, 90, 150, 240]) {
        for (const units of ['km', 'mi'] as const) {
          const plan = planOf(kind, minutes, { units })
          const { text } = renderIntervalsDescription(plan, REF)
          expect(secondsOfDescription(text), `${kind} ${String(minutes)}`).toBe(plan.totalSec)
          checked += 1
        }
      }
    }
    expect(checked).toBe(SESSION_KINDS.filter(publishable).length * 7 * 2)
  })

  it('carries the figures of the steps and no others', () => {
    for (const kind of SESSION_KINDS.filter(publishable)) {
      for (const units of ['km', 'mi'] as const) {
        const plan = planOf(kind, 60, { units })
        const { text } = renderIntervalsDescription(plan, REF)
        const body = plan.description.toLowerCase()
        const header = text.split('\n\n')[0] ?? ''
        const figures = header
          .split('\n')
          .flatMap((line) => line.split('; '))
          .filter((part) => /^(heart rate|pace) /i.test(part))
        for (const figure of figures) {
          expect(body, `${kind} ${units}: ${figure}`).toContain(figure.toLowerCase())
        }
      }
    }
  })
})

// ---------------------------------------------------------------------------------------------
// reference
// ---------------------------------------------------------------------------------------------

describe('intervals.icu reference', () => {
  const settings = [
    { id: 1, types: ['Ride', 'VirtualRide'], max_hr: 175, lthr: 160, ftp: 250 },
    { id: 2, types: ['Run', 'VirtualRun'], max_hr: 191, lthr: 172, threshold_pace: 3.85 },
  ]

  it('reads the Run entry of the sport settings', async () => {
    const seen: string[] = []
    const ctx = makeCtx({
      [`GET ${BASE}/athlete/i1001/sport-settings`]: (req) => {
        seen.push(req.headers.get('authorization') ?? '')
        return json(settings)
      },
    })
    await expect(intervalsPublish.reference(ctx)).resolves.toEqual({
      maxHr: 191,
      lthr: 172,
      thresholdPaceMps: 3.85,
    })
    expect(seen).toEqual([AUTH])
  })

  it('prefers Run over its variants and reads camel-case names', () => {
    expect(
      parseReference([
        { types: ['TrailRun'], max_hr: 180 },
        { types: ['Run'], maxHr: 190, thresholdPace: 4 },
      ]),
    ).toEqual({ maxHr: 190, lthr: null, thresholdPaceMps: 4 })
    expect(parseReference({ sportSettings: [{ types: ['Run'], max_hr: 188 }] }).maxHr).toBe(188)
    expect(parseReference([{ types: ['VirtualRun'], max_hr: 177 }]).maxHr).toBe(177)
  })

  it('reads a missing or nonsense value as missing', () => {
    const empty = { maxHr: null, lthr: null, thresholdPaceMps: null }
    expect(parseReference([{ types: ['Ride'], max_hr: 180 }])).toEqual(empty)
    expect(parseReference([])).toEqual(empty)
    expect(parseReference('nope')).toEqual(empty)
    expect(parseReference(null)).toEqual(empty)
    expect(
      parseReference([{ types: ['Run'], max_hr: 12, lthr: '170', threshold_pace: 330 }]),
    ).toEqual(empty)
  })

  it('throws a typed error for a rejected key, a server fault and an unreadable answer', async () => {
    const route = `GET ${BASE}/athlete/i1001/sport-settings`
    const cases: Array<[Response, string]> = [
      [json({}, 401), 'auth'],
      [json({}, 403), 'auth'],
      [json({}, 503), 'network'],
      [json({}, 404), 'rejected'],
      [new Response('<html>', { status: 200 }), 'rejected'],
    ]
    for (const [response, code] of cases) {
      const error = await intervalsPublish
        .reference(makeCtx({ [route]: () => response.clone() }))
        .catch((e: unknown) => e)
      expect(error, code).toBeInstanceOf(PublishError)
      expect((error as PublishError).code).toBe(code)
    }
  })

  it('throws RateLimitPause with the wait on a 429', async () => {
    const ctx = makeCtx({
      [`GET ${BASE}/athlete/i1001/sport-settings`]: () => json({}, 429, { 'retry-after': '120' }),
    })
    const error = await intervalsPublish.reference(ctx).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(RateLimitPause)
    expect((error as RateLimitPause).retryAfterSec).toBe(120)
  })

  it('is not-connected without a key, and network when nothing answers', async () => {
    const notConnected = await intervalsPublish
      .reference(makeCtx({}, { secret: {} }))
      .catch((e: unknown) => e)
    expect(notConnected).toMatchObject({ name: 'PublishError', code: 'not-connected' })
    const offline = await intervalsPublish
      .reference(
        makeCtx(
          {},
          {
            fetch: () => {
              throw new TypeError(`connect failed for ${BASE} with ${KEY}`)
            },
          },
        ),
      )
      .catch((e: unknown) => e)
    expect(offline).toMatchObject({ name: 'PublishError', code: 'network' })
    expect(JSON.stringify(offline)).not.toContain(KEY)
    expect((offline as Error).message).not.toContain(KEY)
  })
})

// ---------------------------------------------------------------------------------------------
// upsert
// ---------------------------------------------------------------------------------------------

describe('intervals.icu upsert', () => {
  it('sends new events in one bulk call with upsert on, and keeps the ids it is given', async () => {
    const calls: Array<{ method: string; url: string; auth: string; body: unknown }> = []
    const ctx = makeCtx({
      [`POST ${EVENTS}/bulk`]: async (req) => {
        const body = await bodyOf(req)
        calls.push({
          method: req.method,
          url: req.url,
          auth: req.headers.get('authorization') ?? '',
          body,
        })
        return json(created(body))
      },
    })
    const workouts = [outbound(1), outbound(2, { plan: planOf('intervals', 60) })]
    const outcomes = await intervalsPublish.upsert(workouts, REF, ctx)
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({
      method: 'POST',
      url: `${EVENTS}/bulk?upsert=true`,
      auth: AUTH,
    })
    expect(outcomes).toEqual([
      {
        externalId: 'rl-abc123-ext1',
        ok: true,
        remoteId: '9000',
        warnings: [],
        deviceMessage: null,
      },
      {
        externalId: 'rl-abc123-ext2',
        ok: true,
        remoteId: '9001',
        warnings: [],
        deviceMessage: null,
      },
    ])
    const sent = calls[0]?.body as Array<Record<string, unknown>>
    expect(sent[0]).toEqual({
      category: 'WORKOUT',
      start_date_local: workouts[0]?.date,
      type: 'Run',
      name: 'Easy run, 45 min',
      description: renderIntervalsDescription(workouts[0]!.plan, REF).text,
      external_id: 'rl-abc123-ext1',
    })
  })

  it('sends a date with no time part, a public title and the external id', async () => {
    const bodies: Array<Record<string, unknown>> = []
    const ctx = makeCtx({
      [`POST ${EVENTS}/bulk`]: async (req) => {
        const body = await bodyOf(req)
        bodies.push(...body)
        return json(created(body))
      },
    })
    const workouts = SESSION_KINDS.filter(publishable).map((kind, i) => {
      const plan = planOf(kind, 60)
      return outbound(i, { plan, name: publicTitle(sessionOf(kind, 60)) })
    })
    await intervalsPublish.upsert(workouts, REF, ctx)
    expect(bodies).toHaveLength(workouts.length)
    for (const body of bodies) {
      expect(body['start_date_local']).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(body['external_id']).toMatch(/^rl-abc123-ext\d+$/)
      expect(body['category']).toBe('WORKOUT')
      expect(JSON.stringify(body)).not.toMatch(/injur|illness|pain|return|post-race|run-walk/i)
    }
  })

  it('splits more than 50 new events into chunks of 50', async () => {
    const sizes: number[] = []
    const ctx = makeCtx({
      [`POST ${EVENTS}/bulk`]: async (req) => {
        const body = await bodyOf(req)
        sizes.push(body.length)
        return json(created(body, 100 * sizes.length))
      },
    })
    const workouts = Array.from({ length: 120 }, (_, i) => outbound(i))
    const outcomes = await intervalsPublish.upsert(workouts, REF, ctx)
    expect(sizes).toEqual([50, 50, 20])
    expect(outcomes).toHaveLength(120)
    expect(outcomes.every((o) => o.ok)).toBe(true)
    expect(outcomes.map((o) => o.externalId)).toEqual(workouts.map((w) => w.externalId))
  })

  it('updates a known event by PUT on its remote id, a moved date included', async () => {
    const puts: Array<{ url: string; body: Record<string, unknown> }> = []
    const ctx = makeCtx({
      [`PUT ${EVENTS}/`]: async (req) => {
        const body = (await req.json()) as Record<string, unknown>
        puts.push({ url: req.url, body })
        return json({ id: 777, ...body, workout_doc: { steps: [{}] } })
      },
    })
    const moved = outbound(1, { remoteId: '777', date: '2026-03-14' })
    const [outcome] = await intervalsPublish.upsert([moved], REF, ctx)
    expect(puts).toHaveLength(1)
    expect(puts[0]?.url).toBe(`${EVENTS}/777`)
    expect(puts[0]?.body['start_date_local']).toBe('2026-03-14')
    expect(puts[0]?.body['external_id']).toBe('rl-abc123-ext1')
    expect(outcome).toEqual({
      externalId: 'rl-abc123-ext1',
      ok: true,
      remoteId: '777',
      warnings: [],
      deviceMessage: null,
    })
  })

  it('returns outcomes in the order given when new and known events are mixed', async () => {
    const order: string[] = []
    const ctx = makeCtx({
      [`POST ${EVENTS}/bulk`]: async (req) => {
        order.push('bulk')
        return json(created(await bodyOf(req)))
      },
      [`PUT ${EVENTS}/`]: (req) => {
        order.push('put')
        return json({ id: Number(req.url.split('/').pop()), workout_doc: { steps: [{}] } })
      },
    })
    const workouts = [
      outbound(1, { remoteId: '11' }),
      outbound(2),
      outbound(3, { remoteId: '33' }),
      outbound(4),
    ]
    const outcomes = await intervalsPublish.upsert(workouts, REF, ctx)
    expect(outcomes.map((o) => o.externalId)).toEqual(workouts.map((w) => w.externalId))
    expect(outcomes.map((o) => (o.ok ? o.remoteId : null))).toEqual(['11', '9000', '33', '9001'])
    // creates go first, so a day never has fewer sessions than before
    expect(order).toEqual(['bulk', 'put', 'put'])
  })

  it('reports a PUT answered 404 as removed by the runner', async () => {
    const ctx = makeCtx({
      [`PUT ${EVENTS}/`]: () => json({ error: 'Not found' }, 404),
    })
    const [outcome] = await intervalsPublish.upsert([outbound(1, { remoteId: '5' })], REF, ctx)
    expect(outcome).toEqual({
      externalId: 'rl-abc123-ext1',
      ok: false,
      code: 'owner-removed',
      message: 'The event was removed in intervals.icu.',
    })
  })

  it('turns push_errors into the device message, sanitised and capped', async () => {
    const long = 'Garmin Connect refused the workout. '.repeat(20)
    const ctx = makeCtx({
      [`POST ${EVENTS}/bulk`]: async (req) => {
        const body = await bodyOf(req)
        return json([
          {
            id: 1,
            external_id: body[0]?.['external_id'],
            workout_doc: { steps: [{}] },
            push_errors: [`Too\nmany   steps ${KEY}`, { message: 'Second' }],
          },
          {
            id: 2,
            external_id: body[1]?.['external_id'],
            workout_doc: { steps: [{}] },
            push_errors: [long],
          },
        ])
      },
    })
    const [first, second] = await intervalsPublish.upsert([outbound(1), outbound(2)], REF, ctx)
    expect(first).toMatchObject({ ok: true, deviceMessage: 'Too many steps [removed]; Second' })
    expect(second?.ok && second.deviceMessage).toBeTruthy()
    expect(second?.ok && (second.deviceMessage ?? '').length).toBeLessThanOrEqual(200)
  })

  it('warns when intervals.icu read no steps, and only then', async () => {
    const answers: Record<string, unknown> = {
      empty: { steps: [] },
      missing: undefined,
      full: { steps: [{ duration: 60 }] },
    }
    for (const [name, doc] of Object.entries(answers)) {
      const ctx = makeCtx({
        [`POST ${EVENTS}/bulk`]: async (req) => {
          const [event] = await bodyOf(req)
          return json([{ id: 1, external_id: event?.['external_id'], workout_doc: doc }])
        },
      })
      const [outcome] = await intervalsPublish.upsert([outbound(1)], REF, ctx)
      expect(outcome?.ok && outcome.warnings, name).toEqual(
        name === 'full' ? [] : [WARNING_UNPARSED_STEPS],
      )
    }
  })

  it('warns the same way when a PUT is answered without steps', async () => {
    const ctx = makeCtx({
      [`PUT ${EVENTS}/`]: () => json({ id: 5, workout_doc: { steps: [] } }),
    })
    const [outcome] = await intervalsPublish.upsert([outbound(1, { remoteId: '5' })], REF, ctx)
    expect(outcome?.ok && outcome.warnings).toEqual([WARNING_UNPARSED_STEPS])
  })

  it('carries the reference warnings and the unparsed warning together, sorted', async () => {
    const ctx = makeCtx({
      [`POST ${EVENTS}/bulk`]: async (req) => {
        const [event] = await bodyOf(req)
        return json([{ id: 1, external_id: event?.['external_id'], workout_doc: {} }])
      },
    })
    const [outcome] = await intervalsPublish.upsert([outbound(1)], { ...REF, maxHr: null }, ctx)
    expect(outcome?.ok && outcome.warnings).toEqual([WARNING_NO_MAX_HR, WARNING_UNPARSED_STEPS])
  })

  it('matches an answer without external ids by position, and flags an event with no id', async () => {
    const ctx = makeCtx({
      [`POST ${EVENTS}/bulk`]: () => json([{ id: 41, workout_doc: { steps: [{}] } }, { id: 42 }]),
    })
    const outcomes = await intervalsPublish.upsert([outbound(1), outbound(2)], REF, ctx)
    expect(outcomes.map((o) => (o.ok ? o.remoteId : o.code))).toEqual(['41', '42'])

    const partial = makeCtx({ [`POST ${EVENTS}/bulk`]: () => json([]) })
    const lost = await intervalsPublish.upsert([outbound(1)], REF, partial)
    expect(lost).toEqual([
      expect.objectContaining({ ok: false, code: 'rejected', externalId: 'rl-abc123-ext1' }),
    ])
  })

  it('asks for a reconnect on 401 and stops, without sending the rest', async () => {
    let calls = 0
    const ctx = makeCtx({
      [`POST ${EVENTS}/bulk`]: () => {
        calls += 1
        return json({}, 401)
      },
      [`PUT ${EVENTS}/`]: () => {
        calls += 1
        return json({})
      },
    })
    const workouts = [outbound(1), outbound(2, { remoteId: '2' }), outbound(3)]
    const outcomes = await intervalsPublish.upsert(workouts, REF, ctx)
    expect(calls).toBe(1)
    expect(outcomes.map((o) => !o.ok && o.code)).toEqual(['auth', 'auth', 'auth'])
    expect(outcomes[0]).toMatchObject({
      message: 'intervals.icu did not accept the API key. Reconnect it on the Integrations page.',
    })
  })

  it('treats a 403 on a PUT like a 401', async () => {
    const ctx = makeCtx({ [`PUT ${EVENTS}/`]: () => json({}, 403) })
    const outcomes = await intervalsPublish.upsert(
      [outbound(1, { remoteId: '1' }), outbound(2, { remoteId: '2' })],
      REF,
      ctx,
    )
    expect(outcomes.map((o) => !o.ok && o.code)).toEqual(['auth', 'auth'])
  })

  it('marks a 400 and a 422 rejected with the remote words, and sends the others on', async () => {
    const answers = [
      json({ error: 'Cannot read step 3' }, 400),
      json({ message: 'start_date_local is not valid' }, 422),
    ]
    const ctx = makeCtx({
      [`PUT ${EVENTS}/`]: () => answers.shift() ?? json({ id: 3, workout_doc: { steps: [{}] } }),
    })
    const outcomes = await intervalsPublish.upsert(
      [1, 2, 3].map((i) => outbound(i, { remoteId: String(i) })),
      REF,
      ctx,
    )
    expect(outcomes[0]).toMatchObject({
      ok: false,
      code: 'rejected',
      message: 'Cannot read step 3',
    })
    expect(outcomes[1]).toMatchObject({
      ok: false,
      code: 'rejected',
      message: 'start_date_local is not valid',
    })
    expect(outcomes[2]).toMatchObject({ ok: true, remoteId: '3' })
  })

  it('strips an echo of the key from a rejection and caps its length', async () => {
    const echo = `Bad request: Authorization ${AUTH} and key ${KEY} and ${Buffer.from(`API_KEY:${KEY}`).toString('base64')}. ${'x'.repeat(400)}`
    const ctx = makeCtx({
      [`POST ${EVENTS}/bulk`]: () => new Response(echo, { status: 400 }),
    })
    const [outcome] = await intervalsPublish.upsert([outbound(1)], REF, ctx)
    expect(outcome?.ok).toBe(false)
    const message = outcome && !outcome.ok ? outcome.message : ''
    expect(message).not.toContain(KEY)
    expect(message).not.toContain(AUTH)
    expect(message).not.toContain(AUTH.slice('Basic '.length))
    expect(message.length).toBeLessThanOrEqual(200)
    expect(message).toContain('[removed]')
  })

  it('names a server fault and an unreachable host network, to be retried', async () => {
    const down = makeCtx({ [`POST ${EVENTS}/bulk`]: () => json({}, 502) })
    const [fault] = await intervalsPublish.upsert([outbound(1)], REF, down)
    expect(fault).toMatchObject({ ok: false, code: 'network' })

    const offline = makeCtx(
      {},
      {
        fetch: () => {
          throw new TypeError(`getaddrinfo failed for ${KEY}`)
        },
      },
    )
    const outcomes = await intervalsPublish.upsert([outbound(1), outbound(2)], REF, offline)
    expect(outcomes.map((o) => !o.ok && o.code)).toEqual(['network', 'network'])
    expect(JSON.stringify(outcomes)).not.toContain(KEY)
  })

  it('throws a pause on a 429 that keeps the outcomes of the chunks already sent', async () => {
    let chunks = 0
    const ctx = makeCtx({
      [`POST ${EVENTS}/bulk`]: async (req) => {
        chunks += 1
        if (chunks === 2) return json({}, 429, { 'retry-after': '300' })
        return json(created(await bodyOf(req)))
      },
    })
    const workouts = Array.from({ length: 60 }, (_, i) => outbound(i))
    const error = await intervalsPublish.upsert(workouts, REF, ctx).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(PublishPause)
    expect(error).toBeInstanceOf(RateLimitPause)
    const pause = error as PublishPause
    expect(pause.retryAfterSec).toBe(300)
    expect(pause.outcomes).toHaveLength(50)
    expect(pause.outcomes.every((o: UpsertOutcome) => o.ok)).toBe(true)
    expect(pause.outcomes.map((o) => o.externalId)).toEqual(
      workouts.slice(0, 50).map((w) => w.externalId),
    )
  })

  it('waits 15 minutes on a 429 with no Retry-After, and keeps earlier PUTs', async () => {
    let puts = 0
    const ctx = makeCtx({
      [`PUT ${EVENTS}/`]: () => {
        puts += 1
        return puts === 1 ? json({ id: 1, workout_doc: { steps: [{}] } }) : json({}, 429)
      },
    })
    const workouts = [outbound(1, { remoteId: '1' }), outbound(2, { remoteId: '2' })]
    const error = (await intervalsPublish
      .upsert(workouts, REF, ctx)
      .catch((e: unknown) => e)) as PublishPause
    expect(error).toBeInstanceOf(PublishPause)
    expect(error.retryAfterSec).toBe(900)
    expect(error.outcomes.map((o) => o.externalId)).toEqual(['rl-abc123-ext1'])
  })

  it('answers not-connected for every workout without calling out', async () => {
    const spy = vi.fn()
    const ctx = makeCtx({}, { secret: {}, fetch: spy as unknown as typeof fetch })
    const outcomes = await intervalsPublish.upsert([outbound(1), outbound(2)], REF, ctx)
    expect(outcomes.map((o) => !o.ok && o.code)).toEqual(['not-connected', 'not-connected'])
    expect(spy).not.toHaveBeenCalled()
  })

  it('makes no call for an empty list', async () => {
    const spy = vi.fn()
    const ctx = makeCtx({}, { fetch: spy as unknown as typeof fetch })
    await expect(intervalsPublish.upsert([], REF, ctx)).resolves.toEqual([])
    expect(spy).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------------------------
// withdraw and list
// ---------------------------------------------------------------------------------------------

describe('intervals.icu withdraw', () => {
  it('deletes by remote id, or by external id when there is none', async () => {
    const bodies: unknown[] = []
    const ctx = makeCtx({
      [`PUT ${EVENTS}/bulk-delete`]: async (req) => {
        bodies.push(await req.json())
        expect(req.headers.get('authorization')).toBe(AUTH)
        return json({ eventsDeleted: 2 })
      },
    })
    await intervalsPublish.withdraw(
      [
        { externalId: 'rl-abc123-ext1', remoteId: '9001' },
        { externalId: 'rl-abc123-ext2', remoteId: null },
      ],
      ctx,
    )
    expect(bodies).toEqual([[{ id: 9001 }, { external_id: 'rl-abc123-ext2' }]])
  })

  it('chunks by 50 and makes no call for nothing to withdraw', async () => {
    const sizes: number[] = []
    const ctx = makeCtx({
      [`PUT ${EVENTS}/bulk-delete`]: async (req) => {
        sizes.push(((await req.json()) as unknown[]).length)
        return json({})
      },
    })
    await intervalsPublish.withdraw([], ctx)
    expect(sizes).toEqual([])
    await intervalsPublish.withdraw(
      Array.from({ length: 70 }, (_, i) => ({ externalId: `e${String(i)}`, remoteId: String(i) })),
      ctx,
    )
    expect(sizes).toEqual([50, 20])
  })

  it('throws a typed error for a rejected key and a pause for a 429', async () => {
    const refs = [{ externalId: 'e1', remoteId: '1' }]
    const auth = await intervalsPublish
      .withdraw(refs, makeCtx({ [`PUT ${EVENTS}/bulk-delete`]: () => json({}, 401) }))
      .catch((e: unknown) => e)
    expect(auth).toMatchObject({ name: 'PublishError', code: 'auth' })
    const slow = await intervalsPublish
      .withdraw(
        refs,
        makeCtx({ [`PUT ${EVENTS}/bulk-delete`]: () => json({}, 429, { 'retry-after': '30' }) }),
      )
      .catch((e: unknown) => e)
    expect(slow).toBeInstanceOf(RateLimitPause)
    expect((slow as RateLimitPause).retryAfterSec).toBe(30)
    const offline = await intervalsPublish
      .withdraw(
        refs,
        makeCtx(
          {},
          {
            fetch: () => {
              throw new TypeError('down')
            },
          },
        ),
      )
      .catch((e: unknown) => e)
    expect(offline).toMatchObject({ name: 'PublishError', code: 'network' })
  })
})

describe('intervals.icu list', () => {
  it('reads the workouts of the range with their ids, dates and device errors', async () => {
    const urls: string[] = []
    const ctx = makeCtx({
      [`GET ${EVENTS}`]: (req) => {
        urls.push(req.url)
        return json([
          {
            id: 11,
            external_id: 'rl-abc123-ext1',
            start_date_local: '2026-03-10T00:00:00',
            name: 'Easy run, 45 min',
            push_errors: ['Too many steps'],
          },
          { id: '12', start_date_local: '2026-03-11', name: 'Own workout' },
          { id: 13, start_date_local: 'garbled', name: 'Skipped' },
          { start_date_local: '2026-03-12', name: 'No id' },
          'not an event',
        ])
      },
    })
    const found = await intervalsPublish.list({ from: '2026-03-10', to: '2026-03-23' }, ctx)
    expect(urls).toEqual([`${EVENTS}?oldest=2026-03-10&newest=2026-03-23&category=WORKOUT`])
    expect(found).toEqual([
      {
        remoteId: '11',
        externalId: 'rl-abc123-ext1',
        date: '2026-03-10',
        name: 'Easy run, 45 min',
        deviceMessage: 'Too many steps',
      },
      {
        remoteId: '12',
        externalId: null,
        date: '2026-03-11',
        name: 'Own workout',
        deviceMessage: null,
      },
    ])
  })

  it('rejects a range that is not two dates, and surfaces failures as typed errors', async () => {
    const ctx = makeCtx({ [`GET ${EVENTS}`]: () => json({}, 401) })
    await expect(
      intervalsPublish.list({ from: '2026-03-10&x=1', to: '2026-03-12' }, ctx),
    ).rejects.toThrow(/range/i)
    await expect(
      intervalsPublish.list({ from: '2026-03-10', to: '2026-03-12' }, ctx),
    ).rejects.toMatchObject({ name: 'PublishError', code: 'auth' })
  })
})

// ---------------------------------------------------------------------------------------------
// The API key and the network
// ---------------------------------------------------------------------------------------------

describe('the API key and the network', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('appears in no outcome, message or log call over every failure path', async () => {
    const echo =
      (status: number): FakeRoute =>
      () =>
        new Response(`${AUTH} ${KEY} ${Buffer.from(`API_KEY:${KEY}`).toString('base64')}`, {
          status,
        })
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation(() => {}),
    )
    const results: unknown[] = []
    for (const status of [400, 401, 403, 404, 422, 429, 500, 503]) {
      const ctx = makeCtx({
        [`POST ${EVENTS}/bulk`]: echo(status),
        [`PUT ${EVENTS}/`]: echo(status),
        [`GET ${EVENTS}`]: echo(status),
        [`GET ${BASE}/athlete/i1001/sport-settings`]: echo(status),
      })
      const workouts = [outbound(1), outbound(2, { remoteId: '2' })]
      results.push(await intervalsPublish.upsert(workouts, REF, ctx).catch((e: unknown) => e))
      results.push(await intervalsPublish.reference(ctx).catch((e: unknown) => e))
      results.push(
        await intervalsPublish
          .list({ from: '2026-03-10', to: '2026-03-12' }, ctx)
          .catch((e: unknown) => e),
      )
      results.push(
        await intervalsPublish
          .withdraw([{ externalId: 'e', remoteId: '1' }], ctx)
          .catch((e: unknown) => e),
      )
    }
    const text = results
      .map((r) =>
        r instanceof Error ? `${r.name} ${r.message} ${JSON.stringify(r)}` : JSON.stringify(r),
      )
      .join('\n')
    expect(text).not.toContain(KEY)
    expect(text).not.toContain(AUTH)
    expect(text).not.toContain(Buffer.from(`API_KEY:${KEY}`).toString('base64'))
    for (const spy of spies) expect(spy).not.toHaveBeenCalled()
  })

  it('goes through ctx.fetch only: the global fetch is never called', async () => {
    const global = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network used'))
    const ctx = makeCtx({
      [`GET ${BASE}/athlete/i1001/sport-settings`]: () => json([]),
      [`POST ${EVENTS}/bulk`]: async (req) => json(created(await bodyOf(req))),
      [`PUT ${EVENTS}/`]: () => json({ id: 1 }),
      [`GET ${EVENTS}`]: () => json([]),
    })
    await intervalsPublish.reference(ctx)
    await intervalsPublish.upsert([outbound(1), outbound(2, { remoteId: '2' })], REF, ctx)
    await intervalsPublish.list({ from: '2026-03-10', to: '2026-03-12' }, ctx)
    expect(global).not.toHaveBeenCalled()
  })

  it('has no global fetch, logger, console or environment read in its source', () => {
    const source = readFileSync(
      fileURLToPath(new URL('../../../server/providers/intervalsPublish.ts', import.meta.url)),
      'utf8',
    )
    expect(source).not.toMatch(/(?<![.\w])fetch\s*\(/)
    expect(source).not.toMatch(/console\.|logger|pino|process\.env/)
    expect(source).not.toMatch(/prisma|PrismaClient/i)
  })
})
