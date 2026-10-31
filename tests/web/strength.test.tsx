import { cleanup, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { fromGrams, toGrams } from '../../shared/domain/weight.ts'
import { structuresFor } from '../../shared/engine/strength.ts'
import type {
  StrengthNextLoad,
  StrengthSnapshot,
  StrengthView,
  StrengthWorkout,
  UserSettings,
  WorkoutLift,
} from '../../shared/types.ts'
import type { StrengthLogBody } from '../../web/api/strength.ts'
import { ToastProvider } from '../../web/components/Toast.tsx'
import { StrengthSheet, type StrengthSaved } from '../../web/components/strength/StrengthSheet.tsx'
import { STRENGTH_DRAFT_PREFIX } from '../../web/pwa/drafts.ts'
import { measureOf, strengthWords } from '../../web/components/strength/strengthText.ts'
import { getOutbox } from '../../web/pwa/outbox.ts'
import {
  expectCleanCopy,
  explainOf,
  mockApi,
  renderWithProviders,
  type MockRoutes,
} from './helpers.tsx'
import {
  DAY,
  SESSION_ID,
  SETTINGS,
  STRENGTH_SETTINGS,
  bodyweightWorkout,
  calf,
  engineWorkout,
  lb,
  lighterDayWorkout,
  makeLog,
  makeView,
  makeWorkout,
  rdl,
  savedLog,
  set,
  snapLift,
  squat,
} from './strength-fixtures.ts'

// The Why drawer is stood in for: this file tests what the sheet asks it to open on.
vi.mock('../../web/components/WhyDrawer.tsx', () => ({
  WhyDrawer: ({ rules, explain, open }: { rules: string[]; explain?: unknown; open: boolean }) =>
    open ? (
      <div
        role="complementary"
        aria-label="Why drawer"
        data-explain={JSON.stringify(explain ?? null)}
      >
        {rules.join(',')}
      </div>
    ) : null,
}))

// A lift swapped in is a first session of its exercise, in any template of the week (design 10.3).
const FIRST = structuresFor('heavy', 'other', 6).first.loaded
const COUNT = String(FIRST.range.min)

const LOG_ID = '3f2b7c1e-8d4a-4f6b-9a31-5c0e2d7b6a10'
const LOG_URL = `/api/strength/logs/${LOG_ID}`

beforeEach(() => {
  window.localStorage.clear()
  vi.stubGlobal('crypto', { randomUUID: () => LOG_ID })
})

afterEach(() => {
  window.localStorage.clear()
  vi.restoreAllMocks()
})

interface Rig {
  calls: Array<{ method: string; url: string; body: unknown }>
  onClose: ReturnType<typeof vi.fn>
  onSaved: ReturnType<typeof vi.fn<(saved: StrengthSaved) => void>>
}

interface Options {
  workout?: StrengthWorkout
  settings?: UserSettings
  /** The page view; `null` makes the read fail, as it does with no connection. */
  view?: StrengthView | null
  routes?: MockRoutes
  date?: string
  sessionId?: string | null
  activityId?: string | null
}

const unreachable = {
  status: 503,
  body: { error: { code: 'internal', message: 'No connection.' } },
}

/** Opens the sheet on a workout, with the settings and the page view answered. */
function open(options: Options = {}): Rig {
  const view = options.view === undefined ? makeView() : options.view
  const { calls } = mockApi({
    'GET /api/settings': () => options.settings ?? SETTINGS,
    'GET /api/strength': () => (view === null ? unreachable : view),
    ...options.routes,
  })
  const onClose = vi.fn()
  const onSaved = vi.fn<(saved: StrengthSaved) => void>()
  renderWithProviders(
    <ToastProvider>
      <StrengthSheet
        workout={options.workout ?? makeWorkout()}
        date={options.date ?? DAY}
        {...(options.sessionId === undefined ? {} : { sessionId: options.sessionId })}
        {...(options.activityId === undefined ? {} : { activityId: options.activityId })}
        onClose={onClose}
        onSaved={onSaved}
      />
    </ToastProvider>,
  )
  return { calls, onClose, onSaved }
}

/** The sheet once it has drawn its lifts. */
async function sheet(name = 'Strength, heavy A') {
  const dialog = await screen.findByRole('dialog', { name })
  await within(dialog).findAllByRole('region')
  return dialog
}

const region = (name: string) => within(screen.getByRole('region', { name }))

/** The text field of a stepper: `Back squat, set 2, load`. */
function field(exercise: string, set: number, what: string): HTMLInputElement {
  return within(screen.getByRole('region', { name: exercise })).getByRole('textbox', {
    name: `${exercise}, set ${String(set)}, ${what}`,
  })
}

const escaped = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** The values of a lift's field for each of its sets. */
function values(exercise: string, what: string): string[] {
  const inputs = within(screen.getByRole('region', { name: exercise })).getAllByRole('textbox', {
    name: new RegExp(`^${escaped(exercise)}, set \\d+, ${what}$`),
  })
  return inputs.map((input) => (input as HTMLInputElement).value)
}

/** The value of reps left pressed in each set of a lift, null where none is. */
function repsLeft(exercise: string): Array<number | null> {
  const groups = region(exercise).getAllByRole('group', { name: /, set \d+, reps left$/ })
  return groups.map((group) => {
    const pressed = within(group)
      .getAllByRole('button')
      .find((button) => button.getAttribute('aria-pressed') === 'true')
    return pressed === undefined ? null : Number(pressed.textContent)
  })
}

const putBody = (calls: Rig['calls']): StrengthLogBody => {
  const call = calls.find((c) => c.method === 'PUT' && c.url.startsWith('/api/strength/logs/'))
  expect(call, 'a PUT to a strength log').toBeDefined()
  return call?.body as StrengthLogBody
}

describe('the sheet a workout opens as (design 9.1)', () => {
  test('is filled from the workout: its loads, its target in each set, no reps left, the planned minutes', async () => {
    open()
    const dialog = await sheet()
    expect(within(dialog).getByRole('form', { name: 'Strength, heavy A' })).toBeVisible()
    expect(within(dialog).getByText('Wed 18 Mar. Loads are in pounds.')).toBeVisible()
    expect(
      within(dialog).getByText(
        'Stop a set if anything hurts or form changes. Learn barbell lifts from a coach before adding load.',
      ),
    ).toBeVisible()
    expect(within(dialog).getByText(/Warm-up sets are not logged\./)).toBeVisible()

    // the squat: four sets at 110 lb, the counts to aim at, nothing recorded as left
    expect(values('Back squat', 'load')).toEqual(['110', '110', '110', '110'])
    expect(values('Back squat', 'reps')).toEqual(['5', '5', '4', '4'])
    expect(repsLeft('Back squat')).toEqual([null, null, null, null])
    expect(
      region('Back squat').getByText(
        'Suggested 110 lb, four sets of 3 to 6 reps, leave 1 to 3 in reserve.',
      ),
    ).toBeVisible()
    expect(
      region('Back squat').getByText(
        'Every set of Back squat reached 6 reps with reps left, so the load goes up one step.',
      ),
    ).toBeVisible()

    // the other lifts, the jump dose and the trunk movement are rows of the same kind
    expect(values('Dumbbell Romanian deadlift', 'load')).toEqual(['40', '40', '40'])
    expect(values('Pogo hops', 'contacts')).toEqual(['40'])
    expect(values('Side plank', 'seconds')).toEqual(['30', '30'])
    expect(screen.getByRole('textbox', { name: 'Minutes' })).toHaveValue('40')
  })

  test('shows the loads in kilograms for a runner who chose them, on the same grams', async () => {
    open({ settings: { ...SETTINGS, weightUnit: 'kg', units: 'km' } })
    const dialog = await sheet()
    expect(within(dialog).getByText('Wed 18 Mar. Loads are in kilograms.')).toBeVisible()
    expect(values('Back squat', 'load')).toEqual(['50', '50', '50', '50'])
    expect(
      region('Back squat').getByText(
        'Suggested 50 kg, four sets of 3 to 6 reps, leave 1 to 3 in reserve.',
      ),
    ).toBeVisible()
  })

  test('draws no load before it knows the unit, and says so when the settings cannot be read', async () => {
    mockApi({
      'GET /api/settings': () => ({
        status: 500,
        body: { error: { code: 'internal', message: 'Down.' } },
      }),
      'GET /api/strength': () => makeView(),
    })
    renderWithProviders(
      <ToastProvider>
        <StrengthSheet workout={makeWorkout()} date={DAY} onClose={vi.fn()} onSaved={vi.fn()} />
      </ToastProvider>,
    )
    const dialog = await screen.findByRole('dialog', { name: 'Strength, heavy A' })
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'The weight unit could not be read. Close this and try again.',
    )
    expect(within(dialog).queryByRole('textbox')).toBeNull()
    expectCleanCopy(dialog)
  })

  test('names the template and the variant in its heading, and the lighter-day line only on a lighter day', async () => {
    open({ workout: makeWorkout({ template: 'ramp-in', variant: 'B' }) })
    const dialog = await sheet('Strength, ramp-in B')
    expect(within(dialog).queryByText(/Lighter today/)).toBeNull()
  })
})

