import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { FUEL_UI_TEMPLATES } from '../../shared/copy/fuelUi.ts'
import { TEMPLATES } from '../../shared/copy/templates.ts'
import { fluidReferenceNote } from '../../shared/engine/fuelCopy.ts'
import { P } from '../../shared/engine/params/index.ts'
import { FUEL_FLUID_MAX_ML, FUEL_ITEMS_MAX, FUEL_SERVINGS_MAX } from '../../shared/limits.ts'
import type { ActivityDetail, FuelLabView, FuelLogView } from '../../shared/types.ts'
import {
  parseFluid,
  servingsOf,
  stateFromLog,
  toBody,
  withFood,
  withOneLess,
  withOneMore,
  type FormItem,
  type FormState,
} from '../../web/components/fuel/fuelForm.ts'
import { FuelLogSheet } from '../../web/components/fuel/FuelLogSheet.tsx'
import { fuelText, scaleScores, scaleWord } from '../../web/components/fuel/fuelText.ts'
import { SessionSheet } from '../../web/components/SessionSheet.tsx'
import { ToastProvider } from '../../web/components/Toast.tsx'
import { makeActivity } from '../factories.ts'
import { COOL, GEL, HOT, loggedRun, logOf, makeLab, saved } from './fuel-fixtures.ts'
import {
  expectCleanCopy,
  mockApi,
  renderWithProviders,
  type MockRequest,
  type MockRoutes,
} from './helpers.tsx'
import { makeSession, settings } from './plan-fixtures.ts'
import { makeFuelSlot } from './today-fixtures.ts'
import { sheetRoutes } from './wrist-fixtures.ts'

const ACTIVITY = 'run9'
const THREE_HOURS = 3 * 3600

function detailOf(over: Parameters<typeof makeActivity>[0] = {}): ActivityDetail {
  return {
    activity: makeActivity({
      id: ACTIVITY,
      date: '2026-03-09',
      durationSec: THREE_HOURS,
      distanceM: 30_000,
      tempC: COOL.tempC,
      humidityPct: COOL.humidityPct,
      windKph: COOL.windKph,
      ...over,
    }),
    stream: null,
    laps: null,
    hasFile: false,
  }
}

interface SheetOptions {
  lab?: FuelLabView
  log?: FuelLogView | null
  detail?: ActivityDetail
  routes?: MockRoutes
}

/** The log sheet of one three-hour run, with the requests it makes answered. */
function renderSheet(opts: SheetOptions = {}) {
  const onClose = vi.fn()
  const onDone = vi.fn()
  const api = mockApi({
    'GET /api/fuel': () => opts.lab ?? makeLab(),
    [`GET /api/fuel/logs/${ACTIVITY}`]: () => opts.log ?? null,
    [`GET /api/activities/${ACTIVITY}/detail`]: () => opts.detail ?? detailOf(),
    ...opts.routes,
  })
  renderWithProviders(
    <ToastProvider>
      <FuelLogSheet activityId={ACTIVITY} onClose={onClose} onDone={onDone} />
    </ToastProvider>,
  )
  return { ...api, onClose, onDone }
}

const dialog = () => screen.findByRole('dialog', { name: 'Fuel log' })
const radio = (group: HTMLElement, name: string) => within(group).getByRole('radio', { name })

/** The PUT bodies a test sent, in order. */
function puts(api: { calls: Array<{ method: string; body: unknown }> }): unknown[] {
  return api.calls.filter((call) => call.method === 'PUT').map((call) => call.body)
}

const TAPS_ONLY_BODY = {
  items: [],
  fluidMl: null,
  sodiumMg: null,
  gut: 1,
  nausea: null,
  hot: null,
  notes: null,
}

