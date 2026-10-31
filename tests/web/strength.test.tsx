import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { formatLoad, fromGrams, toGrams } from '../../shared/domain/weight.ts'
import { P } from '../../shared/engine/params/index.ts'
import { estimateOneRm } from '../../shared/engine/strength.ts'
import type {
  StrengthNextLoad,
  StrengthSettings,
  StrengthSnapshot,
  StrengthView,
  StrengthWorkout,
  UserSettings,
} from '../../shared/types.ts'
import type { StrengthLogBody } from '../../web/api/strength.ts'
import { ToastProvider } from '../../web/components/Toast.tsx'
import { StrengthSheet, type StrengthSaved } from '../../web/components/strength/StrengthSheet.tsx'
import { STRENGTH_DRAFT_PREFIX } from '../../web/pwa/drafts.ts'
import { measureOf, strengthWords } from '../../web/components/strength/strengthText.ts'
import { StrengthPage } from '../../web/pages/StrengthPage.tsx'
import { getOutbox } from '../../web/pwa/outbox.ts'
import { have } from '../unit/engine/strength-fixtures.ts'
import {
  delayResponses,
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
  makeView,
  makeWorkout,
  rdl,
  savedLog,
  squat,
} from './strength-fixtures.ts'
import {
  LOG_FIRST,
  LOG_LAST,
  PROFILE,
  RDL_SUMMARY,
  SQUAT_SUMMARY,
  pageView,
  squatHistory,
  squatSession,
  unsavedView,
} from './strength-page-fixtures.ts'

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

    // it takes the place of the squat: same sets and counts, starting at the lightest dumbbell
    expect(screen.queryByRole('region', { name: 'Back squat' })).toBeNull()
    expect(values('Goblet squat', 'load')).toEqual(['10', '10', '10', '10'])
    expect(values('Goblet squat', 'reps')).toEqual(['5', '5', '4', '4'])
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
    expect(body.sets.filter((set) => set.exerciseId === 'goblet-squat')).toHaveLength(4)
    expect(body.sets.some((set) => set.exerciseId === 'back-squat')).toBe(false)
    const shown = body.prescribed.lifts.find((lift) => lift.exerciseId === 'goblet-squat')
    expect(shown).toMatchObject({
      implement: 'dumbbells',
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
    expect(values('Goblet squat', 'load')).toEqual(['10', '15', '10', '10'])
    expect(repsLeft('Goblet squat')).toEqual([3, null, null, null])
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

// ---- The Strength page (E14-9; design 6, 11.3, 11.4) -----------------------------------------------

const SETTINGS_KG: UserSettings = { ...SETTINGS, weightUnit: 'kg', units: 'km' }

interface PageOptions {
  /** The page view; `null` makes the read fail, as it does with no connection. */
  view?: StrengthView | null
  settings?: UserSettings
  routes?: MockRoutes
}

/** Opens the Strength page with the view, the settings and the profile answered. */
function openPage(options: PageOptions = {}) {
  const view = options.view === undefined ? pageView() : options.view
  const { calls } = mockApi({
    'GET /api/settings': () => options.settings ?? SETTINGS,
    'GET /api/strength': () => (view === null ? unreachable : view),
    'GET /api/profile': () => PROFILE,
    ...options.routes,
  })
  renderWithProviders(
    <ToastProvider>
      <StrengthPage />
    </ToastProvider>,
    { route: '/strength' },
  )
  return { calls }
}

/** The page once it has drawn its sections. */
async function page(name = 'Next session') {
  await screen.findByRole('region', { name })
}

const SECTIONS = [
  'Next session',
  'This block',
  'Lifts',
  'History of one lift',
  'Recent sessions',
  'Equipment and units',
  'About strength work',
]

const headings = () =>
  screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent)

describe('the Strength page: its sections and states (design 11.3)', () => {
  test('lists every section in phone order, with the offer to set up only while the setup is not saved', async () => {
    openPage()
    await page()
    expect(screen.getByRole('heading', { level: 1, name: 'Strength' })).toBeInTheDocument()
    expect(
      screen.getByText('The next workout, where the block stands and the lifts logged so far.'),
    ).toBeInTheDocument()
    expect(headings()).toEqual(SECTIONS)
    expect(screen.queryByRole('region', { name: 'Set up strength' })).not.toBeInTheDocument()
  })

  test('puts "Set up strength" first while the setup is not saved, with its five parts', async () => {
    openPage({ view: unsavedView() })
    await page('Set up strength')
    expect(headings()).toEqual(['Set up strength', ...SECTIONS])
    const setup = region('Set up strength')
    expect(
      setup.getByText(
        'The workout follows the saved equipment, lifting history and starting loads. Until they are saved it is bodyweight only.',
      ),
    ).toBeVisible()
    expect(setup.getAllByRole('button').map((button) => button.textContent)).toEqual([
      'Weight unit',
      'Equipment',
      'Lifting history',
      'Exercises',
      'Starting points',
    ])
    expect(
      region('Next session').getByText(
        'This workout is bodyweight only. Set up strength and the lifts use the saved equipment.',
      ),
    ).toBeVisible()
  })

  test('stands in two columns from 900 px: the first four sections on the left, the rest on the right', async () => {
    openPage()
    await page()
    const left = screen.getByRole('region', { name: 'Next session' }).parentElement
    const right = screen.getByRole('region', { name: 'History of one lift' }).parentElement
    expect(left).not.toBe(right)
    for (const name of ['This block', 'Lifts']) {
      expect(screen.getByRole('region', { name }).parentElement, name).toBe(left)
    }
    for (const name of ['Recent sessions', 'Equipment and units', 'About strength work']) {
      expect(screen.getByRole('region', { name }).parentElement, name).toBe(right)
    }
    // the left column comes first in the document, so a phone reads the sections in order
    expect(left?.compareDocumentPosition(right as Node)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)

    const css = readFileSync(join(process.cwd(), 'web/pages/StrengthPage.module.css'), 'utf8')
    expect(css).toMatch(
      /@media \(min-width: 900px\) \{\s*\.columns \{[^}]*display: grid;[^}]*grid-template-columns: minmax\(0, 1\.15fr\) minmax\(0, 1fr\);/s,
    )
    // below 900 px the columns are one flex column, and nothing can widen the page
    expect(css).toMatch(/\.columns \{[^}]*display: flex;[^}]*flex-direction: column;/s)
    expect(css).toMatch(/\.page > \* \{[^}]*min-width: 0;/s)
  })

  test('says it needs a connection when the page cannot be read', async () => {
    openPage({ view: null })
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The Strength page did not load. It needs a connection; reload the page to try again.',
    )
    expect(screen.queryByRole('region')).not.toBeInTheDocument()
    expectCleanCopy(document.body)
  })

  test('shows a loading placeholder while the page is read, and no load before the weight unit is known', async () => {
    mockApi({
      'GET /api/settings': () => SETTINGS,
      'GET /api/strength': () => pageView(),
      'GET /api/profile': () => PROFILE,
    })
    delayResponses(500)
    renderWithProviders(
      <ToastProvider>
        <StrengthPage />
      </ToastProvider>,
      { route: '/strength' },
    )
    expect(await screen.findByLabelText('Loading')).toHaveAttribute('aria-busy', 'true')
    expect(screen.queryByText(/ lb/)).not.toBeInTheDocument()
    await page()
    expect(screen.queryByLabelText('Loading')).not.toBeInTheDocument()
  })

  test('says so, and shows no load, when the weight unit cannot be read', async () => {
    openPage({ routes: { 'GET /api/settings': () => unreachable } })
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The weight unit could not be read, so no load is shown. Reload the page to try again.',
    )
    expect(screen.queryByText(/ lb/)).not.toBeInTheDocument()
  })

  test('has an empty state for the workout, the lifts and the sessions, in the words of the templates', async () => {
    openPage({
      view: pageView({ next: [], lifts: [], recent: [], block: null }),
    })
    await page()
    const next = region('Next session')
    expect(
      next.getByText('No strength session is planned. Choose how many a week on the Profile.'),
    ).toBeVisible()
    expect(next.getByRole('link', { name: 'Open the Profile' })).toHaveAttribute('href', '/profile')
    expect(next.queryByRole('button', { name: 'Log sets' })).not.toBeInTheDocument()
    expect(
      region('This block').getByText(
        'No strength block runs this week. Maintenance sessions are short and keep the loads.',
      ),
    ).toBeVisible()
    expect(
      region('Lifts').getByText(
        'No lifts are logged yet. Log a session and its lifts appear here.',
      ),
    ).toBeVisible()
    expect(
      region('History of one lift').getByText('Choose a lift from the list to see its history.'),
    ).toBeVisible()
    expect(
      region('Recent sessions').getByText(
        'No sessions are logged yet. Log sets and they appear here.',
      ),
    ).toBeVisible()
    expectCleanCopy(document.body)
  })
})