describe('a lift with no load', () => {
  test('is a bodyweight path with no load field and nothing to step but the count', async () => {
    open({ workout: bodyweightWorkout() })
    await sheet('Strength, ramp-in A')
    for (const name of ['Tempo squat', 'Hip thrust (glute bridge)', 'Standing calf raise']) {
      const scope = region(name)
      expect(scope.queryByRole('group', { name: /load$/ })).toBeNull()
      expect(scope.queryByRole('button', { name: /load by one step/ })).toBeNull()
      expect(scope.getAllByRole('group', { name: /reps$/ })).toHaveLength(3)
    }
    expect(
      region('Tempo squat').getByText(
        'Suggested three sets of 8 to 15 reps, leave 1 to 3 in reserve.',
      ),
    ).toBeVisible()
  })

  test('is saved with no load in any set', async () => {
    const { calls } = open({
      workout: bodyweightWorkout(),
      routes: { [`PUT ${LOG_URL}`]: () => savedLog(LOG_ID) },
    })
    await sheet('Strength, ramp-in A')
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => {
      expect(calls.some((call) => call.method === 'PUT')).toBe(true)
    })
    const body = putBody(calls)
    expect(body.sets).toHaveLength(9)
    expect(body.sets.every((set) => set.loadG === null)).toBe(true)
  })
})

describe('the steppers', () => {
  test('move the load one step of the equipment: a bar in jumps of 5 lb, dumbbells along their list', async () => {
    open()
    await sheet()
    const user = userEvent.setup()
    const squatSet2 = within(screen.getByRole('group', { name: 'Back squat, set 2, load' }))
    await user.click(squatSet2.getByRole('button', { name: 'Raise the load by one step' }))
    expect(values('Back squat', 'load')).toEqual(['110', '115', '110', '110'])
    await user.click(squatSet2.getByRole('button', { name: 'Lower the load by one step' }))
    await user.click(squatSet2.getByRole('button', { name: 'Lower the load by one step' }))
    expect(values('Back squat', 'load')).toEqual(['110', '105', '110', '110'])

    // dumbbells come in a list: 40, then 45, then 50, never 42.5
    const rdlSet1 = within(
      screen.getByRole('group', { name: 'Dumbbell Romanian deadlift, set 1, load' }),
    )
    await user.click(rdlSet1.getByRole('button', { name: 'Raise the load by one step' }))
    await user.click(rdlSet1.getByRole('button', { name: 'Raise the load by one step' }))
    expect(values('Dumbbell Romanian deadlift', 'load')).toEqual(['50', '40', '40'])
  })

  test('stop at the ends of the equipment and say so, without dropping focus', async () => {
    open({
      workout: makeWorkout({
        lifts: [squat({ loadG: lb(45) }), rdl({ loadG: lb(60) })],
        plyo: null,
        trunk: [],
      }),
    })
    await sheet()
    const user = userEvent.setup()
    const lower = within(screen.getByRole('group', { name: 'Back squat, set 1, load' })).getByRole(
      'button',
      { name: 'Lower the load by one step' },
    )
    expect(lower).toHaveAttribute('aria-disabled', 'true')
    await user.click(lower)
    expect(values('Back squat', 'load')[0]).toBe('45')
    expect(lower).toHaveFocus()
    const raise = within(
      screen.getByRole('group', { name: 'Dumbbell Romanian deadlift, set 1, load' }),
    ).getByRole('button', { name: 'Raise the load by one step' })
    expect(raise).toHaveAttribute('aria-disabled', 'true')
    await user.click(raise)
    expect(values('Dumbbell Romanian deadlift', 'load')[0]).toBe('60')
  })

  test('take a typed load, and a press from it lands on the next rung', async () => {
    open()
    await sheet()
    const user = userEvent.setup()
    const input = field('Back squat', 1, 'load')
    expect(input).toHaveAttribute('inputmode', 'decimal')
    await user.clear(input)
    await user.type(input, '52')
    expect(input).toHaveValue('52')
    await user.click(
      within(screen.getByRole('group', { name: 'Back squat, set 1, load' })).getByRole('button', {
        name: 'Raise the load by one step',
      }),
    )
    expect(input).toHaveValue('55')
    await user.clear(input)
    await user.type(input, '47.5')
    await user.click(
      within(screen.getByRole('group', { name: 'Back squat, set 1, load' })).getByRole('button', {
        name: 'Lower the load by one step',
      }),
    )
    expect(input).toHaveValue('45')
  })

  test('move the count by one rep, five seconds or ten contacts, and never below one', async () => {
    open()
    await sheet()
    const user = userEvent.setup()
    const press = async (group: string, button: string) => {
      await user.click(
        within(screen.getByRole('group', { name: group })).getByRole('button', { name: button }),
      )
    }
    await press('Back squat, set 1, reps', 'Raise the reps by 1')
    expect(field('Back squat', 1, 'reps')).toHaveValue('6')
    await press('Side plank, set 1, seconds', 'Raise the seconds by 5')
    expect(field('Side plank', 1, 'seconds')).toHaveValue('35')
    await press('Pogo hops, set 1, contacts', 'Raise the contacts by 10')
    expect(field('Pogo hops', 1, 'contacts')).toHaveValue('50')
    for (let press1 = 0; press1 < 8; press1 += 1) {
      await press('Back squat, set 1, reps', 'Lower the reps by 1')
    }
    expect(field('Back squat', 1, 'reps')).toHaveValue('1')
    expect(
      within(screen.getByRole('group', { name: 'Back squat, set 1, reps' })).getByRole('button', {
        name: 'Lower the reps by 1',
      }),
    ).toHaveAttribute('aria-disabled', 'true')
  })

  test('keep a numeric keyboard for a count and a decimal one for a load, in a group named for the set', async () => {
    open()
    await sheet()
    const group = screen.getByRole('group', { name: 'Back squat, set 1, load' })
    expect(within(group).getAllByRole('button')).toHaveLength(2)
    expect(field('Back squat', 1, 'load')).toHaveAttribute('inputmode', 'decimal')
    expect(field('Back squat', 1, 'reps')).toHaveAttribute('inputmode', 'numeric')
  })
})