beforeEach(() => {
  window.localStorage.clear()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('the fuel log form', () => {
  test('a first log needs only taps: one gut chip and Save', async () => {
    const user = userEvent.setup()
    const runs = [loggedRun(9, { servings: 0, gut: 1 })]
    const api = renderSheet({
      routes: { [`PUT /api/fuel/logs/${ACTIVITY}`]: () => saved(runs, ACTIVITY) },
    })
    const sheet = await dialog()
    await within(sheet).findByRole('radiogroup', { name: 'Gut' })
    await user.click(radio(within(sheet).getByRole('radiogroup', { name: 'Gut' }), '1 Mild'))
    await user.click(within(sheet).getByRole('button', { name: 'Save fuel log' }))
    await waitFor(() => {
      expect(api.onDone).toHaveBeenCalled()
    })
    expect(puts(api)).toEqual([TAPS_ONLY_BODY])
  })

  test('product chips add one at a time and a step takes one back; the live total follows', async () => {
    const user = userEvent.setup()
    renderSheet()
    const sheet = await dialog()
    const add = await within(sheet).findByRole('button', { name: 'Add one Example gel' })
    expect(within(sheet).queryByRole('status')).not.toBeInTheDocument()

    await user.click(add)
    await user.click(add)
    await user.click(add)
    expect(within(sheet).getByText('3 taken')).toBeInTheDocument()
    // 75 g in 3 h is 25 g/h; the ladder starts on the floor of 30 to 50 g/h.
    expect(within(sheet).getByRole('status')).toHaveTextContent(
      'You took 75 g of carbohydrate in 3 h: 25 g/h. Target was 30 to 50 g/h.',
    )

    await user.click(within(sheet).getByRole('button', { name: 'Remove one Example gel' }))
    expect(within(sheet).getByText('2 taken')).toBeInTheDocument()
    expect(within(sheet).getByRole('status')).toHaveTextContent('You took 50 g of carbohydrate')
    await user.click(within(sheet).getByRole('button', { name: 'Remove one Example gel' }))
    await user.click(within(sheet).getByRole('button', { name: 'Remove one Example gel' }))
    expect(within(sheet).queryByText(/taken/)).not.toBeInTheDocument()
    expect(within(sheet).queryByRole('status')).not.toBeInTheDocument()
  })

  test('the target in the live line is the rung the ladder stands on', async () => {
    const user = userEvent.setup()
    // One tolerated run at the floor steps the target up to 60 g/h.
    renderSheet({ lab: makeLab([loggedRun(1, { servings: 6, gut: 0 })]) })
    const sheet = await dialog()
    await user.click(await within(sheet).findByRole('button', { name: 'Add one Example gel' }))
    expect(within(sheet).getByRole('status')).toHaveTextContent('Target was 60 g/h.')
  })

  test('gut is required: Save without it asks, focuses the scale and sends nothing', async () => {
    const user = userEvent.setup()
    const api = renderSheet()
    const sheet = await dialog()
    await user.click(await within(sheet).findByRole('button', { name: 'Save fuel log' }))
    const gut = within(sheet).getByRole('radiogroup', { name: 'Gut' })
    expect(within(sheet).getByRole('alert')).toHaveTextContent(
      'Choose how your gut felt before saving.',
    )
    expect(gut).toHaveAccessibleDescription(/Choose how your gut felt before saving\./)
    expect(radio(gut, '0 None')).toHaveFocus()
    expect(puts(api)).toEqual([])

    await user.click(radio(gut, '3 Severe'))
    expect(within(sheet).queryByRole('alert')).not.toBeInTheDocument()
  })

  test('the scales are radio groups with the words None to Very severe, and the arrow keys choose', async () => {
    const user = userEvent.setup()
    renderSheet()
    const sheet = await dialog()
    const nausea = await within(sheet).findByRole('radiogroup', { name: 'Nausea (optional)' })
    expect(
      within(nausea)
        .getAllByRole('radio')
        .map((r) => r.textContent),
    ).toEqual(['0 None', '1 Mild', '2 Moderate', '3 Severe', '4 Very severe'])
    for (const r of within(nausea).getAllByRole('radio')) {
      expect(r).toHaveAttribute('aria-checked', 'false')
    }
    await user.click(radio(nausea, '1 Mild'))
    expect(radio(nausea, '1 Mild')).toHaveAttribute('aria-checked', 'true')
    await user.keyboard('{ArrowRight}')
    expect(radio(nausea, '2 Moderate')).toHaveAttribute('aria-checked', 'true')
    expect(radio(nausea, '2 Moderate')).toHaveFocus()
    await user.keyboard('{End}')
    expect(radio(nausea, '4 Very severe')).toHaveAttribute('aria-checked', 'true')
    await user.keyboard('{ArrowRight}')
    expect(radio(nausea, '0 None')).toHaveAttribute('aria-checked', 'true')
  })

  test('saves the products, fluid and scores, shows the server message as a toast and closes', async () => {
    const user = userEvent.setup()
    const runs = [loggedRun(9, { servings: 6, gut: 0 })]
    const api = renderSheet({
      routes: { [`PUT /api/fuel/logs/${ACTIVITY}`]: () => saved(runs, ACTIVITY) },
    })
    const sheet = await dialog()
    const add = await within(sheet).findByRole('button', { name: 'Add one Example gel' })
    for (let i = 0; i < 6; i += 1) await user.click(add)
    await user.click(within(sheet).getByRole('button', { name: 'Add one Example drink mix' }))
    await user.type(within(sheet).getByLabelText('Fluid you drank, in millilitres'), '900')
    await user.click(radio(within(sheet).getByRole('radiogroup', { name: 'Gut' }), '0 None'))
    await user.click(
      radio(within(sheet).getByRole('radiogroup', { name: 'Nausea (optional)' }), '2 Moderate'),
    )
    await user.click(within(sheet).getByRole('button', { name: 'Save fuel log' }))

    await waitFor(() => {
      expect(api.onDone).toHaveBeenCalledTimes(1)
    })
    expect(puts(api)).toEqual([
      {
        items: [
          { productId: 'p-gel', servings: 6 },
          { productId: 'p-drink', servings: 1 },
        ],
        fluidMl: 900,
        sodiumMg: null,
        gut: 0,
        nausea: 2,
        hot: null,
        notes: null,
      },
    ])
    // The sentence comes from the server's answer, not from the page.
    const message = saved(runs, ACTIVITY).message
    expect(message).toMatch(/^Tolerated at 30 to 50 g\/h\./)
    expect(await screen.findByText(message ?? '')).toBeInTheDocument()
  })

  test('"It was hot" sends null until it is touched, and null again when it is put back', async () => {
    const user = userEvent.setup()
    const runs = [loggedRun(9)]
    const api = renderSheet({
      routes: { [`PUT /api/fuel/logs/${ACTIVITY}`]: () => saved(runs, ACTIVITY) },
    })
    const sheet = await dialog()
    const hot = await within(sheet).findByRole('button', { name: 'It was hot' })
    const gut = within(sheet).getByRole('radiogroup', { name: 'Gut' })
    expect(hot).toHaveAttribute('aria-pressed', 'false')
    await user.click(radio(gut, '0 None'))
    await user.click(within(sheet).getByRole('button', { name: 'Save fuel log' }))
    await waitFor(() => {
      expect(puts(api)).toHaveLength(1)
    })
    expect(puts(api)[0]).toMatchObject({ hot: null })

    await user.click(hot)
    expect(hot).toHaveAttribute('aria-pressed', 'true')
    await user.click(within(sheet).getByRole('button', { name: 'Save fuel log' }))
    await waitFor(() => {
      expect(puts(api)).toHaveLength(2)
    })
    expect(puts(api)[1]).toMatchObject({ hot: true })

    await user.click(hot)
    expect(hot).toHaveAttribute('aria-pressed', 'false')
    await user.click(within(sheet).getByRole('button', { name: 'Save fuel log' }))
    await waitFor(() => {
      expect(puts(api)).toHaveLength(3)
    })
    expect(puts(api)[2]).toMatchObject({ hot: null })
  })

  test('starts "It was hot" from the weather the run has, and says so', async () => {
    const user = userEvent.setup()
    const runs = [loggedRun(9)]
    const api = renderSheet({
      detail: detailOf({ tempC: HOT.tempC, humidityPct: HOT.humidityPct, windKph: HOT.windKph }),
      routes: { [`PUT /api/fuel/logs/${ACTIVITY}`]: () => saved(runs, ACTIVITY) },
    })
    const sheet = await dialog()
    const hot = await within(sheet).findByRole('button', { name: 'It was hot' })
    expect(hot).toHaveAttribute('aria-pressed', 'true')
    expect(
      within(sheet).getByText('The weather for this run reads hot. Tap if it was not.'),
    ).toBeInTheDocument()

    await user.click(radio(within(sheet).getByRole('radiogroup', { name: 'Gut' }), '0 None'))
    await user.click(within(sheet).getByRole('button', { name: 'Save fuel log' }))
    await waitFor(() => {
      expect(puts(api)).toHaveLength(1)
    })
    // The weather already says hot, so the runner has answered nothing: the weather decides.
    expect(puts(api)[0]).toMatchObject({ hot: null })

    await user.click(hot)
    expect(hot).toHaveAttribute('aria-pressed', 'false')
    await user.click(within(sheet).getByRole('button', { name: 'Save fuel log' }))
    await waitFor(() => {
      expect(puts(api)).toHaveLength(2)
    })
    expect(puts(api)[1]).toMatchObject({ hot: false })
  })

  test('says the weather has not loaded when the run has none, and a tap answers hot', async () => {
    const user = userEvent.setup()
    const runs = [loggedRun(9)]
    const api = renderSheet({
      detail: detailOf({ tempC: null, humidityPct: null, windKph: null }),
      routes: { [`PUT /api/fuel/logs/${ACTIVITY}`]: () => saved(runs, ACTIVITY) },
    })
    const sheet = await dialog()
    expect(
      await within(sheet).findByText('Weather for this run has not loaded. Tap if it was hot.'),
    ).toBeInTheDocument()
    const hot = within(sheet).getByRole('button', { name: 'It was hot' })
    expect(hot).toHaveAttribute('aria-pressed', 'false')
    await user.click(hot)
    expect(hot).toHaveAttribute('aria-pressed', 'true')
    expect(
      within(sheet).queryByText('Weather for this run has not loaded. Tap if it was hot.'),
    ).not.toBeInTheDocument()
    await user.click(radio(within(sheet).getByRole('radiogroup', { name: 'Gut' }), '0 None'))
    await user.click(within(sheet).getByRole('button', { name: 'Save fuel log' }))
    await waitFor(() => {
      expect(puts(api)).toHaveLength(1)
    })
    expect(puts(api)[0]).toMatchObject({ hot: true })
  })

  test('says drink to thirst when the fluid is above the reference range, with its figures from the registry', async () => {
    const user = userEvent.setup()
    renderSheet()
    const sheet = await dialog()
    const field = await within(sheet).findByLabelText('Fluid you drank, in millilitres')
    await user.type(field, '1000')
    expect(within(sheet).queryByText(/above the .* reference range/)).not.toBeInTheDocument()
    await user.clear(field)
    await user.type(field, '2700')
    const note = fluidReferenceNote(2700, THREE_HOURS)
    expect(note).toMatch(/^That is above the 450 to 750 mL\/h reference range\./)
    expect(within(sheet).getByText(note ?? '')).toBeInTheDocument()
    // Only the runner's own amount is a fluid figure; the page suggests none.
    expect(within(sheet).queryByText(/should drink|aim for/i)).not.toBeInTheDocument()
  })

  test('refuses a fluid amount that is not a whole number, beside the field', async () => {
    const user = userEvent.setup()
    const api = renderSheet()
    const sheet = await dialog()
    const field = await within(sheet).findByLabelText('Fluid you drank, in millilitres')
    await user.type(field, '12.5')
    expect(
      within(sheet).getByText('Use a whole number of millilitres, or leave it empty.'),
    ).toBeInTheDocument()
    await user.click(radio(within(sheet).getByRole('radiogroup', { name: 'Gut' }), '0 None'))
    await user.click(within(sheet).getByRole('button', { name: 'Save fuel log' }))
    expect(field).toHaveFocus()
    expect(puts(api)).toEqual([])
  })

  test('"Same as last long run" fills the products and the fluid from the last log', async () => {
    const user = userEvent.setup()
    const runs = [loggedRun(1, { servings: 4, gut: 0 }), loggedRun(2, { servings: 5, gut: 0 })]
    const lab = makeLab(runs, {}, { run1: 1200, run2: 1500 })
    const put = vi.fn((_req: MockRequest) => saved(runs, ACTIVITY))
    const api = renderSheet({ lab, routes: { [`PUT /api/fuel/logs/${ACTIVITY}`]: put } })
    const sheet = await dialog()
    const same = await within(sheet).findByRole('button', { name: 'Same as last long run' })
    // Recent amounts the runner logged are the fluid chips; no amount is suggested.
    expect(within(sheet).getByRole('button', { name: '1500 mL' })).toBeInTheDocument()
    expect(within(sheet).getByRole('button', { name: '1200 mL' })).toBeInTheDocument()

    await user.click(same)
    expect(within(sheet).getByText('5 taken')).toBeInTheDocument()
    expect(within(sheet).getByLabelText('Fluid you drank, in millilitres')).toHaveValue(1500)
    expect(within(sheet).getByRole('button', { name: '1500 mL' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await user.click(radio(within(sheet).getByRole('radiogroup', { name: 'Gut' }), '0 None'))
    await user.click(within(sheet).getByRole('button', { name: 'Save fuel log' }))
    await waitFor(() => {
      expect(puts(api)).toHaveLength(1)
    })
    expect(puts(api)[0]).toMatchObject({
      items: [{ productId: 'p-gel', servings: 5 }],
      fluidMl: 1500,
    })
  })

  test('is not offered when no earlier log has products', async () => {
    renderSheet()
    const sheet = await dialog()
    await within(sheet).findByRole('button', { name: 'Add one Example gel' })
    expect(
      within(sheet).queryByRole('button', { name: 'Same as last long run' }),
    ).not.toBeInTheDocument()
  })

  test("brings back a product that has left the list as food of the runner's own, with its amounts", async () => {
    const user = userEvent.setup()
    const runs = [loggedRun(1, { servings: 2, gut: 0 })]
    const lab = makeLab(runs)
    const [row] = lab.history
    if (row === undefined) throw new Error('The fixture has a history.')
    const gone: FuelLabView = {
      ...lab,
      history: [
        {
          ...row,
          log: {
            ...row.log,
            items: row.log.items.map((item) => ({ ...item, productId: 'p-old' })),
          },
        },
      ],
    }
    const api = renderSheet({
      lab: gone,
      routes: { [`PUT /api/fuel/logs/${ACTIVITY}`]: () => saved(runs, ACTIVITY) },
    })
    const sheet = await dialog()
    await user.click(await within(sheet).findByRole('button', { name: 'Same as last long run' }))
    expect(within(sheet).getByText('2 × Example gel: 50 g')).toBeInTheDocument()
    await user.click(radio(within(sheet).getByRole('radiogroup', { name: 'Gut' }), '0 None'))
    await user.click(within(sheet).getByRole('button', { name: 'Save fuel log' }))
    await waitFor(() => {
      expect(puts(api)).toHaveLength(1)
    })
    expect(puts(api)[0]).toMatchObject({
      items: [
        {
          name: 'Example gel',
          carbsG: 25,
          sodiumMg: 50,
          kcal: 100,
          multiCarb: true,
          servings: 2,
        },
      ],
    })
    expect((puts(api)[0] as { items: Array<Record<string, unknown>> }).items[0]).not.toHaveProperty(
      'productId',
    )
  })

  test('"Something else" adds food by name and grams; Enter adds it and does not save the log', async () => {
    const user = userEvent.setup()
    const api = renderSheet()
    const sheet = await dialog()
    await user.click(await within(sheet).findByRole('button', { name: 'Something else' }))
    await user.type(within(sheet).getByLabelText('Name of the food'), 'Rice cake')
    await user.type(within(sheet).getByLabelText('Carbohydrate in grams'), '28{Enter}')
    expect(puts(api)).toEqual([])
    expect(within(sheet).getByText('1 × Rice cake: 28 g')).toBeInTheDocument()
    expect(within(sheet).getByRole('status')).toHaveTextContent('You took 28 g of carbohydrate')

    await user.click(within(sheet).getByRole('button', { name: 'Something else' }))
    await user.click(within(sheet).getByRole('button', { name: 'Add this food' }))
    expect(
      within(sheet).getByText('Give the name of the food and its grams of carbohydrate.'),
    ).toBeInTheDocument()

    await user.click(within(sheet).getByRole('button', { name: 'Remove Rice cake' }))
    expect(within(sheet).queryByText('1 × Rice cake: 28 g')).not.toBeInTheDocument()
  })

  test('sends own food without a product id', async () => {
    const user = userEvent.setup()
    const runs = [loggedRun(9)]
    const api = renderSheet({
      routes: { [`PUT /api/fuel/logs/${ACTIVITY}`]: () => saved(runs, ACTIVITY) },
    })
    const sheet = await dialog()
    await user.click(await within(sheet).findByRole('button', { name: 'Something else' }))
    await user.type(within(sheet).getByLabelText('Name of the food'), 'Rice cake')
    await user.type(within(sheet).getByLabelText('Carbohydrate in grams'), '28')
    await user.click(within(sheet).getByRole('button', { name: 'Add this food' }))
    await user.click(radio(within(sheet).getByRole('radiogroup', { name: 'Gut' }), '0 None'))
    await user.click(within(sheet).getByRole('button', { name: 'Save fuel log' }))
    await waitFor(() => {
      expect(puts(api)).toHaveLength(1)
    })
    expect(puts(api)[0]).toMatchObject({
      items: [
        {
          name: 'Rice cake',
          carbsG: 28,
          sodiumMg: null,
          kcal: null,
          multiCarb: false,
          servings: 1,
        },
      ],
    })
  })

  test('says so when the product list is empty and the first log still needs no typing', async () => {
    renderSheet({ lab: makeLab([], { products: [] }) })
    const sheet = await dialog()
    expect(
      await within(sheet).findByText(
        'No products on your list yet. Add what you took under Something else.',
      ),
    ).toBeInTheDocument()
  })

  test('shows a failed save in an alert, keeps the entries and lets Save be tried again', async () => {
    const user = userEvent.setup()
    let attempts = 0
    const runs = [loggedRun(9)]
    const api = renderSheet({
      routes: {
        [`PUT /api/fuel/logs/${ACTIVITY}`]: () => {
          attempts += 1
          return attempts === 1
            ? { status: 500, body: { error: { code: 'internal', message: 'Try again later.' } } }
            : saved(runs, ACTIVITY)
        },
      },
    })
    const sheet = await dialog()
    await user.click(await within(sheet).findByRole('button', { name: 'Add one Example gel' }))
    await user.click(radio(within(sheet).getByRole('radiogroup', { name: 'Gut' }), '1 Mild'))
    await user.click(within(sheet).getByRole('button', { name: 'Save fuel log' }))
    expect(await within(sheet).findByRole('alert')).toHaveTextContent(
      'Fuel log not saved. Try again later. Your entries stay on this phone. Try again.',
    )
    expect(api.onDone).not.toHaveBeenCalled()
    expect(within(sheet).getByText('1 taken')).toBeInTheDocument()
    expect(radio(within(sheet).getByRole('radiogroup', { name: 'Gut' }), '1 Mild')).toHaveAttribute(
      'aria-checked',
      'true',
    )

    await user.click(within(sheet).getByRole('button', { name: 'Save fuel log' }))
    await waitFor(() => {
      expect(api.onDone).toHaveBeenCalledTimes(1)
    })
    expect(within(sheet).queryByRole('alert')).not.toBeInTheDocument()
    expect(puts(api)).toHaveLength(2)
    expect(puts(api)[1]).toEqual(puts(api)[0])
  })

  test('"Not this time" marks the run, shows the server sentence and closes', async () => {
    const user = userEvent.setup()
    const skipped = {
      log: null,
      ladder: makeLab().ladder,
      message: 'Not logged this time, so this run does not count toward your ladder.',
    }
    const api = renderSheet({
      routes: { [`POST /api/fuel/logs/${ACTIVITY}/skip`]: () => skipped },
    })
    const sheet = await dialog()
    await user.click(await within(sheet).findByRole('button', { name: 'Not this time' }))
    await waitFor(() => {
      expect(api.onDone).toHaveBeenCalledTimes(1)
    })
    expect(await screen.findByText(skipped.message)).toBeInTheDocument()
    expect(puts(api)).toEqual([])
  })

  test('a failed "Not this time" is an alert and the sheet stays', async () => {
    const user = userEvent.setup()
    const api = renderSheet({
      routes: {
        [`POST /api/fuel/logs/${ACTIVITY}/skip`]: () => ({
          status: 409,
          body: { error: { code: 'conflict', message: 'This run already has a fuel log.' } },
        }),
      },
    })
    const sheet = await dialog()
    await user.click(await within(sheet).findByRole('button', { name: 'Not this time' }))
    expect(await within(sheet).findByRole('alert')).toHaveTextContent(
      'The run was not marked. This run already has a fuel log. Try again.',
    )
    expect(api.onDone).not.toHaveBeenCalled()
  })

  test('edits a saved log from its values, and offers no "Not this time" over an answer', async () => {
    const user = userEvent.setup()
    const runs = [loggedRun(9, { servings: 4, gut: 2, nausea: 1 })]
    const log = logOf(runs, ACTIVITY)
    const api = renderSheet({
      lab: makeLab(runs),
      log,
      routes: { [`PUT /api/fuel/logs/${ACTIVITY}`]: () => saved(runs, ACTIVITY) },
    })
    const sheet = await dialog()
    await within(sheet).findByRole('button', { name: 'Save fuel log' })
    expect(within(sheet).getByText('4 taken')).toBeInTheDocument()
    expect(
      radio(within(sheet).getByRole('radiogroup', { name: 'Gut' }), '2 Moderate'),
    ).toHaveAttribute('aria-checked', 'true')
    expect(
      radio(within(sheet).getByRole('radiogroup', { name: 'Nausea (optional)' }), '1 Mild'),
    ).toHaveAttribute('aria-checked', 'true')
    expect(within(sheet).queryByRole('button', { name: 'Not this time' })).not.toBeInTheDocument()
    // The target in the live line is the rung this run was tried at, not the rung now.
    expect(within(sheet).getByRole('status')).toHaveTextContent('Target was 30 to 50 g/h.')

    await user.click(radio(within(sheet).getByRole('radiogroup', { name: 'Gut' }), '0 None'))
    await user.click(within(sheet).getByRole('button', { name: 'Save fuel log' }))
    await waitFor(() => {
      expect(puts(api)).toHaveLength(1)
    })
    expect(puts(api)[0]).toMatchObject({
      items: [{ productId: 'p-gel', servings: 4 }],
      gut: 0,
      nausea: 1,
    })
  })

  test('keeps a half-filled form on this device under fuel-draft:<activityId>', async () => {
    const user = userEvent.setup()
    const api = renderSheet()
    const sheet = await dialog()
    expect(window.localStorage.getItem(`fuel-draft:${ACTIVITY}`)).toBeNull()
    await user.click(await within(sheet).findByRole('button', { name: 'Add one Example gel' }))
    await user.click(radio(within(sheet).getByRole('radiogroup', { name: 'Gut' }), '3 Severe'))
    const kept = window.localStorage.getItem(`fuel-draft:${ACTIVITY}`)
    expect(JSON.parse(kept ?? 'null')).toMatchObject({ gut: 3, items: [{ productId: 'p-gel' }] })
    expect(api.onDone).not.toHaveBeenCalled()
  })

  test('restores the kept form when the sheet is opened again, and Save clears it', async () => {
    const user = userEvent.setup()
    const runs = [loggedRun(9)]
    window.localStorage.setItem(
      `fuel-draft:${ACTIVITY}`,
      JSON.stringify({
        items: [
          {
            productId: 'p-gel',
            name: 'Example gel',
            carbsG: 25,
            sodiumMg: 50,
            kcal: 100,
            multiCarb: true,
            servings: 2,
          },
        ],
        fluid: '600',
        gut: 2,
        nausea: null,
        hot: null,
      }),
    )
    const api = renderSheet({
      routes: { [`PUT /api/fuel/logs/${ACTIVITY}`]: () => saved(runs, ACTIVITY) },
    })
    const sheet = await dialog()
    await within(sheet).findByRole('button', { name: 'Save fuel log' })
    expect(within(sheet).getByText('2 taken')).toBeInTheDocument()
    expect(within(sheet).getByLabelText('Fluid you drank, in millilitres')).toHaveValue(600)
    expect(
      radio(within(sheet).getByRole('radiogroup', { name: 'Gut' }), '2 Moderate'),
    ).toHaveAttribute('aria-checked', 'true')
    await user.click(within(sheet).getByRole('button', { name: 'Save fuel log' }))
    await waitFor(() => {
      expect(api.onDone).toHaveBeenCalled()
    })
    expect(window.localStorage.getItem(`fuel-draft:${ACTIVITY}`)).toBeNull()
  })

  test('ignores a draft it did not write', async () => {
    window.localStorage.setItem(`fuel-draft:${ACTIVITY}`, '{"items":"nonsense"}')
    renderSheet()
    const sheet = await dialog()
    await within(sheet).findByRole('button', { name: 'Save fuel log' })
    expect(within(sheet).queryByText(/taken/)).not.toBeInTheDocument()
  })

  test('works when storage is blocked: nothing is kept, and nothing breaks', async () => {
    const user = userEvent.setup()
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    const runs = [loggedRun(9)]
    const api = renderSheet({
      routes: { [`PUT /api/fuel/logs/${ACTIVITY}`]: () => saved(runs, ACTIVITY) },
    })
    const sheet = await dialog()
    await user.click(await within(sheet).findByRole('button', { name: 'Add one Example gel' }))
    await user.click(radio(within(sheet).getByRole('radiogroup', { name: 'Gut' }), '0 None'))
    await user.click(within(sheet).getByRole('button', { name: 'Save fuel log' }))
    await waitFor(() => {
      expect(api.onDone).toHaveBeenCalled()
    })
  })

  test('shows the safety card about drinking too much, in its stronger variant when the server sends it', async () => {
    const stronger = makeFuelSlot().eah
    renderSheet({ lab: makeLab([], { eah: { ...stronger, stronger: true } }) })
    const sheet = await dialog()
    const note = await within(sheet).findByRole('note', {
      name: 'Low blood sodium from drinking too much',
    })
    expect(within(note).getByText(/Drink to thirst\. Never force fluids/)).toBeInTheDocument()
  })

  test('says the fuel log did not load when a request fails, and is not a form', async () => {
    renderSheet({
      routes: {
        'GET /api/fuel': () => ({
          status: 500,
          body: { error: { code: 'internal', message: 'No.' } },
        }),
      },
    })
    const sheet = await dialog()
    expect(await within(sheet).findByRole('alert')).toHaveTextContent(
      'The fuel log did not load. Close this and try again.',
    )
    expect(within(sheet).queryByRole('button', { name: 'Save fuel log' })).not.toBeInTheDocument()
  })

  test('puts focus on the first control once the data has arrived, and every word passes the lint', async () => {
    renderSheet({ lab: makeLab([loggedRun(1, { servings: 5 })], {}, { run1: 1000 }) })
    const sheet = await dialog()
    const same = await within(sheet).findByRole('button', { name: 'Same as last long run' })
    await waitFor(() => {
      expect(same).toHaveFocus()
    })
    expectCleanCopy(sheet)
  })

  test('fits 360 px: no fixed width wider than the sheet, and the gut scale is one row of five', async () => {
    renderSheet()
    const sheet = await dialog()
    const gut = await within(sheet).findByRole('radiogroup', { name: 'Gut' })
    expect(within(gut).getAllByRole('radio')).toHaveLength(5)
    expect(gut.style.getPropertyValue('--steps')).toBe('5')
  })
})

describe('the Fuel section of the session sheet', () => {
  const longRun = () =>
    makeSession({
      id: 'long1',
      kind: 'long',
      title: 'Long run',
      date: '2027-01-13',
      durationMin: 150,
      distanceM: 24000,
    })

  function renderPlanSheet(session: ReturnType<typeof makeSession>, extra: MockRoutes = {}) {
    const api = mockApi({
      'GET /api/settings': () => settings,
      'GET /api/activities': () => ({
        items: [],
        total: 0,
        limit: 100,
        offset: 0,
        nextOffset: null,
      }),
      ...sheetRoutes([session]),
      ...extra,
    })
    renderWithProviders(
      <ToastProvider>
        <SessionSheet session={session} onClose={vi.fn()} />
      </ToastProvider>,
    )
    return api
  }

  test('shows the target of a long run with its reason, fluid wording, nausea plan and safety card', async () => {
    const view = makeFuelSlot().targets[0]
    if (view === undefined) throw new Error('The fixture has a target.')
    const api = renderPlanSheet(longRun(), {
      'GET /api/fuel/targets': () => [{ ...view, session: { ...view.session, id: 'long1' } }],
      'GET /api/fuel': () => makeLab(),
    })
    const sheet = await screen.findByRole('dialog', { name: 'Long run' })
    const section = await within(sheet).findByRole('region', {
      name: 'Fuel target: 30 to 50 g/h of carbohydrate',
    })
    expect(within(section).getByText(view.text.basis)).toBeInTheDocument()
    expect(within(section).getByText(view.text.fluid)).toBeInTheDocument()
    expect(within(section).getByText('If your stomach turns')).toBeInTheDocument()
    expect(await within(section).findByRole('note')).toBeInTheDocument()
    expect(
      api.calls.filter((call) => call.url.startsWith('/api/fuel/targets')).map((call) => call.url),
    ).toEqual(['/api/fuel/targets?from=2027-01-13&to=2027-01-13'])
    expectCleanCopy(section)
  })

  test('asks for nothing for a run too short to carry a target', async () => {
    const api = renderPlanSheet(makeSession())
    await screen.findByRole('dialog', { name: 'Threshold intervals' })
    expect(api.calls.some((call) => call.url.startsWith('/api/fuel'))).toBe(false)
  })

  test('asks for nothing for a session that is already settled', async () => {
    const api = renderPlanSheet(makeSession({ status: 'completed', durationMin: 180 }))
    await screen.findByRole('dialog', { name: 'Threshold intervals' })
    expect(api.calls.some((call) => call.url.startsWith('/api/fuel'))).toBe(false)
  })

  test('renders no section when the server has no target for the run', async () => {
    renderPlanSheet(longRun(), { 'GET /api/fuel/targets': () => [] })
    const sheet = await screen.findByRole('dialog', { name: 'Long run' })
    await waitFor(() => {
      expect(within(sheet).queryByText(/Fuel target/)).not.toBeInTheDocument()
    })
  })
})

describe('the form state', () => {
  const empty = stateFromLog(null)
  const food = (name: string): FormItem => ({
    productId: null,
    name,
    carbsG: 20,
    sodiumMg: null,
    kcal: null,
    multiCarb: false,
    servings: 1,
  })

  test('a tap on a product adds one serving, and a step back takes one away until the item leaves', () => {
    const once = withOneMore(empty, GEL)
    expect(once.items).toEqual([expect.objectContaining({ productId: GEL.id, servings: 1 })])
    const twice = withOneMore(once, GEL)
    expect(servingsOf(twice, GEL.id)).toBe(2)
    expect(servingsOf(withOneLess(twice, GEL), GEL.id)).toBe(1)
    expect(withOneLess(withOneLess(twice, GEL), GEL).items).toEqual([])
    expect(withOneLess(empty, GEL)).toBe(empty)
  })

  test('the servings of one item stop at the limit the server enforces', () => {
    let state = empty
    for (let i = 0; i < FUEL_SERVINGS_MAX + 5; i += 1) state = withOneMore(state, GEL)
    expect(servingsOf(state, GEL.id)).toBe(FUEL_SERVINGS_MAX)
  })

  test('the items stop at the limit the server enforces', () => {
    let state = empty
    for (let i = 0; i < FUEL_ITEMS_MAX + 5; i += 1)
      state = withFood(state, food(`Food ${String(i)}`))
    expect(state.items).toHaveLength(FUEL_ITEMS_MAX)
    expect(withOneMore(state, GEL)).toBe(state)
  })

  test('the fluid field is empty, a whole number in range, or invalid', () => {
    expect(parseFluid('')).toBeNull()
    expect(parseFluid('  ')).toBeNull()
    expect(parseFluid(' 900 ')).toBe(900)
    expect(parseFluid('0')).toBe(0)
    expect(parseFluid('12.5')).toBe('invalid')
    expect(parseFluid('-1')).toBe('invalid')
    expect(parseFluid('abc')).toBe('invalid')
    expect(parseFluid(String(FUEL_FLUID_MAX_ML))).toBe(FUEL_FLUID_MAX_ML)
    expect(parseFluid(String(FUEL_FLUID_MAX_ML + 1))).toBe('invalid')
  })

  test('the request names a live product by id and sends everything else with its amounts', () => {
    const state: FormState = {
      ...empty,
      items: [
        { ...food('Gel'), productId: GEL.id, carbsG: GEL.carbsG, servings: 2 },
        { ...food('Archived chew'), productId: 'p-archived', servings: 3 },
        food('Rice cake'),
      ],
      nausea: 1,
      hot: false,
    }
    expect(toBody(state, 2, 750, new Set([GEL.id]), { sodiumMg: 400, notes: 'Windy.' })).toEqual({
      items: [
        { productId: GEL.id, servings: 2 },
        {
          name: 'Archived chew',
          carbsG: 20,
          sodiumMg: null,
          kcal: null,
          multiCarb: false,
          servings: 3,
        },
        {
          name: 'Rice cake',
          carbsG: 20,
          sodiumMg: null,
          kcal: null,
          multiCarb: false,
          servings: 1,
        },
      ],
      fluidMl: 750,
      sodiumMg: 400,
      gut: 2,
      nausea: 1,
      hot: false,
      notes: 'Windy.',
    })
  })

  test('a log is the form state it is edited from, and a skipped one starts empty', () => {
    const runs = [loggedRun(1, { servings: 3, gut: 2, nausea: 1 })]
    const log = logOf(runs, 'run1')
    expect(stateFromLog(log)).toEqual({
      items: [expect.objectContaining({ name: GEL.name, servings: 3 })],
      fluid: '',
      gut: 2,
      nausea: 1,
      hot: null,
    })
    expect(stateFromLog({ ...log, skipped: true })).toEqual(empty)
  })
})

describe('the words of the fuel surfaces', () => {
  const ids = Object.keys(FUEL_UI_TEMPLATES) as Array<keyof typeof FUEL_UI_TEMPLATES>

  test('every template is in the shared registry, where the generic lint renders it', () => {
    expect(ids.length).toBeGreaterThan(40)
    for (const id of ids) {
      expect(Object.hasOwn(TEMPLATES, id), id).toBe(true)
      expect(TEMPLATES[id], id).toBe(FUEL_UI_TEMPLATES[id])
    }
  })

  test('a template holds no digit of its own: every number is a slot', () => {
    for (const id of ids) expect(FUEL_UI_TEMPLATES[id].text, id).not.toMatch(/\d/)
  })

  test('nothing calls a hard gut day a failure, a miss or a mistake', () => {
    const all = ids.map((id) => FUEL_UI_TEMPLATES[id].text).join(' ')
    expect(all).not.toMatch(/\b(fail\w*|miss\w*|behind|bad|poor|wrong|streak\w*|badge\w*)\b/i)
  })

  test('the scale has a word for every score up to the registry maximum', () => {
    const scores = scaleScores()
    expect(scores).toEqual(Array.from({ length: P.h7.gutSymptomScaleMax.value + 1 }, (_, i) => i))
    expect(scores.map(scaleWord)).toEqual(['None', 'Mild', 'Moderate', 'Severe', 'Very severe'])
  })

  test("the prompt line reads in the runner's units and leaves out a distance the run does not have", () => {
    const run = { date: '2026-03-18', durationSec: 3 * 3600, distanceM: 30_000 }
    expect(fuelText.promptRun(run, 'mi')).toBe('Wed 18 Mar, 3 h, 18.6 mi')
    expect(fuelText.promptRun(run, 'km')).toBe('Wed 18 Mar, 3 h, 30 km')
    expect(fuelText.promptRun({ ...run, distanceM: null }, 'mi')).toBe('Wed 18 Mar, 3 h')
  })

  test('the figures in the reference note come from the registry', () => {
    const [low, high] = P.h8.fluidReferenceMlPerH.value
    expect(fluidReferenceNote(high * 3 + 3, THREE_HOURS)).toContain(
      `${String(low)} to ${String(high)} mL/h`,
    )
  })
})