describe('the Strength page: the next session (design 11.3, 6.4)', () => {
  test('shows the workout card: the lifts, the jumps and the trunk movements as the rules give them', async () => {
    openPage()
    await page()
    const next = region('Next session')
    expect(next.getByText('Strength, heavy A')).toBeVisible()
    expect(next.getByText('Wed 18 Mar. About 40 min planned.')).toBeVisible()
    expect(
      next.getByText('Suggested 110 lb, four sets of 3 to 6 reps, leave 1 to 3 in reserve.'),
    ).toBeVisible()
    expect(
      next.getByText('Suggested 40 lb, three sets of 3 to 6 reps, leave 2 or more in reserve.'),
    ).toBeVisible()
    expect(
      next.getByText('Suggested three sets of 8 to 15 reps, leave 1 to 3 in reserve.'),
    ).toBeVisible()
    expect(next.getByText('Pogo hops, 40 contacts.')).toBeVisible()
    expect(next.getByText('Suggested two sets of 30 to 45 seconds.')).toBeVisible()
    expect(next.getByText('Lift at least 3 hours before or after a run.')).toBeVisible()
    // a word for what the rules did, never colour alone
    expect(next.getByText('Up one step')).toBeVisible()
    expect(next.getByText('The load holds')).toBeVisible()
  })

  test('shows the loads in kilograms for a runner who chose them, on the same grams', async () => {
    openPage({ settings: SETTINGS_KG })
    await page()
    expect(
      region('Next session').getByText(
        'Suggested 50 kg, four sets of 3 to 6 reps, leave 1 to 3 in reserve.',
      ),
    ).toBeVisible()
  })

  test('"Log sets" opens the sheet on the workout and links the session of the day', async () => {
    const { calls } = openPage({
      routes: { [`PUT ${LOG_URL}`]: () => savedLog(LOG_ID) },
    })
    await page()
    const user = userEvent.setup()
    await user.click(region('Next session').getByRole('button', { name: 'Log sets' }))
    const dialog = await sheet('Strength, heavy A')
    expect(within(dialog).getByText('Wed 18 Mar. Loads are in pounds.')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'As suggested' }))
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
    expect(calls.find((call) => call.method === 'PUT' && call.url === LOG_URL)?.body).toMatchObject(
      { date: DAY, sessionId: SESSION_ID },
    )
    // the page reads again once the log is saved, so the next suggestion follows it
    await waitFor(() => {
      expect(calls.filter((call) => call.url === '/api/strength').length).toBeGreaterThan(1)
    })
  })

  test('logs a session that is still ahead today and links no session', async () => {
    const { calls } = openPage({
      view: pageView({ next: [makeWorkout({ date: '2026-03-20' })] }),
      routes: { [`PUT ${LOG_URL}`]: () => savedLog(LOG_ID) },
    })
    await page()
    const user = userEvent.setup()
    expect(region('Next session').getByText('Fri 20 Mar. About 40 min planned.')).toBeVisible()
    await user.click(region('Next session').getByRole('button', { name: 'Log sets' }))
    const dialog = await sheet('Strength, heavy A')
    expect(within(dialog).getByText('Wed 18 Mar. Loads are in pounds.')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'As suggested' }))
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
    const body = putBody(calls)
    expect(body.date).toBe(DAY)
    expect(body).not.toHaveProperty('sessionId')
  })

  test('"Add a past session" asks for a day in the last year and opens the sheet on it, linking no session', async () => {
    const { calls } = openPage({
      routes: { [`PUT ${LOG_URL}`]: () => savedLog(LOG_ID) },
    })
    await page()
    const user = userEvent.setup()
    const next = region('Next session')
    const open = next.getByRole('button', { name: 'Add a past session' })
    expect(open).toHaveAttribute('aria-expanded', 'false')
    await user.click(open)
    expect(open).toHaveAttribute('aria-expanded', 'true')
    const day = screen.getByLabelText('Date of the session')
    expect(day).toHaveAttribute('type', 'date')
    expect(day).toHaveAttribute('max', DAY)
    expect(day).toHaveAttribute('min', '2025-03-18')
    expect(screen.getByText('Any day in the last year, up to today.')).toBeVisible()

    // tomorrow, and more than a year back, are refused where the server would refuse them
    for (const bad of ['2026-03-19', '2025-03-17', '']) {
      fireEvent.change(day, { target: { value: bad } })
      await user.click(screen.getByRole('button', { name: 'Continue' }))
      expect(screen.getByText('Choose a day in the last year, up to today.')).toBeVisible()
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    }

    fireEvent.change(day, { target: { value: '2026-03-10' } })
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    const dialog = await sheet('Strength, heavy A')
    expect(within(dialog).getByText('Tue 10 Mar. Loads are in pounds.')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'As suggested' }))
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
    const body = putBody(calls)
    expect(body.date).toBe('2026-03-10')
    expect(body).not.toHaveProperty('sessionId')
  })
})