describe('"As suggested" and the reps-left scale', () => {
  test('"As suggested" fills every set with the load, the target and the lowest reps left of the range', async () => {
    open()
    await sheet()
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'As suggested' }))
    expect(repsLeft('Back squat')).toEqual([1, 1, 1, 1])
    // the easy template asks for the same count in every set: 2 to 2 is two
    expect(repsLeft('Dumbbell Romanian deadlift')).toEqual([2, 2, 2])
    expect(repsLeft('Standing calf raise')).toEqual([1, 1, 1])
    // a jump and a hold have no effort target and no scale
    expect(region('Side plank').queryByRole('group', { name: /reps left$/ })).toBeNull()
    expect(region('Pogo hops').queryByRole('group', { name: /reps left$/ })).toBeNull()
  })

  test('"As suggested" also takes back the changes: the suggested sets, loads and counts', async () => {
    open()
    await sheet()
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Add a set: Back squat' }))
    await user.click(
      screen.getByRole('button', { name: 'Remove: Dumbbell Romanian deadlift, set 1' }),
    )
    await user.click(
      within(screen.getByRole('group', { name: 'Back squat, set 1, load' })).getByRole('button', {
        name: 'Raise the load by one step',
      }),
    )
    expect(values('Back squat', 'load')).toHaveLength(5)
    await user.click(screen.getByRole('button', { name: 'As suggested' }))
    expect(values('Back squat', 'load')).toEqual(['110', '110', '110', '110'])
    expect(values('Dumbbell Romanian deadlift', 'load')).toEqual(['40', '40', '40'])
  })

  test('one set takes a value, and tapping the chosen value clears it', async () => {
    open()
    await sheet()
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Back squat, set 2, reps left 3' }))
    expect(repsLeft('Back squat')).toEqual([null, 3, null, null])
    await user.click(screen.getByRole('button', { name: 'Back squat, set 2, reps left 3' }))
    expect(repsLeft('Back squat')).toEqual([null, null, null, null])
  })

  test('"All sets" sets one value for the lift and clears it; it shows a value only when the sets agree', async () => {
    open()
    await sheet()
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'All sets, Back squat, reps left 2' }))
    expect(repsLeft('Back squat')).toEqual([2, 2, 2, 2])
    expect(repsLeft('Dumbbell Romanian deadlift')).toEqual([null, null, null])
    const all = screen.getByRole('button', { name: 'All sets, Back squat, reps left 2' })
    expect(all).toHaveAttribute('aria-pressed', 'true')
    await user.click(screen.getByRole('button', { name: 'Back squat, set 3, reps left 4' }))
    expect(
      screen.getByRole('button', { name: 'All sets, Back squat, reps left 2' }),
    ).toHaveAttribute('aria-pressed', 'false')
    await user.click(screen.getByRole('button', { name: 'All sets, Back squat, reps left 5' }))
    expect(repsLeft('Back squat')).toEqual([5, 5, 5, 5])
    await user.click(screen.getByRole('button', { name: 'All sets, Back squat, reps left 5' }))
    expect(repsLeft('Back squat')).toEqual([null, null, null, null])
  })

  test('says what the top of the scale means, once', async () => {
    open()
    const dialog = await sheet()
    expect(
      within(dialog).getByText(
        /Reps left in reserve: 5 means 5 or more\. Tap a value again to clear it\./,
      ),
    ).toBeVisible()
  })
})

describe('"Same as last time"', () => {
  test('copies the load and the count of the last session of each lift, and leaves the reps left unset', async () => {
    open()
    await sheet()
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'As suggested' }))
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Same as last time' })).toBeEnabled()
    })
    await user.click(screen.getByRole('button', { name: 'Same as last time' }))
    // the last squat session: 105 lb for 5, 5 and 4 reps; the deadlift: 35 lb for 6 and 6
    expect(values('Back squat', 'load')).toEqual(['105', '105', '105'])
    expect(values('Back squat', 'reps')).toEqual(['5', '5', '4'])
    expect(repsLeft('Back squat')).toEqual([null, null, null])
    expect(values('Dumbbell Romanian deadlift', 'load')).toEqual(['35', '35'])
    expect(values('Dumbbell Romanian deadlift', 'reps')).toEqual(['6', '6'])
    // a lift that was never logged stays as suggested
    expect(values('Standing calf raise', 'reps')).toEqual(['12', '12', '12'])
    expect(repsLeft('Standing calf raise')).toEqual([1, 1, 1])
  })

  test('has a button of its own on each lift that was logged, and no more', async () => {
    open()
    await sheet()
    const user = userEvent.setup()
    const own = await screen.findByRole('button', {
      name: 'Same as last time: Dumbbell Romanian deadlift',
    })
    await user.click(own)
    expect(values('Dumbbell Romanian deadlift', 'load')).toEqual(['35', '35'])
    expect(values('Back squat', 'load')).toEqual(['110', '110', '110', '110'])
    expect(
      screen.queryByRole('button', { name: 'Same as last time: Standing calf raise' }),
    ).toBeNull()
  })

  test('sends the same grams as the last session, whichever unit it was logged in', async () => {
    const view = makeView()
    const logged = view.recent[0]
    expect(logged).toBeDefined()
    const inKilograms = {
      ...view,
      recent: [
        {
          ...view.recent[0]!,
          sets: [{ exerciseId: 'back-squat', position: 0, loadG: 20000, count: 5, rir: null }],
        },
      ],
    }
    const { calls } = open({
      view: inKilograms,
      routes: { [`PUT ${LOG_URL}`]: () => savedLog(LOG_ID) },
    })
    await sheet()
    const user = userEvent.setup()
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Same as last time' })).toBeEnabled()
    })
    await user.click(screen.getByRole('button', { name: 'Same as last time' }))
    // 20 kg is 44.09 lb: it shows as 44, and goes out as the 20 000 g it is
    expect(values('Back squat', 'load')).toEqual(['44'])
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => {
      expect(calls.some((call) => call.method === 'PUT')).toBe(true)
    })
    expect(putBody(calls).sets[0]?.loadG).toBe(20000)
  })

  test('is off with nothing logged, and the sheet says what needs a connection when the page view fails', async () => {
    open({ view: makeView({ recent: [] }) })
    await sheet()
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Same as last time' })).toBeDisabled()
    })
    expect(screen.queryByText('Same as last time and Swap need a connection.')).toBeNull()
  })

  test('is off, with a note, when the page view cannot be read; the sheet still works', async () => {
    open({ view: null })
    const dialog = await sheet()
    expect(
      await within(dialog).findByText('Same as last time and Swap need a connection.'),
    ).toBeVisible()
    expect(screen.getByRole('button', { name: 'Same as last time' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Swap: Back squat' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'As suggested' })).toBeEnabled()
    expectCleanCopy(dialog)
  })
})

describe('"Same as last time" and the implement (design 6.5)', () => {
  /** The sheet with the page view read, so the buttons have settled. */
  async function opened(options: Options) {
    const rig = open(options)
    await sheet()
    await waitFor(() => {
      expect(rig.calls.some((call) => call.url === '/api/strength')).toBe(true)
    })
    await new Promise((resolve) => setTimeout(resolve, 0))
    return rig
  }

  test('does not copy a session on another implement: a calf machine is not the floor', async () => {
    const view = makeView({
      recent: [
        makeLog(
          'machine',
          '2026-03-12',
          [set('standing-calf-raise', 0, 80, 12)],
          [snapLift('standing-calf-raise', 'calf-machine', 80)],
        ),
      ],
    })
    await opened({ workout: makeWorkout({ lifts: [calf()], plyo: null, trunk: [] }), view })
    expect(
      screen.queryByRole('button', { name: 'Same as last time: Standing calf raise' }),
    ).toBeNull()
    expect(screen.getByRole('button', { name: 'Same as last time' })).toBeDisabled()
    expect(values('Standing calf raise', 'reps')).toEqual(['12', '12', '12'])
  })

  test('copies the counts and no hidden load into a lift that has no load field', async () => {
    const view = makeView({
      recent: [
        makeLog('floor', '2026-03-12', [
          set('standing-calf-raise', 0, 80, 14),
          set('standing-calf-raise', 1, 80, 13),
        ]),
      ],
    })
    const { calls } = await opened({
      workout: makeWorkout({ lifts: [calf()], plyo: null, trunk: [] }),
      view,
      routes: { [`PUT ${LOG_URL}`]: () => savedLog(LOG_ID) },
    })
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Same as last time' }))
    expect(values('Standing calf raise', 'reps')).toEqual(['14', '13'])
    expect(region('Standing calf raise').queryByRole('group', { name: /load$/ })).toBeNull()
    expect(region('Standing calf raise').queryByRole('textbox', { name: /load$/ })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => {
      expect(calls.some((call) => call.url === LOG_URL)).toBe(true)
    })
    expect(putBody(calls).sets.map((s) => [s.count, s.loadG])).toEqual([
      [14, null],
      [13, null],
    ])
  })

  test('copies the session in the implement the lift is shown with, the older one when a newer is another', async () => {
    const view = makeView({
      recent: [
        makeLog(
          'kettle',
          '2026-03-12',
          [set('goblet-squat', 0, 35, 8)],
          [snapLift('goblet-squat', 'kettlebells', 35)],
        ),
        makeLog(
          'dumbbell',
          '2026-03-05',
          [set('goblet-squat', 0, 25, 8)],
          [snapLift('goblet-squat', 'dumbbells', 25)],
        ),
      ],
    })
    const goblet = squat({
      exerciseId: 'goblet-squat',
      implement: 'dumbbells',
      steps: { loadsG: [10, 15, 20, 25, 30, 35].map(lb) },
      loadG: lb(20),
    })
    await opened({ workout: makeWorkout({ lifts: [goblet], plyo: null, trunk: [] }), view })
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Same as last time: Goblet squat' }))
    expect(values('Goblet squat', 'load')).toEqual(['25'])
  })
})

describe('adding and removing sets', () => {
  test('"Add a set" copies the last set without its reps left, and "Remove" renumbers the rest', async () => {
    open()
    await sheet()
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'As suggested' }))
    await user.click(screen.getByRole('button', { name: 'Add a set: Back squat' }))
    expect(values('Back squat', 'reps')).toEqual(['5', '5', '4', '4', '4'])
    expect(repsLeft('Back squat')).toEqual([1, 1, 1, 1, null])
    await user.click(screen.getByRole('button', { name: 'Remove: Back squat, set 1' }))
    expect(values('Back squat', 'reps')).toEqual(['5', '4', '4', '4'])
    expect(field('Back squat', 4, 'reps')).toHaveValue('4')
  })

  test('a lift left with no sets says so, and takes one back', async () => {
    open({
      workout: makeWorkout({ lifts: [squat({ sets: 1, targets: [5] })], plyo: null, trunk: [] }),
    })
    await sheet()
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Remove: Back squat, set 1' }))
    expect(region('Back squat').getByText('No sets for this exercise yet.')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Add a set: Back squat' }))
    expect(values('Back squat', 'load')).toEqual(['110'])
    expect(values('Back squat', 'reps')).toEqual(['5'])
  })

  test('stops adding at the most sets a log holds', async () => {
    open({
      workout: makeWorkout({ lifts: [squat({ sets: 80, targets: [5] })], plyo: null, trunk: [] }),
    })
    await sheet()
    expect(screen.getByRole('button', { name: 'Add a set: Back squat' })).toBeDisabled()
  })
})

describe('"Swap" and "Always use this"', () => {
  test('lists the exercises the equipment makes for the slot, and swaps one for the session', async () => {
    const { calls } = open({
      routes: {
        'PUT /api/strength/settings': ({ body }) => ({ ...STRENGTH_SETTINGS, ...(body as object) }),
        [`PUT ${LOG_URL}`]: () => savedLog(LOG_ID),
      },
    })
    await sheet()
    const user = userEvent.setup()
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Swap: Back squat' })).toBeEnabled()
    })
    await user.click(screen.getByRole('button', { name: 'Swap: Back squat' }))
    const choices = within(screen.getByRole('group', { name: 'Swap Back squat for' }))
    // a bar, dumbbells, bands and a step: no leg press, and the harder movements are on the list
    expect(choices.getAllByRole('button').map((button) => button.textContent)).toEqual([
      'Goblet squat',
      'Tempo squat',
      'Split squat',
      'Step-up',
      'Single-leg box squat',
    ])
    await user.click(choices.getByRole('button', { name: 'Goblet squat' }))

    // it takes the place of the squat as the first session of the exercise: the ramp-in sets and
    // counts, starting at the lightest dumbbell, and no explanation until the server reads one
    expect(screen.queryByRole('region', { name: 'Back squat' })).toBeNull()
    expect(values('Goblet squat', 'load')).toEqual(Array(FIRST.sets).fill('10'))
    expect(values('Goblet squat', 'reps')).toEqual(Array(FIRST.sets).fill(COUNT))
    expect(FIRST.sets).not.toBe(squat().sets)
    expect(
      region('Goblet squat').getByText(
        new RegExp(`^Suggested 10 lb, .* of ${COUNT} to ${String(FIRST.range.max)} reps, leave`),
      ),
    ).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Why: Goblet squat' })).toBeNull()
    expect(
      region('Goblet squat').getByText(
        'Goblet squat was swapped in for this session, so it starts at the lightest load the equipment makes.',
      ),
    ).toBeVisible()

    // "Always use this" writes the choice to the pinned exercises of the slot
    await user.click(screen.getByRole('button', { name: 'Always use this: Goblet squat' }))
    await waitFor(() => {
      expect(
        calls.find((call) => call.method === 'PUT' && call.url === '/api/strength/settings')?.body,
      ).toEqual({
        pinned: { knee: 'goblet-squat' },
      })
    })

    // what is saved is the swapped lift, as the sheet showed it
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => {
      expect(calls.some((call) => call.url === LOG_URL)).toBe(true)
    })
    const body = putBody(calls)
    expect(body.sets.filter((set) => set.exerciseId === 'goblet-squat')).toHaveLength(FIRST.sets)
    expect(body.sets.some((set) => set.exerciseId === 'back-squat')).toBe(false)
    const shown = body.prescribed.lifts.find((lift) => lift.exerciseId === 'goblet-squat')
    expect(shown).toMatchObject({
      implement: 'dumbbells',
      sets: FIRST.sets,
      range: FIRST.range,
      rir: FIRST.rir,
      change: 'start',
      shownLoadG: lb(10),
      baseLoadG: lb(10),
    })
    expect(shown?.basis.facts[0]?.template).toBe('strength.sheet.swap-start')
  })

  test('keeps the choice already pinned, and swaps back to the suggestion', async () => {
    open({
      view: makeView({ settings: { ...STRENGTH_SETTINGS, pinned: { knee: 'goblet-squat' } } }),
    })
    await sheet()
    const user = userEvent.setup()
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Swap: Back squat' })).toBeEnabled()
    })
    await user.click(screen.getByRole('button', { name: 'Swap: Back squat' }))
    await user.click(
      within(screen.getByRole('group', { name: 'Swap Back squat for' })).getByRole('button', {
        name: 'Goblet squat',
      }),
    )
    expect(screen.getByText('This choice is kept for later sessions.')).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Always use this: Goblet squat' })).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Swap: Goblet squat' }))
    await user.click(screen.getByRole('button', { name: 'Back squat, as suggested' }))
    expect(values('Back squat', 'load')).toEqual(['110', '110', '110', '110'])
    expect(screen.queryByRole('region', { name: 'Goblet squat' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Why: Back squat' })).toBeVisible()
  })

  test('swaps to a bodyweight form with no load field and no added load', async () => {
    open()
    await sheet()
    const user = userEvent.setup()
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Swap: Back squat' })).toBeEnabled()
    })
    await user.click(screen.getByRole('button', { name: 'Swap: Back squat' }))
    await user.click(screen.getByRole('button', { name: 'Tempo squat' }))
    expect(region('Tempo squat').queryByRole('group', { name: /load$/ })).toBeNull()
    expect(
      region('Tempo squat').getByText(
        'Tempo squat was swapped in for this session, so it starts with no added load.',
      ),
    ).toBeVisible()
  })

  test('offers no swap for a jump or a trunk movement', async () => {
    open()
    await sheet()
    expect(screen.queryByRole('button', { name: 'Swap: Pogo hops' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Swap: Side plank' })).toBeNull()
  })

  test('says so when no other exercise fits the equipment', async () => {
    // with no equipment the calf slot has only the raise on the floor
    open({
      view: makeView({ settings: { ...STRENGTH_SETTINGS, equipment: [] } }),
      workout: makeWorkout({ lifts: [calf()], plyo: null, trunk: [] }),
    })
    await sheet()
    const user = userEvent.setup()
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Swap: Standing calf raise' })).toBeEnabled()
    })
    await user.click(screen.getByRole('button', { name: 'Swap: Standing calf raise' }))
    expect(screen.getByText('No other exercise fits the equipment in the setup.')).toBeVisible()
    expect(screen.queryByRole('group', { name: 'Swap Standing calf raise for' })).toBeNull()
  })
})