describe('the Strength page: this block (design 11.3, 4.5)', () => {
  test('says where the week stands, what follows, the benefit sentence with its grade, and links the research', async () => {
    openPage()
    await page('This block')
    const block = region('This block')
    expect(block.getByText('Week 6 of 12, heavy')).toBeVisible()
    expect(
      block.getByText(
        'Heavy work runs to week 12. Maintenance follows; the taper keeps a light session each week.',
      ),
    ).toBeVisible()
    expect(
      block.getByText(
        'Strength work may lower the oxygen cost of running by about 2 to 4% after a full block. That is small, and it says nothing about race time.',
      ),
    ).toBeVisible()
    expect(block.getByText(`Evidence grade ${P.f7.expectedBenefitPct.grade}`)).toBeVisible()
    expect(block.getByRole('link', { name: 'Read the research' })).toHaveAttribute(
      'href',
      '/research?topic=strength-plyometrics',
    )
  })

  test.each([
    [
      'ramp-in',
      'Week 2 of 12, ramp-in',
      'The ramp-in lasts three weeks. Heavy work follows to week 12',
    ],
    [
      'lighter-week',
      'Week 4 of 12, lighter week',
      'A lighter week keeps the loads and cuts the sets.',
    ],
    [
      'taper',
      'Week 2 of 12, taper',
      'The taper keeps a light session each week until the race week.',
    ],
    ['return', 'Week 3 of 12, return', 'Return weeks use the ramp-in structure with no jumps.'],
    [
      'maintenance',
      'Week 2 of 12, maintenance',
      'Maintenance sessions are short and keep the loads.',
    ],
  ] as const)('words a %s week and what follows it', async (template, position, follows) => {
    const week = Number(position.match(/Week (\d+)/)?.[1])
    openPage({ view: pageView({ block: { week, of: 12, rampInWeeks: 3, template } }) })
    await page('This block')
    const block = region('This block')
    expect(block.getByText(position)).toBeVisible()
    expect(block.getByText(new RegExp(`^${escaped(follows)}`))).toBeVisible()
  })

  test('says nothing about benefit when the view carries no fact for it', async () => {
    openPage({ view: pageView({ facts: [] }) })
    await page('This block')
    expect(screen.queryByText(/oxygen cost of running/)).not.toBeInTheDocument()
    // the separation line is a fact too, so the card leaves it out
    expect(screen.queryByText(/Lift at least/)).not.toBeInTheDocument()
  })
})