describe('what a load means, beside the field (design 5.2)', () => {
  const machine = { minG: lb(10), stepG: lb(10), maxG: lb(300) }
  const bells = { loadsG: [10, 20, 30, 40].map(lb) }
  const cases: Array<[string, WorkoutLift, string]> = [
    ['Back squat', squat(), 'Total, including the bar'],
    [
      'Goblet squat',
      squat({ exerciseId: 'goblet-squat', implement: 'dumbbells', steps: bells, loadG: lb(20) }),
      'Weight of one dumbbell or kettlebell',
    ],
    [
      'Goblet squat',
      squat({ exerciseId: 'goblet-squat', implement: 'kettlebells', steps: bells, loadG: lb(20) }),
      'Weight of one dumbbell or kettlebell',
    ],
    [
      'Leg press',
      squat({ exerciseId: 'leg-press', implement: 'leg-press', steps: machine, loadG: lb(100) }),
      'Stack or plate total',
    ],
    [
      'Standing calf raise',
      calf({ implement: 'calf-machine', steps: machine, loadG: lb(70) }),
      'Stack or plate total',
    ],
    [
      'Leg curl',
      rdl({ exerciseId: 'leg-curl', implement: 'leg-curl', steps: machine, loadG: lb(50) }),
      'Stack or plate total',
    ],
    [
      'Single-leg calf raise',
      calf({
        exerciseId: 'single-leg-calf-raise',
        implement: 'dumbbells',
        steps: bells,
        loadG: null,
      }),
      'Added weight',
    ],
  ]

  test.each(cases)(
    '%s shows "%s" under its suggestion and as the description of its field',
    async (name, lift, text) => {
      open({ workout: makeWorkout({ lifts: [lift], plyo: null, trunk: [] }) })
      await sheet()
      const line = region(name).getByText(text)
      expect(line).toBeVisible()
      expect(field(name, 1, 'load').getAttribute('aria-describedby')).toContain(line.id)
      // one line a lift, not one a set
      expect(region(name).getAllByText(text)).toHaveLength(1)
    },
  )

  test('is not shown on the bodyweight path, where there is no load field', async () => {
    open({ workout: bodyweightWorkout() })
    const dialog = await sheet('Strength, ramp-in A')
    expect(
      within(dialog).queryByText(
        /Total, including the bar|Stack or plate total|Weight of one dumbbell or kettlebell|Added weight/,
      ),
    ).toBeNull()
  })

  test('is the meaning of the implement of a swapped lift, not of the lift it replaced', async () => {
    open()
    await sheet()
    const user = userEvent.setup()
    expect(region('Back squat').getByText('Total, including the bar')).toBeVisible()
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Swap: Back squat' })).toBeEnabled()
    })
    await user.click(screen.getByRole('button', { name: 'Swap: Back squat' }))
    await user.click(screen.getByRole('button', { name: 'Goblet squat' }))
    expect(region('Goblet squat').getByText('Weight of one dumbbell or kettlebell')).toBeVisible()
    expect(screen.queryAllByText('Total, including the bar')).toHaveLength(0)
    await user.click(screen.getByRole('button', { name: 'Swap: Goblet squat' }))
    await user.click(screen.getByRole('button', { name: 'Tempo squat' }))
    expect(region('Tempo squat').queryByText(/Weight of one|Total, including/)).toBeNull()
  })
})

describe('a lighter day', () => {
  test('says what changed, shows the usual load, and "Use the usual load" puts it back', async () => {
    const { calls } = open({
      workout: lighterDayWorkout(),
      routes: { [`PUT ${LOG_URL}`]: () => savedLog(LOG_ID) },
    })
    const dialog = await sheet()
    expect(
      within(dialog).getByText(
        'Lighter today: one set fewer and 10% less. The usual load is one tap away.',
      ),
    ).toBeVisible()
    expect(values('Back squat', 'load')).toEqual(['100', '100', '100'])
    expect(region('Back squat').getByText('Usual load: 110 lb.')).toBeVisible()
    // a lift that did not lighten has no such control
    expect(
      screen.queryByRole('button', { name: 'Use the usual load: Dumbbell Romanian deadlift' }),
    ).toBeNull()

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Use the usual load: Back squat' }))
    expect(values('Back squat', 'load')).toEqual(['110', '110', '110'])
    expect(values('Back squat', 'reps')).toEqual(['5', '5', '4'])
    expectCleanCopy(dialog)

    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => {
      expect(calls.some((call) => call.url === LOG_URL)).toBe(true)
    })
    const body = putBody(calls)
    expect(body.prescribed.mode).toBe('lighter-day')
    expect(body.prescribed.lifts[0]).toMatchObject({
      exerciseId: 'back-squat',
      change: 'lighter-day',
      shownLoadG: lb(100),
      baseLoadG: lb(110),
    })
    expect(body.sets.slice(0, 3).map((set) => set.loadG)).toEqual([lb(110), lb(110), lb(110)])
  })
})

describe('"Why"', () => {
  test('opens the drawer on the lift of the session, with its rule', async () => {
    open()
    await sheet()
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Why: Back squat' }))
    const drawer = screen.getByRole('complementary', { name: 'Why drawer' })
    expect(explainOf(drawer)).toEqual({
      subject: 'strength',
      id: SESSION_ID,
      exercise: 'back-squat',
    })
    expect(drawer).toHaveTextContent('F8')
  })
})

describe('the footer', () => {
  test('takes the minutes, the effort, and under "More details" the pain and a note', async () => {
    const { calls } = open({ routes: { [`PUT ${LOG_URL}`]: () => savedLog(LOG_ID) } })
    await sheet()
    const user = userEvent.setup()
    expect(screen.queryByRole('group', { name: 'Pain' })).toBeNull()
    await user.clear(screen.getByRole('textbox', { name: 'Minutes' }))
    await user.type(screen.getByRole('textbox', { name: 'Minutes' }), '55')
    await user.click(screen.getByRole('button', { name: 'Effort 7' }))
    await user.click(screen.getByRole('button', { name: 'More details' }))
    await user.click(screen.getByRole('button', { name: 'Pain 2' }))
    await user.type(screen.getByRole('textbox', { name: 'Note' }), 'Left knee felt tight.')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => {
      expect(calls.some((call) => call.url === LOG_URL)).toBe(true)
    })
    expect(putBody(calls)).toMatchObject({
      durationMin: 55,
      rpe: 7,
      pain: 2,
      notes: 'Left knee felt tight.',
    })
  })

  test('leaves the effort, the pain and the note out when they are empty, so an import keeps its own', async () => {
    const { calls } = open({
      activityId: 'imported-1',
      routes: { [`PUT ${LOG_URL}`]: () => savedLog(LOG_ID) },
    })
    await sheet()
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => {
      expect(calls.some((call) => call.url === LOG_URL)).toBe(true)
    })
    const body = putBody(calls)
    expect(body).not.toHaveProperty('rpe')
    expect(body).not.toHaveProperty('pain')
    expect(body).not.toHaveProperty('notes')
    expect(body.activityId).toBe('imported-1')
    // attaching to an activity that exists makes no new activity
    expect(screen.queryByRole('button', { name: 'Save without sets' })).toBeNull()
  })
})

describe('saving', () => {
  const NEXT: StrengthNextLoad[] = [
    { exerciseId: 'dumbbell-rdl', change: 'hold', loadG: lb(40) },
    { exerciseId: 'back-squat', change: 'increase', loadG: lb(115) },
    { exerciseId: 'standing-calf-raise', change: 'start', loadG: null },
  ]

  test('sends the session under the id of the sheet, with the sets, the snapshot and the link', async () => {
    const { calls, onSaved } = open({
      routes: { [`PUT ${LOG_URL}`]: () => savedLog(LOG_ID, NEXT) },
    })
    await sheet()
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'As suggested' }))
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => {
      expect(onSaved).toHaveBeenCalledTimes(1)
    })
    const body = putBody(calls)
    expect(calls.filter((call) => call.method === 'PUT').map((call) => call.url)).toEqual([LOG_URL])
    expect(body).toMatchObject({ date: DAY, sessionId: SESSION_ID, durationMin: 40 })
    // lifts, then the jump, then the trunk movement, each set in order; the suggested loads exactly
    expect(body.sets.map((set) => [set.exerciseId, set.loadG, set.count, set.rir])).toEqual([
      ['back-squat', lb(110), 5, 1],
      ['back-squat', lb(110), 5, 1],
      ['back-squat', lb(110), 4, 1],
      ['back-squat', lb(110), 4, 1],
      ['dumbbell-rdl', lb(40), 6, 2],
      ['dumbbell-rdl', lb(40), 6, 2],
      ['dumbbell-rdl', lb(40), 6, 2],
      ['standing-calf-raise', null, 12, 1],
      ['standing-calf-raise', null, 12, 1],
      ['standing-calf-raise', null, 12, 1],
      ['pogo-hop', null, 40, null],
      ['side-plank', null, 30, null],
      ['side-plank', null, 30, null],
    ])
    expect(onSaved).toHaveBeenCalledWith({ status: 'sent', next: NEXT })
  })

  test('writes the snapshot of what was shown: the template, the week, the mode and the lifts, jumps left out', async () => {
    const { calls } = open({ routes: { [`PUT ${LOG_URL}`]: () => savedLog(LOG_ID) } })
    await sheet()
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => {
      expect(calls.some((call) => call.url === LOG_URL)).toBe(true)
    })
    const snapshot: StrengthSnapshot = putBody(calls).prescribed
    expect(snapshot).toMatchObject({ template: 'heavy', variant: 'A', week: 6, mode: 'normal' })
    expect(snapshot.lifts.map((lift) => lift.exerciseId)).toEqual([
      'back-squat',
      'dumbbell-rdl',
      'standing-calf-raise',
      'side-plank',
    ])
    expect(snapshot.lifts[0]).toEqual({
      exerciseId: 'back-squat',
      implement: 'barbell',
      sets: 4,
      range: { min: 3, max: 6 },
      rir: { min: 1, max: 3 },
      baseLoadG: lb(110),
      shownLoadG: lb(110),
      change: 'increase',
      basis: squat().basis,
    })
  })

  test('says it is saved, and for the lifts that move first, what they do next time', async () => {
    const { onSaved } = open({ routes: { [`PUT ${LOG_URL}`]: () => savedLog(LOG_ID, NEXT) } })
    await sheet()
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(
      await screen.findByText(
        'Strength log saved. Next time: Back squat up to 115 lb, Standing calf raise with no added load, Dumbbell Romanian deadlift stays at 40 lb.',
      ),
    ).toBeVisible()
    expect(onSaved).toHaveBeenCalledTimes(1)
  })

  test('says only that it is saved when the server sent no loads for next time', async () => {
    open({ routes: { [`PUT ${LOG_URL}`]: () => savedLog(LOG_ID, []) } })
    await sheet()
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('Strength log saved.')).toBeVisible()
  })

  test('kept on the phone with no connection, it says so in the words of the outbox', async () => {
    const { onSaved } = open({ routes: { [`PUT ${LOG_URL}`]: () => unreachable } })
    await sheet()
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(
      await screen.findByText(
        'Strength log saved on this phone. It is sent when a connection returns.',
      ),
    ).toBeVisible()
    expect(onSaved).toHaveBeenCalledWith({ status: 'queued', next: [] })
    expect(
      getOutbox()
        .getState()
        .entries.map((entry) => entry.url),
    ).toEqual([LOG_URL])
  })

  test('shows the words of a refusal in the sheet, keeps what was entered and does not close', async () => {
    const { onSaved } = open({
      routes: {
        [`PUT ${LOG_URL}`]: () => ({
          status: 409,
          body: { error: { code: 'conflict', message: 'That activity already has a log.' } },
        }),
      },
    })
    const dialog = await sheet()
    const user = userEvent.setup()
    await user.click(
      within(screen.getByRole('group', { name: 'Back squat, set 1, load' })).getByRole('button', {
        name: 'Raise the load by one step',
      }),
    )
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'Strength log not saved. That activity already has a log. The sets stay on this phone. Try again.',
    )
    expect(onSaved).not.toHaveBeenCalled()
    expect(values('Back squat', 'load')[0]).toBe('115')
    expect(getOutbox().getState().entries).toEqual([])
    expect(window.localStorage.getItem(`${STRENGTH_DRAFT_PREFIX}${LOG_ID}`)).not.toBeNull()
    expectCleanCopy(dialog)
  })

  test('marks a count or a load it cannot read, says so, and sends nothing', async () => {
    const { calls } = open()
    const dialog = await sheet()
    const user = userEvent.setup()
    await user.clear(field('Back squat', 2, 'reps'))
    await user.clear(field('Back squat', 3, 'load'))
    await user.type(field('Back squat', 3, 'load'), 'heavy')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'Check the marked sets: a load is a number, and a count is a whole number of one or more.',
    )
    expect(field('Back squat', 2, 'reps')).toHaveAttribute('aria-invalid', 'true')
    expect(field('Back squat', 3, 'load')).toHaveAttribute('aria-invalid', 'true')
    expect(field('Back squat', 2, 'reps')).toHaveFocus()
    expect(calls.some((call) => call.method === 'PUT')).toBe(false)
    expectCleanCopy(dialog)
  })

  test('asks for whole minutes, and for at least one set', async () => {
    const { calls } = open({
      workout: makeWorkout({ lifts: [squat({ sets: 1, targets: [5] })], plyo: null, trunk: [] }),
    })
    const dialog = await sheet()
    const user = userEvent.setup()
    await user.clear(screen.getByRole('textbox', { name: 'Minutes' }))
    await user.type(screen.getByRole('textbox', { name: 'Minutes' }), '0')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(within(dialog).getByText('Enter whole minutes from 1 to 300.')).toBeVisible()
    expect(screen.getByRole('textbox', { name: 'Minutes' })).toHaveAttribute('aria-invalid', 'true')

    await user.clear(screen.getByRole('textbox', { name: 'Minutes' }))
    await user.type(screen.getByRole('textbox', { name: 'Minutes' }), '30')
    await user.click(screen.getByRole('button', { name: 'Remove: Back squat, set 1' }))
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'Add at least one set before saving.',
    )
    expect(calls.some((call) => call.method === 'PUT')).toBe(false)
    expectCleanCopy(dialog)
  })

  test('sends a typed load as the grams it means and a suggested one as the very gram it is', async () => {
    const { calls } = open({
      workout: makeWorkout({ lifts: [squat()], plyo: null, trunk: [] }),
      routes: { [`PUT ${LOG_URL}`]: () => savedLog(LOG_ID) },
    })
    await sheet()
    const user = userEvent.setup()
    await user.clear(field('Back squat', 2, 'load'))
    await user.type(field('Back squat', 2, 'load'), '112.5')
    await user.clear(field('Back squat', 4, 'load'))
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => {
      expect(calls.some((call) => call.url === LOG_URL)).toBe(true)
    })
    expect(putBody(calls).sets.map((set) => set.loadG)).toEqual([
      lb(110),
      toGrams(112.5, 'lb'),
      lb(110),
      null,
    ])
  })

  test('sends a load typed in kilograms as grams', async () => {
    const { calls } = open({
      settings: { ...SETTINGS, weightUnit: 'kg', units: 'km' },
      workout: makeWorkout({ lifts: [squat({ sets: 1, targets: [5] })], plyo: null, trunk: [] }),
      routes: { [`PUT ${LOG_URL}`]: () => savedLog(LOG_ID) },
    })
    await sheet()
    const user = userEvent.setup()
    await user.clear(field('Back squat', 1, 'load'))
    await user.type(field('Back squat', 1, 'load'), '62.5')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => {
      expect(calls.some((call) => call.url === LOG_URL)).toBe(true)
    })
    expect(putBody(calls).sets[0]?.loadG).toBe(62500)
  })

  test('links no session when the caller passes none, and the workout session when it passes nothing', async () => {
    const off = open({
      sessionId: null,
      routes: { [`PUT ${LOG_URL}`]: () => savedLog(LOG_ID) },
    })
    await sheet()
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => {
      expect(off.calls.some((call) => call.url === LOG_URL)).toBe(true)
    })
    expect(putBody(off.calls)).not.toHaveProperty('sessionId')
  })
})

describe('"Save without sets"', () => {
  test('records the minutes and the effort as the Done sheet does', async () => {
    const { calls, onSaved } = open({
      routes: { 'POST /api/activities': () => savedLog(LOG_ID).activity },
    })
    await sheet()
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Effort 6' }))
    await user.click(screen.getByRole('button', { name: 'Save without sets' }))
    await waitFor(() => {
      expect(onSaved).toHaveBeenCalledTimes(1)
    })
    expect(calls.find((call) => call.method === 'POST')?.body).toEqual({
      date: DAY,
      type: 'strength',
      durationSec: 2400,
      rpe: 6,
    })
    expect(calls.some((call) => call.url.startsWith('/api/strength/logs/'))).toBe(false)
    expect(onSaved).toHaveBeenCalledWith({ status: 'without-sets', next: [] })
    expect(await screen.findByText('Session saved')).toBeVisible()
  })

  test('is off with no connection, where Save still keeps the sets on the phone', async () => {
    vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false)
    const { calls } = open({ routes: { [`PUT ${LOG_URL}`]: () => unreachable } })
    const dialog = await sheet()
    expect(screen.getByRole('button', { name: 'Save without sets' })).toBeDisabled()
    expect(within(dialog).getByText('Save without sets needs a connection.')).toBeVisible()
    expect(
      within(dialog).getByText(
        'No connection. Save keeps the sets on this phone and sends them when a connection returns.',
      ),
    ).toBeVisible()
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled()
    expectCleanCopy(dialog)
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => {
      expect(getOutbox().getState().entries).toHaveLength(1)
    })
    expect(calls.some((call) => call.method === 'POST')).toBe(false)
  })

  test('asks for whole minutes first', async () => {
    const { calls } = open()
    await sheet()
    const user = userEvent.setup()
    await user.clear(screen.getByRole('textbox', { name: 'Minutes' }))
    await user.click(screen.getByRole('button', { name: 'Save without sets' }))
    expect(screen.getByText('Enter whole minutes from 1 to 300.')).toBeVisible()
    expect(calls.some((call) => call.method === 'POST')).toBe(false)
  })
})