describe('the Strength page: the lifts and the history of one lift (design 11.3, 6.3)', () => {
  const liftRow = (name: string) =>
    within(
      within(screen.getByRole('region', { name: 'Lifts' }))
        .getByText(name)
        .closest('li')!,
    )
  const squatItem = () => liftRow('Back squat')

  test('lists each lift with its last load, its estimated maximum as an estimate and the last change in words', async () => {
    openPage()
    await page('Lifts')
    const squatRow = squatItem()
    expect(squatRow.getByText('Last load')).toBeVisible()
    expect(squatRow.getByText('105 lb')).toBeVisible()
    expect(squatRow.getByText('Estimated maximum')).toBeVisible()
    expect(squatRow.getByText('about 125 lb')).toBeVisible()
    expect(squatRow.getByText('Up from 100 lb to 105 lb, Thu 12 Mar')).toBeVisible()
    expect(squatRow.getByText('Thu 12 Mar')).toBeVisible()
    // a lift whose load has not moved and that has no estimate says the first and shows none of the second
    const rdlRow = liftRow('Dumbbell Romanian deadlift')
    expect(rdlRow.getByText('35 lb')).toBeVisible()
    expect(rdlRow.getByText('The load has not moved')).toBeVisible()
    expect(rdlRow.queryByText('Estimated maximum')).not.toBeInTheDocument()
    expect(
      region('Lifts').getByText(
        'The estimated maximum is worked out from sets, not tested. It is a rough guide.',
      ),
    ).toBeVisible()
  })

  test('words a load that came down, and a lift with no added load', async () => {
    openPage({
      view: pageView({
        lifts: [
          {
            ...SQUAT_SUMMARY,
            lastChange: { fromG: lb(110), toG: lb(105), date: '2026-03-12' },
          },
          {
            ...RDL_SUMMARY,
            exerciseId: 'standing-calf-raise',
            workingLoadG: null,
            lastChange: null,
          },
        ],
      }),
    })
    await page('Lifts')
    expect(screen.getByText('Down from 110 lb to 105 lb, Thu 12 Mar')).toBeVisible()
    expect(screen.getByText('No added load')).toBeVisible()
  })

  test('shows every load in kilograms for a runner who chose them', async () => {
    openPage({ settings: SETTINGS_KG })
    await page('Lifts')
    const squatRow = squatItem()
    // the same grams, on the display grid of kilograms (a quarter)
    expect(formatLoad(lb(105), 'kg')).toBe('47.75 kg')
    expect(squatRow.getByText('47.75 kg')).toBeVisible()
    expect(squatRow.getByText('about 56.75 kg')).toBeVisible()
    expect(squatRow.getByText('Up from 45.25 kg to 47.75 kg, Thu 12 Mar')).toBeVisible()
  })

  test('chooses a lift from the list and shows its history as a labelled table with a line of the estimated maximum', async () => {
    const { calls } = openPage({
      routes: { 'GET /api/strength/exercises/back-squat': () => squatHistory() },
    })
    await page('Lifts')
    const user = userEvent.setup()
    const choose = screen.getByRole('button', { name: 'History of Back squat' })
    expect(choose).toHaveAttribute('aria-pressed', 'false')
    await user.click(choose)
    expect(choose).toHaveAttribute('aria-pressed', 'true')

    const table = await screen.findByRole('region', { name: 'History of Back squat' })
    expect(table).toHaveAttribute('tabindex', '0')
    const grid = within(table).getByRole('table')
    expect(
      within(grid)
        .getAllByRole('columnheader')
        .map((cell) => cell.textContent),
    ).toEqual(['Date and mode', 'Sets', 'Estimated maximum'])
    const rows = within(grid).getAllByRole('row').slice(1)
    expect(rows).toHaveLength(3)
    // newest first: the date, the load and count of each set, the reps left, the mode, the estimate
    const latest = within(rows[0]!)
    expect(latest.getByRole('rowheader')).toHaveTextContent('Thu 12 Mar')
    expect(latest.getAllByText('105 lb x 5, 2 left', { selector: 'li' })).toHaveLength(2)
    expect(latest.getByText('105 lb x 4', { selector: 'li' })).toBeVisible()
    expect(latest.getByText('Normal')).toBeVisible()
    expect(latest.getByText('125 lb')).toBeVisible()
    expect(within(rows[1]!).getByText('Lighter day')).toBeVisible()
    expect(within(rows[2]!).getByText('No estimate')).toBeVisible()

    // the heading of the lift takes focus, and the line is drawn by the lazy chart module
    expect(screen.getByRole('heading', { level: 3, name: 'Back squat' })).toHaveFocus()
    const chart = await screen.findByRole('img', {
      name: 'Estimated maximum, from submaximal sets',
    })
    expect(chart).toBeInTheDocument()
    expect(
      screen.getByText('Estimated maximum, from submaximal sets', { selector: 'figcaption' }),
    ).toBeVisible()
    expect(calls.filter((call) => call.url === '/api/strength/exercises/back-squat')).toHaveLength(
      1,
    )
  })

  test('draws no line until two sessions have an estimate, and says so', async () => {
    openPage({
      routes: {
        'GET /api/strength/exercises/back-squat': () =>
          squatHistory({
            sessions: [
              squatSession(LOG_LAST, '2026-03-12', 105, 125),
              squatSession(LOG_FIRST, '2026-03-05', 100, null),
            ],
          }),
      },
    })
    await page('Lifts')
    await userEvent.setup().click(screen.getByRole('button', { name: 'History of Back squat' }))
    await screen.findByRole('region', { name: 'History of Back squat' })
    expect(
      screen.getByText('The line appears once two sessions have an estimated maximum.'),
    ).toBeVisible()
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })

  test('shows a starting point, and says a lift has no logged sets yet', async () => {
    openPage({
      routes: {
        'GET /api/strength/exercises/back-squat': () =>
          squatHistory({
            sessions: [],
            summary: null,
            anchor: {
              exerciseId: 'back-squat',
              kind: 'set',
              loadG: lb(135),
              reps: 5,
              rir: 2,
              asOf: '2026-03-01',
            },
          }),
      },
    })
    await page('Lifts')
    await userEvent.setup().click(screen.getByRole('button', { name: 'History of Back squat' }))
    expect(await screen.findByText('Starting point: a set of 135 lb, five reps.')).toBeVisible()
    expect(screen.getByText('This lift has no logged sets yet.')).toBeVisible()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  test('says when a history did not load and tries again', async () => {
    let attempts = 0
    openPage({
      routes: {
        'GET /api/strength/exercises/back-squat': () => {
          attempts += 1
          return attempts === 1 ? unreachable : squatHistory()
        },
      },
    })
    await page('Lifts')
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'History of Back squat' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The history of this lift did not load.',
    )
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('region', { name: 'History of Back squat' })).toBeVisible()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  test('shows loads, counts and the estimate in kilograms and seconds for a timed lift', async () => {
    openPage({
      settings: SETTINGS_KG,
      view: pageView({ lifts: [{ ...RDL_SUMMARY, exerciseId: 'side-plank', workingLoadG: null }] }),
      routes: {
        'GET /api/strength/exercises/side-plank': () => ({
          exerciseId: 'side-plank',
          anchor: null,
          summary: { ...RDL_SUMMARY, exerciseId: 'side-plank', workingLoadG: null },
          sessions: [
            {
              logId: LOG_LAST,
              date: '2026-03-12',
              mode: 'taper',
              sets: [{ position: 0, loadG: null, count: 30, rir: null }],
              heaviest: null,
              workingLoadG: null,
              estimateG: null,
            },
          ],
        }),
      },
    })
    await page('Lifts')
    await userEvent.setup().click(screen.getByRole('button', { name: 'History of Side plank' }))
    const table = await screen.findByRole('region', { name: 'History of Side plank' })
    expect(within(table).getByText('30 seconds', { selector: 'li' })).toBeVisible()
    expect(within(table).getByText('Taper')).toBeVisible()
  })
})

describe('the Strength page: the recent sessions (design 11.3)', () => {
  test('lists the logged sessions with their template, sets and minutes', async () => {
    openPage()
    await page('Recent sessions')
    const recent = region('Recent sessions')
    expect(recent.getAllByRole('listitem')).toHaveLength(2)
    expect(recent.getByText('Thu 12 Mar')).toBeVisible()
    expect(recent.getByText('five sets, 40 min.')).toBeVisible()
    expect(recent.getByText('Thu 5 Mar')).toBeVisible()
    expect(recent.getByText('two sets, 40 min.')).toBeVisible()
    expect(recent.getAllByText('Strength, heavy A')).toHaveLength(2)
  })

  test('deletes a session after asking, and reads the page again', async () => {
    let logs = pageView().recent
    const { calls } = openPage({
      routes: {
        'GET /api/strength': () => pageView({ recent: logs }),
        [`DELETE /api/strength/logs/${LOG_LAST}`]: () => {
          logs = logs.filter((log) => log.id !== LOG_LAST)
          return { status: 204, body: undefined }
        },
      },
    })
    await page('Recent sessions')
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Delete the session of Thu 12 Mar' }))
    const ask = screen.getByRole('group', { name: 'Delete the session of Thu 12 Mar' })
    expect(
      within(ask).getByText('Delete the sets of this session? The activity stays.'),
    ).toBeVisible()
    // nothing is sent until it is confirmed
    expect(calls.some((call) => call.method === 'DELETE')).toBe(false)
    await user.click(within(ask).getByRole('button', { name: 'Delete the sets' }))
    expect(await screen.findByText('Sets deleted')).toBeVisible()
    await waitFor(() => {
      expect(region('Recent sessions').getAllByRole('listitem')).toHaveLength(1)
    })
    expect(calls.filter((call) => call.method === 'DELETE').map((call) => call.url)).toEqual([
      `/api/strength/logs/${LOG_LAST}`,
    ])
    expect(screen.getByRole('heading', { level: 2, name: 'Recent sessions' })).toHaveFocus()
  })

  test('keeps a session when asked to, and returns focus to its Delete button', async () => {
    const { calls } = openPage()
    await page('Recent sessions')
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Delete the session of Thu 12 Mar' }))
    await user.click(screen.getByRole('button', { name: 'Keep' }))
    const again = screen.getByRole('button', { name: 'Delete the session of Thu 12 Mar' })
    expect(again).toHaveFocus()
    expect(screen.queryByText('Delete the sets of this session? The activity stays.')).toBeNull()
    expect(calls.some((call) => call.method === 'DELETE')).toBe(false)
  })

  test('says when a delete was refused and keeps the question open', async () => {
    openPage({
      routes: { [`DELETE /api/strength/logs/${LOG_LAST}`]: () => unreachable },
    })
    await page('Recent sessions')
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Delete the session of Thu 12 Mar' }))
    await user.click(screen.getByRole('button', { name: 'Delete the sets' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The sets were not deleted. Try again.',
    )
    expect(screen.getByRole('button', { name: 'Delete the sets' })).toBeEnabled()
    expect(region('Recent sessions').getAllByRole('listitem')).toHaveLength(2)
  })

  test('edits a session: the sheet opens as it was saved and saves over it under its own id', async () => {
    const log = pageView().recent[0]!
    const { calls } = openPage({
      routes: { [`PUT /api/strength/logs/${LOG_LAST}`]: () => savedLog(LOG_LAST) },
    })
    await page('Recent sessions')
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Edit the session of Thu 12 Mar' }))
    const dialog = await sheet('Strength, heavy A')
    expect(within(dialog).getByText('Thu 12 Mar. Loads are in pounds.')).toBeVisible()

    // the sets as they were logged, the reps left, the minutes, and nothing of the plan they came from
    expect(values('Back squat', 'load')).toEqual(['105', '105', '105'])
    expect(values('Back squat', 'reps')).toEqual(['5', '5', '4'])
    expect(repsLeft('Back squat')).toEqual([2, 2, 1])
    expect(values('Dumbbell Romanian deadlift', 'load')).toEqual(['35', '35'])
    expect(screen.getByRole('textbox', { name: 'Minutes' })).toHaveValue('40')
    for (const gone of [
      'As suggested',
      'Same as last time',
      'Swap: Back squat',
      'Save without sets',
    ]) {
      expect(screen.queryByRole('button', { name: gone }), gone).not.toBeInTheDocument()
    }
    expect(screen.queryByRole('button', { name: 'Why' })).not.toBeInTheDocument()

    // one set goes up a step of the bar, and the session is saved
    const first = within(screen.getByRole('group', { name: 'Back squat, set 1, load' }))
    await user.click(first.getByRole('button', { name: 'Raise the load by one step' }))
    expect(values('Back squat', 'load')).toEqual(['110', '105', '105'])
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
    const sent = calls.filter((call) => call.method === 'PUT')
    expect(sent.map((call) => call.url)).toEqual([`/api/strength/logs/${LOG_LAST}`])
    const body = sent[0]?.body as StrengthLogBody
    expect(body).toMatchObject({ date: '2026-03-12', activityId: log.activityId, durationMin: 40 })
    expect(body).not.toHaveProperty('sessionId')
    // what the sheet showed then has not changed: the snapshot goes back as it is
    expect(body.prescribed).toEqual(log.prescribed)
    expect(body.sets.map((set) => [set.exerciseId, set.loadG, set.count, set.rir])).toEqual([
      ['back-squat', lb(110), 5, 2],
      ['back-squat', lb(105), 5, 2],
      ['back-squat', lb(105), 4, 1],
      ['dumbbell-rdl', lb(35), 6, 3],
      ['dumbbell-rdl', lb(35), 6, 3],
    ])
  })
})

describe('the Strength page: the setup (design 6.2, 6.5)', () => {
  /** The sheet of a part of the setup. */
  async function setupSheet(name: string) {
    const dialog = await screen.findByRole('dialog', { name })
    return within(dialog)
  }

  const sentOf = (calls: Rig['calls'], method: string, url: string) =>
    calls.filter((call) => call.method === method && call.url === url).map((call) => call.body)

  /** Routes that answer a save of the setup with the settings it made, and the view with them. */
  function savingRoutes(start: StrengthView = unsavedView()) {
    let view = start
    const routes: MockRoutes = {
      'GET /api/strength': () => view,
      'PUT /api/strength/settings': ({ body }) => {
        const patch = body as Partial<StrengthSettings>
        const settings = {
          ...view.settings,
          ...patch,
          savedAt: view.settings.savedAt ?? '2026-03-18T09:00:00.000Z',
        } as StrengthSettings
        view = { ...view, settings, setupSaved: true }
        return settings
      },
    }
    return { routes, current: () => view }
  }

  test('the weight unit is the first part, saved by the route that saves the distance unit', async () => {
    const { calls } = openPage({
      view: unsavedView(),
      routes: {
        'PUT /api/settings': ({ body }) => ({ ...SETTINGS, ...(body as object) }),
      },
    })
    await page('Set up strength')
    const user = userEvent.setup()
    await user.click(region('Set up strength').getByRole('button', { name: 'Weight unit' }))
    const sheet = await setupSheet('Weight unit')
    expect(sheet.getByRole('radio', { name: 'Pounds' })).toBeChecked()
    await user.click(sheet.getByRole('radio', { name: 'Kilograms' }))
    await user.click(sheet.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('Weight unit saved')).toBeVisible()
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
    expect(sentOf(calls, 'PUT', '/api/settings')).toEqual([{ weightUnit: 'kg' }])
    // closing without a change sends nothing
    await user.click(region('Set up strength').getByRole('button', { name: 'Weight unit' }))
    await user.click((await setupSheet('Weight unit')).getByRole('button', { name: 'Save' }))
    expect(sentOf(calls, 'PUT', '/api/settings')).toHaveLength(1)
  })

  test('the equipment is a checklist with the detail each item needs, saved in grams on the steps it makes', async () => {
    const { routes, current } = savingRoutes()
    const { calls } = openPage({ view: unsavedView(), routes })
    await page('Set up strength')
    const user = userEvent.setup()
    await user.click(region('Set up strength').getByRole('button', { name: 'Equipment' }))
    const sheet = await setupSheet('Equipment')
    expect(
      sheet.getByText(
        'Bodyweight is always available. Tick the other equipment; each step is the smallest change of load.',
      ),
    ).toBeVisible()
    expect(sheet.getAllByRole('checkbox').map((box) => box.closest('label')?.textContent)).toEqual([
      'Barbell, plates and a rack',
      'Dumbbells',
      'Kettlebells',
      'Bands',
      'A step or box',
      'Leg press',
      'Calf raise machine',
      'Leg curl machine',
    ])

    // a bar: the usual 45 lb and 5 lb, which the runner keeps
    await user.click(sheet.getByRole('checkbox', { name: 'Barbell, plates and a rack' }))
    expect(sheet.getByLabelText('Bar weight in pounds')).toHaveValue('45')
    expect(sheet.getByLabelText('Smallest pair of plates in pounds')).toHaveValue('5')
    // dumbbells as a range and a step
    await user.click(sheet.getByRole('checkbox', { name: 'Dumbbells' }))
    await user.type(sheet.getByLabelText('Lightest weight in pounds'), '10')
    await user.type(sheet.getByLabelText('Heaviest weight in pounds'), '50')
    await user.type(sheet.getByLabelText('Step in pounds'), '5')
    // kettlebells as a list
    await user.click(sheet.getByRole('checkbox', { name: 'Kettlebells' }))
    await user.type(sheet.getByLabelText('Weights in pounds'), '18, 26, 35')
    // bands and a step carry no load, and a machine has a step and a top
    await user.click(sheet.getByRole('checkbox', { name: 'Bands' }))
    await user.click(sheet.getByRole('checkbox', { name: 'A step or box' }))
    await user.click(sheet.getByRole('checkbox', { name: 'Leg press' }))
    await user.type(sheet.getByLabelText('Weight step in pounds'), '10')
    await user.type(sheet.getByLabelText('Top weight in pounds'), '300')
    await user.click(sheet.getByRole('button', { name: 'Save' }))

    expect(await screen.findByText('Strength setup saved')).toBeVisible()
    expect(sentOf(calls, 'PUT', '/api/strength/settings')).toEqual([
      {
        equipment: [
          { kind: 'barbell', barG: lb(45), jumpG: lb(5) },
          { kind: 'dumbbells', loads: { minG: lb(10), stepG: lb(5), maxG: lb(50) } },
          { kind: 'kettlebells', loads: { loadsG: [lb(18), lb(26), lb(35)] } },
          { kind: 'bands' },
          { kind: 'step' },
          { kind: 'leg-press', stepG: lb(10), maxG: lb(300) },
        ],
      },
    ])
    expect(current().setupSaved).toBe(true)
    // the first save ends the offer, and the page has read the view again
    await waitFor(() => {
      expect(screen.queryByRole('region', { name: 'Set up strength' })).not.toBeInTheDocument()
    })
    expect(calls.filter((call) => call.url === '/api/strength').length).toBeGreaterThan(1)
  })

  test('the next workout follows a change of equipment at once, on the next read', async () => {
    const start = pageView({ next: [makeWorkout()] })
    let view = start
    const { calls } = openPage({
      view,
      routes: {
        'GET /api/strength': () => view,
        'PUT /api/strength/settings': () => {
          // the bar is sold: the squat gives way to the next feasible lift of the slot
          view = {
            ...view,
            settings: { ...view.settings, equipment: have('dumbbells', 'bands', 'step') },
            next: [
              makeWorkout({
                lifts: [
                  squat({
                    exerciseId: 'goblet-squat',
                    implement: 'dumbbells',
                    change: 'start',
                    loadG: lb(30),
                  }),
                ],
              }),
            ],
          }
          return view.settings
        },
      },
    })
    await page()
    const user = userEvent.setup()
    expect(region('Next session').getByText(/Suggested 110 lb, four sets/)).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Edit equipment' }))
    const sheet = await setupSheet('Equipment')
    expect(sheet.getByRole('checkbox', { name: 'Barbell, plates and a rack' })).toBeChecked()
    await user.click(sheet.getByRole('checkbox', { name: 'Barbell, plates and a rack' }))
    await user.click(sheet.getByRole('button', { name: 'Save' }))
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
    // the sent equipment is the saved one without the bar, the rest as it was: nothing was re-typed
    const sent = calls.find((call) => call.method === 'PUT')?.body as { equipment: unknown[] }
    expect(sent.equipment).toEqual(have('dumbbells', 'bands', 'step'))
    await waitFor(() => {
      expect(region('Next session').queryByText(/Suggested 110 lb/)).not.toBeInTheDocument()
    })
    expect(region('Next session').getByText(/Suggested 30 lb, four sets/)).toBeVisible()
    expect(region('Equipment and units').getByText('Dumbbells, Bands, A step or box')).toBeVisible()
  })

  test('marks the field a save cannot read, says so, and sends nothing', async () => {
    const { routes } = savingRoutes()
    const { calls } = openPage({ view: unsavedView(), routes })
    await page('Set up strength')
    const user = userEvent.setup()
    await user.click(region('Set up strength').getByRole('button', { name: 'Equipment' }))
    const sheet = await setupSheet('Equipment')
    await user.click(sheet.getByRole('checkbox', { name: 'Dumbbells' }))
    await user.type(sheet.getByLabelText('Lightest weight in pounds'), '50')
    await user.type(sheet.getByLabelText('Heaviest weight in pounds'), '10')
    await user.type(sheet.getByLabelText('Step in pounds'), '0.1')
    await user.click(sheet.getByRole('checkbox', { name: 'Leg curl machine' }))
    await user.type(sheet.getByLabelText('Weight step in pounds'), '20')
    await user.type(sheet.getByLabelText('Top weight in pounds'), '10')
    await user.click(sheet.getByRole('button', { name: 'Save' }))

    expect(sheet.getByText('Some fields need attention. Check the marked ones.')).toBeVisible()
    const top = sheet.getByLabelText('Heaviest weight in pounds')
    expect(top).toHaveAttribute('aria-invalid', 'true')
    expect(top).toHaveFocus()
    expect(sheet.getByText('The heaviest weight must be at least the lightest.')).toBeVisible()
    expect(sheet.getByLabelText('Top weight in pounds')).toHaveAttribute('aria-invalid', 'true')
    expect(sheet.getByText('The top weight must be at least one step.')).toBeVisible()
    expect(calls.some((call) => call.method === 'PUT')).toBe(false)

    // with those mended, a step finer than a load can show is refused
    fireEvent.change(top, { target: { value: '80' } })
    fireEvent.change(sheet.getByLabelText('Top weight in pounds'), { target: { value: '100' } })
    await user.click(sheet.getByRole('button', { name: 'Save' }))
    expect(sheet.getByLabelText('Step in pounds')).toHaveAttribute('aria-invalid', 'true')
    expect(sheet.getByText('The step is too small to show. Use a larger step.')).toBeVisible()

    // and a list that is not weights
    await user.click(sheet.getByRole('radio', { name: 'A list' }))
    await user.type(sheet.getByLabelText('Weights in pounds'), '10, heavy')
    await user.click(sheet.getByRole('button', { name: 'Save' }))
    expect(sheet.getByText('List at least one weight, separated by commas.')).toBeVisible()
    expect(calls.some((call) => call.method === 'PUT')).toBe(false)
    expectCleanCopy(screen.getByRole('dialog'))
  })

  test('the lifting history saves the level and whether lifting goes on now', async () => {
    const { routes } = savingRoutes()
    const { calls } = openPage({ view: unsavedView(), routes })
    await page('Set up strength')
    const user = userEvent.setup()
    await user.click(region('Set up strength').getByRole('button', { name: 'Lifting history' }))
    const sheet = await setupSheet('Lifting history')
    expect(sheet.getByRole('radio', { name: 'Some' })).toBeChecked()
    expect(sheet.getByText('Lifted for a while but not consistently.')).toBeVisible()
    await user.click(sheet.getByRole('radio', { name: 'Experienced' }))
    expect(
      sheet.getByText(
        'Lifted consistently for a year or more and comfortable with squat and hinge movements under load.',
      ),
    ).toBeVisible()
    expect(sheet.getByRole('radio', { name: 'No' })).toBeChecked()
    await user.click(sheet.getByRole('radio', { name: 'Yes' }))
    await user.click(sheet.getByRole('button', { name: 'Save' }))
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
    expect(sentOf(calls, 'PUT', '/api/strength/settings')).toEqual([
      { level: 'experienced', currentlyLifting: true },
    ])
    expect(await screen.findByText('Experienced, lifting now: Yes')).toBeVisible()
  })

  test('the exercises sheet leaves a movement out, pins one for a slot and keeps a note', async () => {
    const { routes } = savingRoutes(pageView())
    const { calls } = openPage({ view: pageView(), routes })
    await page()
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Edit exercises' }))
    const sheet = await setupSheet('Exercises')
    // a slot is pinned to an exercise the saved equipment can do, and to nothing else
    const knee = sheet.getByLabelText('Always use for Squats and steps')
    expect(
      within(knee)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual([
      'The plan chooses',
      'Back squat',
      'Goblet squat',
      'Tempo squat',
      'Split squat',
      'Step-up',
      'Single-leg box squat',
    ])
    await user.selectOptions(knee, 'goblet-squat')
    expect(sheet.getByLabelText('Always use for Calf raises')).toHaveValue('')
    // every exercise of the catalogue has a switch, grouped by slot
    expect(sheet.getAllByRole('checkbox')).toHaveLength(25)
    await user.click(sheet.getByRole('checkbox', { name: 'Leg curl' }))
    await user.type(sheet.getByLabelText('Note'), '  Knee is tender on stairs  ')
    await user.click(sheet.getByRole('button', { name: 'Save' }))
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
    expect(sentOf(calls, 'PUT', '/api/strength/settings')).toEqual([
      {
        avoid: ['leg-curl'],
        pinned: { knee: 'goblet-squat' },
        note: 'Knee is tender on stairs',
      },
    ])
    expect(
      await region('Equipment and units').findByText(
        'Left out: Leg curl. Always used: Goblet squat.',
      ),
    ).toBeVisible()
  })

  test('an exercise left out cannot also be always used', async () => {
    const view = pageView({
      settings: { ...STRENGTH_SETTINGS, pinned: { knee: 'back-squat' } },
    })
    const { routes } = savingRoutes(view)
    const { calls } = openPage({ view, routes })
    await page()
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Edit exercises' }))
    const sheet = await setupSheet('Exercises')
    expect(sheet.getByLabelText('Always use for Squats and steps')).toHaveValue('back-squat')
    await user.click(sheet.getByRole('checkbox', { name: 'Back squat' }))
    expect(sheet.getByLabelText('Always use for Squats and steps')).toHaveValue('')
    await user.click(sheet.getByRole('button', { name: 'Save' }))
    await waitFor(() => {
      expect(sentOf(calls, 'PUT', '/api/strength/settings')).toEqual([
        { avoid: ['back-squat'], pinned: {}, note: null },
      ])
    })
  })

  test('a starting point is a recent set or a known maximum, with the estimated maximum shown as an estimate', async () => {
    let view = pageView()
    const { calls } = openPage({
      view,
      routes: {
        'GET /api/strength': () => view,
        'PUT /api/strength/lifts/back-squat': ({ body }) => {
          const lift = body as {
            kind: 'set' | 'max'
            loadG: number
            reps?: number
            rir?: number | null
          }
          const saved = {
            exerciseId: 'back-squat',
            kind: lift.kind,
            loadG: lift.loadG,
            reps: lift.reps ?? 1,
            rir: lift.rir ?? null,
            asOf: DAY,
          } as const
          view = { ...view, anchors: [saved] }
          return saved
        },
        'DELETE /api/strength/lifts/back-squat': () => {
          view = { ...view, anchors: [] }
          return { status: 204, body: undefined }
        },
      },
    })
    await page()
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Edit starting points' }))
    const sheet = await setupSheet('Starting points')
    await user.selectOptions(sheet.getByLabelText('Exercise'), 'back-squat')
    await user.type(sheet.getByLabelText('Weight in pounds'), '135')
    await user.type(sheet.getByLabelText('Reps'), '5')
    // 135 lb for five, leaving two: worked out by the engine, shown as an estimate, never as a test
    await user.click(sheet.getByRole('button', { name: 'Reps left 2' }))
    const estimate = formatLoad(estimateOneRm(lb(135), 5, 2) ?? 0, 'lb')
    expect(
      sheet.getByText(
        'Estimated maximum: about ' + estimate + '. It is worked out from this set, not tested.',
      ),
    ).toBeVisible()
    // a set too far from the limit gives none
    await user.clear(sheet.getByLabelText('Reps'))
    await user.type(sheet.getByLabelText('Reps'), '12')
    expect(
      sheet.getByText('No estimate from this set: it is more than 10 reps from the limit.'),
    ).toBeVisible()
    await user.clear(sheet.getByLabelText('Reps'))
    await user.type(sheet.getByLabelText('Reps'), '5')
    await user.click(sheet.getByRole('button', { name: 'Save starting point' }))
    expect(await screen.findByText('Starting point saved')).toBeVisible()
    expect(sentOf(calls, 'PUT', '/api/strength/lifts/back-squat')).toEqual([
      { kind: 'set', loadG: lb(135), reps: 5, rir: 2 },
    ])
    // the sheet stays open, lists what is saved with its estimate, and takes another
    const saved = await sheet.findByRole('list')
    expect(within(saved).getByText('Back squat: 135 lb, five reps.')).toBeVisible()
    expect(sheet.getByLabelText('Exercise')).toHaveValue('')

    // a known maximum stands as it is
    await user.selectOptions(sheet.getByLabelText('Exercise'), 'back-squat')
    await user.click(sheet.getByRole('radio', { name: 'A known maximum' }))
    expect(sheet.queryByLabelText('Reps')).not.toBeInTheDocument()
    await user.type(sheet.getByLabelText('Weight in pounds'), '185')
    expect(sheet.getByText('Estimated maximum: 185 lb, the maximum entered.')).toBeVisible()
    await user.click(sheet.getByRole('button', { name: 'Save starting point' }))
    await waitFor(() => {
      expect(sentOf(calls, 'PUT', '/api/strength/lifts/back-squat')).toHaveLength(2)
    })
    expect(sentOf(calls, 'PUT', '/api/strength/lifts/back-squat')[1]).toEqual({
      kind: 'max',
      loadG: lb(185),
    })

    // and a starting point is removed on its own
    await user.click(
      await sheet.findByRole('button', { name: 'Remove the starting point for Back squat' }),
    )
    expect(await screen.findByText('Starting point removed')).toBeVisible()
    await waitFor(() => {
      expect(sheet.queryByRole('list')).not.toBeInTheDocument()
    })
    expect(calls.filter((call) => call.method === 'DELETE').map((call) => call.url)).toEqual([
      '/api/strength/lifts/back-squat',
    ])
  })

  test('marks what a starting point is missing and sends nothing', async () => {
    const { calls } = openPage()
    await page()
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Edit starting points' }))
    const sheet = await setupSheet('Starting points')
    await user.click(sheet.getByRole('button', { name: 'Save starting point' }))
    expect(sheet.getByText('Choose an exercise.')).toBeVisible()
    expect(sheet.getByText('Enter a weight above zero.')).toBeVisible()
    expect(sheet.getByText('Enter a whole number of reps.')).toBeVisible()
    expect(sheet.getByLabelText('Exercise')).toHaveAttribute('aria-invalid', 'true')
    expect(calls.some((call) => call.method === 'PUT')).toBe(false)
  })

  test('shows what the server said when a part could not be saved, and keeps the entries', async () => {
    openPage({
      routes: {
        'PUT /api/strength/settings': () => ({
          status: 400,
          body: { error: { code: 'validation', message: 'List each kind of equipment once.' } },
        }),
      },
    })
    await page()
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Edit lifting history' }))
    const sheet = await setupSheet('Lifting history')
    await user.click(sheet.getByRole('radio', { name: 'New' }))
    await user.click(sheet.getByRole('button', { name: 'Save' }))
    expect(await sheet.findByRole('alert')).toHaveTextContent(
      'The setup was not saved. List each kind of equipment once. Try again.',
    )
    expect(sheet.getByRole('radio', { name: 'New' })).toBeChecked()
  })
})

describe('the Strength page: equipment and units (design 11.3, 6.5, 11.4)', () => {
  test('shows what is saved of each part, with a button to change it at any time', async () => {
    openPage({
      view: pageView({
        settings: {
          ...STRENGTH_SETTINGS,
          avoid: ['leg-curl'],
          pinned: { knee: 'goblet-squat' },
        },
        anchors: [
          {
            exerciseId: 'back-squat',
            kind: 'max',
            loadG: lb(185),
            reps: 1,
            rir: null,
            asOf: '2026-03-01',
          },
        ],
      }),
    })
    await page('Equipment and units')
    const units = region('Equipment and units')
    expect(
      units.getByText('Barbell, plates and a rack, Dumbbells, Bands, A step or box'),
    ).toBeVisible()
    expect(units.getByText('Some, lifting now: Yes')).toBeVisible()
    expect(units.getByText('Left out: Leg curl. Always used: Goblet squat.')).toBeVisible()
    expect(units.getByText('Back squat')).toBeVisible()
    for (const name of [
      'Edit equipment',
      'Edit lifting history',
      'Edit exercises',
      'Edit starting points',
    ]) {
      expect(units.getByRole('button', { name })).toBeEnabled()
    }
  })

  test('says nothing is saved before the setup, and lists the injuries of the Profile with a link', async () => {
    openPage({ view: unsavedView() })
    await page('Equipment and units')
    const units = region('Equipment and units')
    expect(units.getByText('None saved, so workouts are bodyweight only.')).toBeVisible()
    expect(units.getByText('Not set yet.')).toBeVisible()
    expect(units.getByText('No starting points are saved.')).toBeVisible()
    expect(await units.findByText('On the Profile: left knee.')).toBeVisible()
    expect(units.getByRole('link', { name: 'Open the Profile' })).toHaveAttribute(
      'href',
      '/profile',
    )
  })

  test('says so when the Profile records no injury', async () => {
    openPage({ routes: { 'GET /api/profile': () => ({ ...PROFILE, injuries: [] }) } })
    await page('Equipment and units')
    expect(
      await region('Equipment and units').findByText('None are recorded on the Profile.'),
    ).toBeVisible()
  })

  test('the weight unit is saved by the settings route and every load follows it at once', async () => {
    let settings = SETTINGS
    const { calls } = openPage({
      routes: {
        'GET /api/settings': () => settings,
        'PUT /api/settings': ({ body }) => {
          settings = { ...settings, ...(body as object) }
          return settings
        },
      },
    })
    await page('Equipment and units')
    const user = userEvent.setup()
    expect(region('Next session').getByText(/Suggested 110 lb, four sets/)).toBeVisible()
    const group = screen.getByRole('radiogroup', { name: 'Weight units' })
    expect(within(group).getByRole('radio', { name: 'Pounds' })).toBeChecked()
    await user.click(within(group).getByRole('radio', { name: 'Kilograms' }))
    expect(await screen.findByText('Weight unit saved')).toBeVisible()
    expect(calls.filter((call) => call.method === 'PUT').map((call) => call.body)).toEqual([
      { weightUnit: 'kg' },
    ])
    expect(within(group).getByRole('radio', { name: 'Kilograms' })).toBeChecked()
    // the workout, the lifts and the history are the same grams in the new unit
    expect(region('Next session').getByText(/Suggested 50 kg, four sets/)).toBeVisible()
    expect(region('Lifts').getByText('about 56.75 kg')).toBeVisible()
    expect(screen.queryByText(/ lb\b/)).not.toBeInTheDocument()
  })

  test('puts the unit back and says so when it could not be saved', async () => {
    openPage({ routes: { 'PUT /api/settings': () => unreachable } })
    await page('Equipment and units')
    const user = userEvent.setup()
    const group = screen.getByRole('radiogroup', { name: 'Weight units' })
    await user.click(within(group).getByRole('radio', { name: 'Kilograms' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The weight unit was not saved. Try again.',
    )
    expect(within(group).getByRole('radio', { name: 'Pounds' })).toBeChecked()
    expect(region('Next session').getByText(/Suggested 110 lb, four sets/)).toBeVisible()
  })
})

describe('the Strength page: about (design 4.5, 11.3)', () => {
  test('says what the programme does and does not claim, with the grades from the Params and the safety line', async () => {
    openPage()
    await page('About strength work')
    const about = region('About strength work')
    expect(
      about.getByText(
        'Strength work may lower the oxygen cost of running by about 2 to 4% after a full block. That is small, and it says nothing about race time.',
      ),
    ).toBeVisible()
    expect(
      about.getByText(
        'Heavy loads have the strongest support, and jumps help most at slower paces.',
      ),
    ).toBeVisible()
    expect(
      about.getByText(
        'The evidence for ultra runners is thin, so the loads and sets are defaults, not findings.',
      ),
    ).toBeVisible()
    expect(
      about.getByText(
        'Nothing here predicts an injury, and strength work is not claimed to prevent one.',
      ),
    ).toBeVisible()
    const grades = about.getByRole('list')
    expect(
      within(grades)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual([
      `Oxygen cost of runningEvidence grade ${P.f7.expectedBenefitPct.grade}`,
      `Heavy loadsEvidence grade ${P.flib.heavyMinPct1rm.grade}`,
      `Sets, reps and ramp-in lengthEvidence grade ${P.flib.heavySets.grade}`,
    ])
    expect(P.flib.heavySets.grade).toBe('D')
    expect(
      about.getByText(
        'Grade D means a default: a cautious choice that no trial in runners has tested.',
      ),
    ).toBeVisible()
    expect(
      about.getByText(
        'Stop a set if anything hurts or form changes. Learn barbell lifts from a coach before adding load.',
      ),
    ).toBeVisible()
  })
})

describe('the Strength page: the copy', () => {
  test('passes the lint with every section in view, in pounds and in kilograms', async () => {
    for (const settings of [SETTINGS, SETTINGS_KG]) {
      const { unmount } = (() => {
        openPage({
          settings,
          routes: { 'GET /api/strength/exercises/back-squat': () => squatHistory() },
        })
        return { unmount: () => cleanup() }
      })()
      await page()
      const user = userEvent.setup()
      await user.click(screen.getByRole('button', { name: 'History of Back squat' }))
      await screen.findByRole('region', { name: 'History of Back squat' })
      await screen.findByRole('img', { name: 'Estimated maximum, from submaximal sets' })
      expectCleanCopy(document.body)
      unmount()
    }
  })

  test('passes the lint with the setup unsaved, and with each sheet open', async () => {
    openPage({ view: unsavedView() })
    await page('Set up strength')
    expectCleanCopy(document.body)
    const user = userEvent.setup()
    for (const [button, title] of [
      ['Weight unit', 'Weight unit'],
      ['Equipment', 'Equipment'],
      ['Lifting history', 'Lifting history'],
      ['Exercises', 'Exercises'],
      ['Starting points', 'Starting points'],
    ] as const) {
      await user.click(region('Set up strength').getByRole('button', { name: button }))
      const dialog = await screen.findByRole('dialog', { name: title })
      if (title === 'Equipment') {
        for (const box of within(dialog).getAllByRole('checkbox')) await user.click(box)
      }
      expectCleanCopy(dialog)
      await user.click(within(dialog).getByRole('button', { name: 'Close' }))
      await waitFor(() => {
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      })
    }
  })

  test('puts no number in a sentence that is not a quantity of the runner', async () => {
    openPage()
    await page()
    // the page states no injury figure and no chance of one (G5)
    expect(document.body.textContent).not.toMatch(/injury (?:risk|probability|chance|odds)/i)
  })
})

describe('the stylesheets of the Strength page (design 11.7)', () => {
  const css = (file: string) => readFileSync(join(process.cwd(), 'web', file), 'utf8')

  test('a setup choice is a 44 px target and the sheets wrap instead of scrolling sideways', () => {
    const sheets = css('components/strength/SetupSheets.module.css')
    expect(sheets).toMatch(/\.check \{[^}]*min-height: 2\.75rem;/s)
    expect(sheets).toMatch(/safe-area-inset-bottom/)
    expect(sheets).not.toMatch(/overflow-x: scroll/)
  })

  test('the page links are 44 px targets, and the history table scrolls inside its own box', () => {
    const sections = css('components/strength/StrengthSections.module.css')
    expect(sections).toMatch(/\.link \{[^}]*min-height: 2\.75rem;/s)
    expect(sections).toMatch(/\.scroll \{[^}]*overflow: auto;/s)
    // the table wraps its cells to fit a phone, and still scrolls inside its box when it must
    expect(sections).not.toMatch(/\.table \{[^}]*min-width/s)
    // the section frame lets a long line wrap at 360 px
    expect(sections).toMatch(/\.section \{[^}]*min-width: 0;/s)
  })
})