describe('the bar: a session logged as suggested takes at most 3 interactions (design 1.4)', () => {
  test('open, "As suggested", Save', async () => {
    const { calls, onSaved } = open({
      routes: { [`PUT ${LOG_URL}`]: () => savedLog(LOG_ID) },
    })
    await sheet()
    // the first interaction is the tap that opened the sheet (the caller's)
    let interactions = 1
    const user = userEvent.setup()
    const tap = async (name: string) => {
      interactions += 1
      await user.click(screen.getByRole('button', { name }))
    }
    await tap('As suggested')
    await tap('Save')
    await waitFor(() => {
      expect(onSaved).toHaveBeenCalledTimes(1)
    })
    expect(interactions).toBe(3)
    // and it is the whole session: every lift, at the suggested load and the lowest reps left
    const body = putBody(calls)
    expect(body.sets).toHaveLength(13)
    expect(body.sets.slice(0, 4).every((set) => set.rir === 1)).toBe(true)
  })

  test('at most 12 with two changed sets and one reps-left value for each lift', async () => {
    const { calls, onSaved } = open({
      routes: { [`PUT ${LOG_URL}`]: () => savedLog(LOG_ID) },
    })
    await sheet()
    let interactions = 1
    const user = userEvent.setup()
    const tap = async (name: string, group?: HTMLElement) => {
      interactions += 1
      const scope = group === undefined ? screen : within(group)
      await user.click(scope.getByRole('button', { name }))
    }
    await tap('As suggested')
    // two changed sets: a heavier second squat set, and one more rep in the third deadlift set
    await tap(
      'Raise the load by one step',
      screen.getByRole('group', { name: 'Back squat, set 2, load' }),
    )
    await tap(
      'Raise the reps by 1',
      screen.getByRole('group', { name: 'Dumbbell Romanian deadlift, set 3, reps' }),
    )
    // one reps-left value for each of the three lifts
    await tap('All sets, Back squat, reps left 2')
    await tap('All sets, Dumbbell Romanian deadlift, reps left 3')
    await tap('All sets, Standing calf raise, reps left 2')
    await tap('Save')
    await waitFor(() => {
      expect(onSaved).toHaveBeenCalledTimes(1)
    })
    expect(interactions).toBeLessThanOrEqual(12)
    expect(interactions).toBe(8)
    const body = putBody(calls)
    expect(body.sets[1]?.loadG).toBe(lb(115))
    expect(body.sets[6]?.count).toBe(7)
    expect(body.sets.slice(0, 4).map((set) => set.rir)).toEqual([2, 2, 2, 2])
  })
})

describe('the draft', () => {
  const draftKey = `${STRENGTH_DRAFT_PREFIX}${LOG_ID}`

  test('is not written until something changes, then is kept under strength-draft:<log id> on every change', async () => {
    open()
    await sheet()
    expect(window.localStorage.getItem(draftKey)).toBeNull()
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'As suggested' }))
    const first = JSON.parse(window.localStorage.getItem(draftKey) ?? 'null') as {
      logId: string
      sessionId: string
      date: string
    }
    expect(first).toMatchObject({ logId: LOG_ID, sessionId: SESSION_ID, date: DAY })
    await user.type(screen.getByRole('textbox', { name: 'Minutes' }), '5')
    const second = JSON.parse(window.localStorage.getItem(draftKey) ?? 'null') as {
      minutes: string
    }
    expect(second.minutes).toBe('405')
    // one draft, whatever the number of changes
    expect(
      Object.keys(window.localStorage).filter((key) => key.startsWith(STRENGTH_DRAFT_PREFIX)),
    ).toEqual([draftKey])
  })

  test('survives a remount: the sets, the swap, the footer and the id of the save', async () => {
    const first = open()
    await sheet()
    const user = userEvent.setup()
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Swap: Back squat' })).toBeEnabled()
    })
    await user.click(screen.getByRole('button', { name: 'Swap: Back squat' }))
    await user.click(screen.getByRole('button', { name: 'Goblet squat' }))
    await user.click(
      within(screen.getByRole('group', { name: 'Goblet squat, set 2, load' })).getByRole('button', {
        name: 'Raise the load by one step',
      }),
    )
    await user.click(screen.getByRole('button', { name: 'Goblet squat, set 1, reps left 3' }))
    await user.clear(field('Dumbbell Romanian deadlift', 1, 'load'))
    await user.type(field('Dumbbell Romanian deadlift', 1, 'load'), '37')
    await user.click(screen.getByRole('button', { name: 'Effort 8' }))
    expect(first.onClose).not.toHaveBeenCalled()

    // A reload: the page is gone and opens the sheet again, which would choose another id.
    cleanup()
    vi.stubGlobal('crypto', { randomUUID: () => 'ffffffff-0000-4000-8000-000000000000' })
    const second = open({ routes: { [`PUT ${LOG_URL}`]: () => savedLog(LOG_ID) } })
    await sheet()
    expect(values('Goblet squat', 'load')).toEqual(
      Array.from({ length: FIRST.sets }, (_, i) => (i === 1 ? '15' : '10')),
    )
    expect(repsLeft('Goblet squat')).toEqual(
      Array.from({ length: FIRST.sets }, (_, i) => (i === 0 ? 3 : null)),
    )
    expect(values('Dumbbell Romanian deadlift', 'load')).toEqual(['37', '40', '40'])
    expect(screen.getByRole('button', { name: 'Effort 8' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByRole('region', { name: 'Back squat' })).toBeNull()

    // and the save it was kept for is the same save: the same id, so a replay changes nothing
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => {
      expect(second.onSaved).toHaveBeenCalledTimes(1)
    })
    const puts = second.calls.filter((call) => call.method === 'PUT')
    expect(puts.map((call) => call.url)).toEqual([LOG_URL])
    expect((puts[0]?.body as StrengthLogBody).sets[1]).toMatchObject({
      exerciseId: 'goblet-squat',
      loadG: lb(15),
    })
  })

  test('is not applied to another session, another day or another activity, and junk in storage is ignored', async () => {
    const kept = (over: object) =>
      JSON.stringify({
        logId: LOG_ID,
        sessionId: SESSION_ID,
        date: DAY,
        activityId: null,
        at: 1,
        weightUnit: 'lb',
        minutes: '99',
        effort: null,
        pain: null,
        notes: '',
        blocks: [],
        ...over,
      })
    window.localStorage.setItem(`${STRENGTH_DRAFT_PREFIX}${LOG_ID}`, kept({ sessionId: 'other' }))
    window.localStorage.setItem(
      `${STRENGTH_DRAFT_PREFIX}0a1b2c3d-1111-4222-8333-444455556666`,
      kept({ logId: '0a1b2c3d-1111-4222-8333-444455556666', date: '2026-03-17' }),
    )
    window.localStorage.setItem(
      `${STRENGTH_DRAFT_PREFIX}0a1b2c3d-2222-4222-8333-444455556666`,
      kept({ logId: '0a1b2c3d-2222-4222-8333-444455556666', activityId: 'a-1' }),
    )
    window.localStorage.setItem(
      `${STRENGTH_DRAFT_PREFIX}0a1b2c3d-3333-4222-8333-444455556666`,
      '{nonsense',
    )
    window.localStorage.setItem(
      `${STRENGTH_DRAFT_PREFIX}0a1b2c3d-4444-4222-8333-444455556666`,
      kept({
        logId: '0a1b2c3d-4444-4222-8333-444455556666',
        blocks: [{ key: 'back-squat', swapped: { exerciseId: 'nothing' }, rows: [] }],
      }),
    )
    open()
    await sheet()
    expect(screen.getByRole('textbox', { name: 'Minutes' })).toHaveValue('40')
    expect(values('Back squat', 'load')).toEqual(['110', '110', '110', '110'])
  })

  test('puts back the newest draft of the session when there are two', async () => {
    const kept = (logId: string, at: number, minutes: string) =>
      JSON.stringify({
        logId,
        sessionId: SESSION_ID,
        date: DAY,
        activityId: null,
        at,
        weightUnit: 'lb',
        minutes,
        effort: null,
        pain: null,
        notes: '',
        blocks: [],
      })
    window.localStorage.setItem(
      `${STRENGTH_DRAFT_PREFIX}0a1b2c3d-1111-4222-8333-444455556666`,
      kept('0a1b2c3d-1111-4222-8333-444455556666', 10, '35'),
    )
    window.localStorage.setItem(
      `${STRENGTH_DRAFT_PREFIX}0a1b2c3d-2222-4222-8333-444455556666`,
      kept('0a1b2c3d-2222-4222-8333-444455556666', 20, '50'),
    )
    open()
    await sheet()
    expect(screen.getByRole('textbox', { name: 'Minutes' })).toHaveValue('50')
  })

  test('puts the same grams back when the weight unit changed in between', async () => {
    open()
    await sheet()
    const user = userEvent.setup()
    await user.click(
      within(screen.getByRole('group', { name: 'Back squat, set 1, load' })).getByRole('button', {
        name: 'Raise the load by one step',
      }),
    )
    await user.clear(field('Back squat', 2, 'load'))
    await user.type(field('Back squat', 2, 'load'), '135')
    expect(JSON.parse(window.localStorage.getItem(draftKey) ?? '{}')).toMatchObject({
      weightUnit: 'lb',
    })

    // the runner switches to kilograms in Settings, and the sheet opens again
    cleanup()
    const second = open({
      settings: { ...SETTINGS, weightUnit: 'kg', units: 'km' },
      routes: { [`PUT ${LOG_URL}`]: () => savedLog(LOG_ID) },
    })
    await sheet()
    expect(values('Back squat', 'load')).toEqual([
      String(fromGrams(lb(115), 'kg')),
      String(fromGrams(toGrams(135, 'lb'), 'kg')),
      String(fromGrams(lb(110), 'kg')),
      String(fromGrams(lb(110), 'kg')),
    ])
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => {
      expect(second.onSaved).toHaveBeenCalledTimes(1)
    })
    // 115 lb stays 115 lb: it is not read again as 52 kg or as 115 kg
    expect(
      putBody(second.calls)
        .sets.slice(0, 4)
        .map((set) => set.loadG),
    ).toEqual([lb(115), toGrams(135, 'lb'), lb(110), lb(110)])
  })

  test('is cleared on save, so a sheet opened again starts from the workout', async () => {
    open({ routes: { [`PUT ${LOG_URL}`]: () => savedLog(LOG_ID) } })
    await sheet()
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'As suggested' }))
    expect(window.localStorage.getItem(draftKey)).not.toBeNull()
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => {
      expect(window.localStorage.getItem(draftKey)).toBeNull()
    })
  })

  test('is cleared by "Save without sets" too', async () => {
    open({ routes: { 'POST /api/activities': () => savedLog(LOG_ID).activity } })
    await sheet()
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Effort 5' }))
    expect(window.localStorage.getItem(draftKey)).not.toBeNull()
    await user.click(screen.getByRole('button', { name: 'Save without sets' }))
    await waitFor(() => {
      expect(window.localStorage.getItem(draftKey)).toBeNull()
    })
  })

  test('is kept when the sheet is closed with Escape', async () => {
    const { onClose } = open()
    await sheet()
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'As suggested' }))
    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(window.localStorage.getItem(draftKey)).not.toBeNull()
  })

  test('does not break the sheet when local storage is blocked', async () => {
    const blocked = () => {
      throw new DOMException('Blocked.', 'SecurityError')
    }
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(blocked)
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(blocked)
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(blocked)
    vi.spyOn(Storage.prototype, 'key').mockImplementation(blocked)
    const { calls, onSaved } = open({ routes: { [`PUT ${LOG_URL}`]: () => savedLog(LOG_ID) } })
    await sheet()
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'As suggested' }))
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => {
      expect(onSaved).toHaveBeenCalledTimes(1)
    })
    expect(calls.some((call) => call.url === LOG_URL)).toBe(true)
  })
})

describe('the copy', () => {
  test('passes the lint with every part of the sheet in view', async () => {
    open({
      routes: { 'PUT /api/strength/settings': () => STRENGTH_SETTINGS },
    })
    const dialog = await sheet()
    const user = userEvent.setup()
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Swap: Back squat' })).toBeEnabled()
    })
    expectCleanCopy(dialog)
    await user.click(screen.getByRole('button', { name: 'Swap: Back squat' }))
    expectCleanCopy(dialog)
    await user.click(screen.getByRole('button', { name: 'Goblet squat' }))
    expectCleanCopy(dialog)
    await user.click(screen.getByRole('button', { name: 'More details' }))
    await user.click(screen.getByRole('button', { name: 'As suggested' }))
    expectCleanCopy(dialog)
  })

  test('passes the lint for a runner in kilograms, on the bodyweight path and on a lighter day', async () => {
    open({
      settings: { ...SETTINGS, weightUnit: 'kg', units: 'km' },
      workout: bodyweightWorkout(),
    })
    expectCleanCopy(await sheet('Strength, ramp-in A'))
  })

  test('passes the lint on a workout the engine derives', async () => {
    open({ workout: engineWorkout(0) })
    const dialog = await sheet('Strength, heavy A')
    expectCleanCopy(dialog)
  })
})

describe('what the sheet shows of a workout the engine derives', () => {
  test.each([0, 1] as const)(
    'shows each lift of session %s with its suggested sets, counts and loads',
    async (variant) => {
      const workout = engineWorkout(variant)
      open({ workout })
      await sheet(`Strength, ${workout.template} ${workout.variant}`)
      const words = strengthWords('mi', 'lb')
      expect(workout.lifts.length).toBeGreaterThan(1)
      for (const lift of [...workout.lifts, ...workout.trunk]) {
        const name = words.name(lift.exerciseId)
        const measure = words.measure(measureOf(lift.exerciseId))
        expect(values(name, measure), name).toEqual(lift.targets.map(String))
        if (lift.steps !== null) {
          const shown = lift.loadG === null ? '' : String(fromGrams(lift.loadG, 'lb'))
          expect(values(name, 'load'), name).toEqual(lift.targets.map(() => shown))
        }
      }
    },
  )
})

describe('the layout rules of the stylesheet (design 11.7)', () => {
  const css = (file: string) => readFileSync(join(process.cwd(), 'web/components', file), 'utf8')

  test('a stepper button is at least 44 px square and a field keeps the page from zooming', () => {
    const stepper = css('strength/Stepper.module.css')
    expect(stepper).toMatch(/\.button \{[^}]*width: 2\.75rem;[^}]*min-height: 2\.75rem;/s)
    expect(stepper).toMatch(/\.field \{[^}]*min-height: 2\.75rem;/s)
    expect(stepper).toMatch(/font-size: max\(1rem, var\(--text-base\)\)/)
  })

  test('a swap choice is a 44 px target, the sets wrap instead of scrolling, and Save sits above the safe area', () => {
    const sheetCss = css('strength/StrengthSheet.module.css')
    expect(sheetCss).toMatch(/\.choice \{[^}]*min-height: 2\.75rem;/s)
    expect(sheetCss).toMatch(/\.steppers \{[^}]*flex-wrap: wrap;/s)
    expect(sheetCss).toMatch(/safe-area-inset-bottom/)
    expect(sheetCss).not.toMatch(/overflow-x: scroll/)
  })

  test('the reps-left scale is the touch scale: 44 px a value, wrapping when they do not fit', () => {
    expect(css('ScalePicker.module.css')).toMatch(/\[data-touch='true'\][^}]*minmax\(2\.75rem/s)
  })
})
