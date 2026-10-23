import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { FUEL_UI_TEMPLATES } from '../../shared/copy/fuelUi.ts'
import { TEMPLATES } from '../../shared/copy/templates.ts'
import { eahCard, fuelTargetFor, replayLadder } from '../../shared/engine/fuel.ts'
import {
  advancedLockedMessage,
  describeFuelTarget,
  fluidReferenceNote,
  fuelDisclaimer,
  gutConditionLock,
  gutTrainingText,
  rateText,
  rungStateLabel,
  stepNote,
} from '../../shared/engine/fuelCopy.ts'
import { P } from '../../shared/engine/params/index.ts'
import type { FuelRunInput, FuelSettingsInput } from '../../shared/engine/types.ts'
import { FUEL_FLUID_MAX_ML, FUEL_ITEMS_MAX, FUEL_SERVINGS_MAX } from '../../shared/limits.ts'
import type {
  ActivityDetail,
  FuelBlockView,
  FuelLabView,
  FuelLogView,
  FuelPrompt,
  FuelProduct,
  FuelSettings,
  FuelTargetView,
} from '../../shared/types.ts'
import { App } from '../../web/App.tsx'
import { Nav } from '../../web/components/Nav.tsx'
import { MorePage } from '../../web/pages/MorePage.tsx'
import { FuelLabPage } from '../../web/pages/FuelLabPage.tsx'
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
import { getOutbox } from '../../web/pwa/outbox.ts'
import { fuelText, scaleScores, scaleWord } from '../../web/components/fuel/fuelText.ts'
import { SessionSheet } from '../../web/components/SessionSheet.tsx'
import { ToastProvider } from '../../web/components/Toast.tsx'
import { makeActivity } from '../factories.ts'
import { COOL, DRINK, GEL, HOT, loggedRun, logOf, makeLab, saved } from './fuel-fixtures.ts'
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

  test('shows a refused save in an alert, keeps the entries and lets Save be tried again', async () => {
    const user = userEvent.setup()
    let attempts = 0
    const runs = [loggedRun(9)]
    const api = renderSheet({
      routes: {
        [`PUT /api/fuel/logs/${ACTIVITY}`]: () => {
          attempts += 1
          return attempts === 1
            ? { status: 400, body: { error: { code: 'validation', message: 'Try again later.' } } }
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

  test('with no connection the log is kept on this phone: it says so, closes and leaves the draft', async () => {
    const user = userEvent.setup()
    const api = renderSheet({
      routes: {
        [`PUT /api/fuel/logs/${ACTIVITY}`]: () => ({
          status: 503,
          body: { error: { code: 'internal', message: 'Offline.' } },
        }),
      },
    })
    const sheet = await dialog()
    await user.click(await within(sheet).findByRole('button', { name: 'Add one Example gel' }))
    await user.click(radio(within(sheet).getByRole('radiogroup', { name: 'Gut' }), '1 Mild'))
    await user.click(within(sheet).getByRole('button', { name: 'Save fuel log' }))
    await waitFor(() => {
      expect(api.onDone).toHaveBeenCalledTimes(1)
    })
    expect(await screen.findByText(fuelText.savedQueued())).toBeInTheDocument()
    expect(within(sheet).queryByRole('alert')).not.toBeInTheDocument()
    const queued = getOutbox().getState().entries
    expect(queued.map((entry) => entry.url)).toEqual([`/api/fuel/logs/${ACTIVITY}`])
    expect(queued[0]?.body).toMatchObject({ items: [{ productId: 'p-gel', servings: 1 }], gut: 1 })
    // What the outbox holds is the safe copy now; the draft would only shadow the server's log.
    expect(window.localStorage.getItem(`fuel-draft:${ACTIVITY}`)).toBeNull()
  })

  test('a log that reached the server shows the server sentence, not the phone one', async () => {
    const user = userEvent.setup()
    const runs = [loggedRun(9)]
    const answer = saved(runs, ACTIVITY)
    const api = renderSheet({ routes: { [`PUT /api/fuel/logs/${ACTIVITY}`]: () => answer } })
    const sheet = await dialog()
    await user.click(radio(await within(sheet).findByRole('radiogroup', { name: 'Gut' }), '0 None'))
    await user.click(within(sheet).getByRole('button', { name: 'Save fuel log' }))
    await waitFor(() => {
      expect(api.onDone).toHaveBeenCalledTimes(1)
    })
    expect(await screen.findByText(answer.message ?? '')).toBeInTheDocument()
    expect(screen.queryByText(fuelText.savedQueued())).not.toBeInTheDocument()
    expect(getOutbox().getState().entries).toEqual([])
  })

  test('editing a log whose product changed since sends what was logged, not what the product says now', async () => {
    const user = userEvent.setup()
    const runs = [loggedRun(9, { servings: 4, gut: 2 })]
    const edited: FuelProduct = { ...GEL, carbsG: 30 }
    const api = renderSheet({
      lab: makeLab(runs, { products: [edited, DRINK] }),
      log: logOf(runs, ACTIVITY),
      routes: { [`PUT /api/fuel/logs/${ACTIVITY}`]: () => saved(runs, ACTIVITY) },
    })
    const sheet = await dialog()
    await within(sheet).findByRole('button', { name: 'Save fuel log' })
    expect(within(sheet).getByText('4 taken')).toBeInTheDocument()
    await user.click(radio(within(sheet).getByRole('radiogroup', { name: 'Gut' }), '0 None'))
    await user.click(within(sheet).getByRole('button', { name: 'Save fuel log' }))
    await waitFor(() => {
      expect(puts(api)).toHaveLength(1)
    })
    // 4 x 25 g was eaten; by id the server would have stored 4 x 30 g.
    expect(puts(api)[0]).toMatchObject({
      items: [
        { name: GEL.name, carbsG: 25, sodiumMg: 50, kcal: 100, multiCarb: true, servings: 4 },
      ],
      gut: 0,
    })
    expect(puts(api)[0]).not.toHaveProperty('items.0.productId')
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

  /** An item as the list product it was taken from reads now. */
  const taken = (product: FuelProduct, servings: number): FormItem => ({
    productId: product.id,
    name: product.name,
    carbsG: product.carbsG,
    sodiumMg: product.sodiumMg,
    kcal: product.kcal,
    multiCarb: product.multiCarb,
    servings,
  })
  const live = (...products: FuelProduct[]) =>
    new Map(products.map((product) => [product.id, product]))

  test('the request names a live product by id and sends everything else with its amounts', () => {
    const state: FormState = {
      ...empty,
      items: [
        taken(GEL, 2),
        { ...food('Archived chew'), productId: 'p-archived', servings: 3 },
        food('Rice cake'),
      ],
      nausea: 1,
      hot: false,
    }
    expect(toBody(state, 2, 750, live(GEL), { sodiumMg: 400, notes: 'Windy.' })).toEqual({
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

  test('an item whose product was edited since it was logged keeps the amounts it was logged with', () => {
    // 2 x 25 g was eaten; the product now reads 30 g. By id, the server would store 60 g.
    const edited: FuelProduct = { ...GEL, carbsG: 30 }
    const state: FormState = { ...empty, items: [taken(GEL, 2)] }
    expect(toBody(state, 1, null, live(edited), { sodiumMg: null, notes: null }).items).toEqual([
      {
        name: GEL.name,
        carbsG: 25,
        sodiumMg: 50,
        kcal: 100,
        multiCarb: true,
        servings: 2,
      },
    ])
  })

  test.each([
    ['renamed', { name: 'Example gel, new recipe' }],
    ['changed in sodium', { sodiumMg: 80 }],
    ['changed in energy', { kcal: 120 }],
    ['made a single-carbohydrate product', { multiCarb: false }],
  ] satisfies Array<[string, Partial<FuelProduct>]>)(
    'an item whose product was %s is sent with its own amounts',
    (_what, change) => {
      const state: FormState = { ...empty, items: [taken(GEL, 1)] }
      const [item] = toBody(state, 1, null, live({ ...GEL, ...change }), {
        sodiumMg: null,
        notes: null,
      }).items
      expect(item).not.toHaveProperty('productId')
      expect(item).toMatchObject({ name: GEL.name, carbsG: 25, sodiumMg: 50, kcal: 100 })
    },
  )

  test('an item from a stored log whose product is unchanged still goes by id', () => {
    const runs = [loggedRun(9, { servings: 4 })]
    const stored = stateFromLog(logOf(runs, 'run9'))
    expect(toBody(stored, 1, null, live(GEL), { sodiumMg: null, notes: null }).items).toEqual([
      { productId: GEL.id, servings: 4 },
    ])
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

// ---------------------------------------------------------------------------------------------
// The Fuel lab page (design 10.6)
// ---------------------------------------------------------------------------------------------

const ENGINE_SETTINGS: FuelSettingsInput = {
  optIn90: false,
  optInAdvanced: false,
  giDisease: false,
}

/** A forecast peak that is hot for fuel: a WBGT well over `h7.hotDayWbgtC`. */
const HOT_PEAK = { index: 'wbgt', value: P.h7.hotDayWbgtC.value + 4 } as const

/** The target of a planned long run on the ladder that `runs` built, as the lab's `next`. */
function targetFor(runs: FuelRunInput[], engine: FuelSettingsInput = ENGINE_SETTINGS, hot = false) {
  const ladder = replayLadder({ settings: engine, runs, gutTrainingWeeks: [] })
  const session = makeSession({
    id: 'long1',
    kind: 'long',
    title: 'Long run',
    date: '2027-01-13',
    durationMin: 150,
  })
  const peaks = hot ? { [session.date]: HOT_PEAK } : {}
  const target = fuelTargetFor({ settings: engine, ladder, peaks }, session)
  if (target === null) throw new Error('A 150-minute long run carries a fuel target.')
  const { id, date, kind, title, durationMin } = session
  const view: FuelTargetView = {
    session: { id, date, kind, title, durationMin },
    target,
    text: describeFuelTarget(target),
  }
  return view
}

/** A 6-gel run at the floor, then two 8-gel runs at 60 g/h: one tolerated, one scored 2. */
const RUNS = [
  loggedRun(1, { servings: 6, gut: 0 }),
  loggedRun(2, { servings: 8, gut: 0 }),
  loggedRun(3, { servings: 8, gut: 2 }),
]

const BLOCK: FuelBlockView = {
  state: 'planned',
  weeks: ['2027-03-01', '2027-03-08', '2027-03-15'],
  from: '2027-03-01',
  to: '2027-03-21',
  removalPending: false,
  lines: gutTrainingText(),
}

const PROMPT: FuelPrompt = {
  activityId: ACTIVITY,
  date: '2026-03-09',
  startTime: null,
  durationSec: THREE_HOURS,
  distanceM: 30_000,
  block: false,
}

/** The lab of a runner with three logged runs, a target, a prompt and a planned block. */
function fullLab(over: Partial<FuelLabView> = {}): FuelLabView {
  return makeLab(RUNS, { next: targetFor(RUNS), prompts: [PROMPT], block: BLOCK, ...over })
}

/** A runner who has done nothing yet: no target, no logs, no products, no block in the plan. */
function freshLab(over: Partial<FuelLabView> = {}): FuelLabView {
  return makeLab([], {
    products: [],
    block: { ...BLOCK, state: 'none', weeks: [], from: null, to: null },
    ...over,
  })
}

type LabSource = FuelLabView | (() => FuelLabView)

function renderLab(source: LabSource = fullLab(), routes: MockRoutes = {}, units = settings) {
  const api = mockApi({
    'GET /api/fuel': () => (typeof source === 'function' ? source() : source),
    'GET /api/settings': () => units,
    ...routes,
  })
  renderWithProviders(
    <ToastProvider>
      <FuelLabPage />
    </ToastProvider>,
    { route: '/fuel' },
  )
  return api
}

const region = (name: string | RegExp) => screen.findByRole('region', { name })

describe('the Fuel lab page: sections and layout', () => {
  test('shows every section of the design in phone order, under one heading, from one read', async () => {
    const lab = fullLab()
    const api = renderLab(lab)
    expect(await screen.findByRole('heading', { level: 1, name: 'Fuel lab' })).toBeInTheDocument()
    // The prompts wait for the runner's units, so the last section to arrive is the Fuel log card.
    await region('Fuel log')
    await region('Tier ladder')

    const headings = screen.getAllByRole('heading', { level: 2 }).map((node) => node.textContent)
    expect(headings).toEqual([
      lab.next?.text.heading,
      'Fuel log',
      'Tier ladder',
      'History',
      'Products',
      'Gut training',
      'Settings',
      lab.eah.heading,
    ])
    // The general disclaimer closes the page, after the safety card.
    const disclaimer = screen.getByText(lab.disclaimers.general)
    const note = screen.getByRole('note')
    expect(note.compareDocumentPosition(disclaimer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(api.calls.filter((call) => call.url === '/api/fuel')).toHaveLength(1)
    expectCleanCopy(document.body)
  })

  test('stands in two columns from 900 px: the first four sections on the left, the rest on the right', async () => {
    renderLab()
    const section = async (name: string | RegExp) => (await region(name)).parentElement
    const left = [
      await section(/^Fuel target:/),
      await section('Fuel log'),
      await section('Tier ladder'),
      await section('History'),
    ]
    const right = [
      await section('Products'),
      await section('Gut training'),
      await section('Settings'),
      screen.getByRole('note').parentElement?.parentElement,
    ]
    expect(new Set(left).size).toBe(1)
    expect(new Set(right).size).toBe(1)
    expect(left[0]).not.toBe(right[0])
    expect(left[0]?.parentElement).toBe(right[0]?.parentElement)

    // jsdom applies no stylesheet: the source says it is one column until 900 px, then two, and
    // that nothing reorders the sections.
    const css = readFileSync(join(process.cwd(), 'web/pages/FuelLabPage.module.css'), 'utf8')
    const wide = /@media \(min-width: 900px\)\s*\{([\s\S]*)\}/.exec(css)?.[1] ?? ''
    expect(wide).toMatch(/grid-template-columns:\s*minmax\(0,[^)]*\)\s+minmax\(0,[^)]*\)/)
    expect(css.slice(0, css.indexOf('@media'))).toMatch(
      /\.columns\s*\{[^}]*flex-direction:\s*column/,
    )
    expect(css).not.toMatch(/\border\s*:/)
  })

  test('keeps every stylesheet of the page within 250 lines', () => {
    for (const file of [
      'web/pages/FuelLabPage.module.css',
      'web/components/fuel/FuelLab.module.css',
      'web/components/fuel/TierLadder.module.css',
      'web/components/fuel/FuelHistory.module.css',
      'web/components/fuel/ProductManager.module.css',
    ]) {
      const lines = readFileSync(join(process.cwd(), file), 'utf8').trimEnd().split('\n').length
      expect(lines, file).toBeLessThanOrEqual(250)
    }
  })

  test('works out no rate of its own: the lab components import no ladder or target function', () => {
    for (const file of [
      'web/pages/FuelLabPage.tsx',
      'web/components/fuel/FuelTargetCard.tsx',
      'web/components/fuel/TierLadder.tsx',
      'web/components/fuel/FuelHistory.tsx',
      'web/components/fuel/ProductManager.tsx',
      'web/components/fuel/ProductForm.tsx',
      'web/components/fuel/GutBlockCard.tsx',
      'web/components/fuel/FuelSettingsForm.tsx',
    ]) {
      const source = readFileSync(join(process.cwd(), file), 'utf8')
      expect(source, file).not.toMatch(/engine\/fuel\.ts/)
      expect(source, file).not.toMatch(/domain\/fuel\.ts/)
    }
  })

  test('shows the runs waiting for a log in the runner’s units, and Log fuel opens the form', async () => {
    const user = userEvent.setup()
    renderLab(fullLab(), {
      [`GET /api/fuel/logs/${ACTIVITY}`]: () => null,
      [`GET /api/activities/${ACTIVITY}/detail`]: () => detailOf(),
    })
    const card = await region('Fuel log')
    expect(within(card).getByText('Mon 9 Mar, 3 h, 30 km')).toBeInTheDocument()
    await user.click(
      within(card).getByRole('button', { name: 'Log fuel for Mon 9 Mar, 3 h, 30 km' }),
    )
    expect(await screen.findByRole('dialog', { name: 'Fuel log' })).toBeInTheDocument()
  })

  test('reads the prompt line in miles when the runner uses miles', async () => {
    renderLab(fullLab(), {}, { ...settings, units: 'mi' })
    const card = await region('Fuel log')
    expect(within(card).getByText('Mon 9 Mar, 3 h, 18.6 mi')).toBeInTheDocument()
  })

  test('has no prompt section when no run waits for a log', async () => {
    renderLab(fullLab({ prompts: [] }))
    await region('Tier ladder')
    expect(screen.queryByRole('region', { name: 'Fuel log' })).not.toBeInTheDocument()
  })
})

describe('the Fuel lab page: the target', () => {
  test('shows the next long run with its rate, the reason, the fluid and sodium wording and the nausea plan', async () => {
    const lab = fullLab()
    const next = lab.next
    if (next === null) throw new Error('The fixture has a target.')
    renderLab(lab)
    const card = await region('Fuel target: 60 g/h of carbohydrate')
    expect(within(card).getByText('Long run, Wed 13 Jan, 2 h 30 min')).toBeInTheDocument()
    expect(within(card).getByText(next.text.basis)).toBeInTheDocument()
    expect(next.text.basis).toBe(
      'The last run at 60 g/h sat less well, so this run tries 60 g/h again.',
    )
    expect(
      within(card).getByText(
        `Low certainty: above ${String(P.h7.carbFloorGPerH.value[1])} g/h the evidence is thin. This is a rehearsal, not a promise.`,
      ),
    ).toBeInTheDocument()
    const [low, high] = P.h8.fluidReferenceMlPerH.value
    expect(
      within(card).getByText(
        `Drink to thirst and never force fluids. ${String(low)} to ${String(high)} mL/h is a reference range, not a target.`,
      ),
    ).toBeInTheDocument()
    expect(within(card).getByText(next.text.sodium)).toBeInTheDocument()
    expect(within(card).getByText('If your stomach turns')).toBeInTheDocument()
    expect(within(card).getByRole('button', { name: 'Why: the fuel target' })).toBeInTheDocument()
    // The safety card has its own section; the target does not repeat it.
    expect(within(card).queryByRole('note')).not.toBeInTheDocument()
    expectCleanCopy(card)
  })

  test('opens the nausea plan when a warm day brings it forward, and says why the rate stays', async () => {
    // One tolerated run at the floor opens 60 g/h; the forecast is hot, so the target stays put.
    const view = targetFor([loggedRun(1, { servings: 6, gut: 0 })], ENGINE_SETTINGS, true)
    expect(view.target.basis).toBe('warm-held')
    renderLab(fullLab({ next: view }))
    const card = await region('Fuel target: 30 to 50 g/h of carbohydrate')
    expect(
      within(card).getByText(
        'Warm day: the target stays at 30 to 50 g/h, the last rate you tolerated, instead of stepping up to 60 g/h.',
      ),
    ).toBeInTheDocument()
    const summary = within(card).getByText('If your stomach turns')
    expect(summary.closest('details')).toHaveAttribute('open')
  })

  test('says so, in the exact words, when no planned run carries a target yet', async () => {
    renderLab(freshLab())
    const card = await region('Fuel target')
    expect(
      within(card).getByText(
        'No planned run carries a fuel target yet. A planned run of 2 h or more does.',
      ),
    ).toBeInTheDocument()
    expect(P.h7.logMinDurationMin.value).toBe(120)
  })
})

describe('the Fuel lab page: the tier ladder', () => {
  const OPENS_AFTER = `Opens after ${String(P.h7.carbTier2GPerH.value)} g/h goes well`
  const GUT_ENGINE: FuelSettingsInput = { optIn90: false, optInAdvanced: false, giDisease: true }

  test.each([
    {
      name: 'before any run',
      runs: [] as FuelRunInput[],
      engine: ENGINE_SETTINGS,
      words: ['Next up', 'Later', 'Opt in to open', OPENS_AFTER],
    },
    {
      name: 'after a tolerated run and one scored 2',
      runs: RUNS,
      engine: ENGINE_SETTINGS,
      words: ['Tolerated', 'Repeat', 'Opt in to open', OPENS_AFTER],
    },
    {
      name: 'with a diagnosed gut condition',
      runs: [] as FuelRunInput[],
      engine: GUT_ENGINE,
      words: ['Next up', 'Not available with a gut condition'],
    },
  ])('lists every rung with its state in words and its grade: $name', async (scenario) => {
    const ladder = replayLadder({
      settings: scenario.engine,
      runs: scenario.runs,
      gutTrainingWeeks: [],
    })
    renderLab(makeLab(scenario.runs, { ladder }))
    const card = await region('Tier ladder')
    const list = within(card).getByRole('list', { name: 'Carbohydrate rates, lowest first' })
    const items = within(list).getAllByRole('listitem')
    expect(items).toHaveLength(ladder.rungs.length)
    ladder.rungs.forEach((rung, index) => {
      const item = items[index]
      if (item === undefined) throw new Error('A row for every rung.')
      expect(within(item).getByText(rateText(rung))).toBeInTheDocument()
      expect(within(item).getByText(rungStateLabel(rung.state))).toBeInTheDocument()
      expect(within(item).getByText(`Evidence grade ${rung.grade}`)).toBeInTheDocument()
      expect(item.getAttribute('aria-current')).toBe(index === ladder.currentIndex ? 'step' : null)
      // Every rung above the floor says its evidence is thin.
      expect(within(item).queryByText('Low certainty') !== null).toBe(index > 0)
    })
    const shown = new Set(ladder.rungs.map((rung) => rungStateLabel(rung.state)))
    expect(shown).toEqual(new Set(scenario.words))
    expect(
      within(card).getByText(/climbed on long runs from the start of the build/),
    ).toBeInTheDocument()
    expectCleanCopy(card)
  })

  test('the rung words are the registry’s: the second tier is the one in P', () => {
    expect(OPENS_AFTER).toBe('Opens after 90 g/h goes well')
  })
})

describe('the Fuel lab page: the history', () => {
  test('is a scrollable, labelled region with the replayed note of each run, newest first', async () => {
    const lab = fullLab()
    renderLab(lab)
    const scroller = await region('Fuel history, newest first')
    expect(scroller).toHaveAttribute('tabindex', '0')
    const rows = within(within(scroller).getByRole('table')).getAllByRole('row')
    expect(rows).toHaveLength(1 + lab.history.length)
    expect(
      within(rows[0] as HTMLElement)
        .getAllByRole('columnheader')
        .map((cell) => cell.textContent),
    ).toEqual(['Run', 'Rate taken', 'Target', 'Gut', 'Nausea', 'What it did'])

    lab.history.forEach((entry, index) => {
      const row = rows[index + 1]
      if (row === undefined) throw new Error('A row for every log.')
      const link = within(row).getByRole('link')
      expect(link).toHaveAttribute('href', `/activities/${entry.log.activityId}`)
      expect(within(row).getByText(entry.note)).toBeInTheDocument()
    })
    // Newest first, with the sentence each run's replay gave it.
    const notes = rows.slice(1).map((row) => within(row).getAllByRole('cell').at(-1)?.textContent)
    expect(notes).toEqual([
      'Scored 2 of 4 at 60 g/h. The target holds there for the next long run.',
      'Tolerated at 60 g/h. That is the highest rate open on your ladder for now.',
      'Tolerated at 30 to 50 g/h. Next long run: 60 g/h.',
    ])
    const second = within(rows[2] as HTMLElement)
    expect(second.getByRole('link')).toHaveTextContent('Mon 2 Mar')
    expect(second.getAllByRole('cell').map((cell) => cell.textContent)).toEqual([
      '67 g/h',
      '60 g/h',
      'None, 0 of 4',
      'Not answered',
      'Tolerated at 60 g/h. That is the highest rate open on your ladder for now.',
    ])
    const held = within(rows[1] as HTMLElement).getAllByRole('cell')
    expect(held[2]?.textContent).toBe('Moderate, 2 of 4')
    expect(
      screen.getByText(/worked out again from the logs every time this page opens/),
    ).toBeInTheDocument()
    expectCleanCopy(scroller)
  })

  test('scrolls inside its own box in both directions, so the page never scrolls sideways', () => {
    const css = readFileSync(
      join(process.cwd(), 'web/components/fuel/FuelHistory.module.css'),
      'utf8',
    )
    const rule = /\.scroll\s*\{([^}]*)\}/.exec(css)?.[1] ?? ''
    expect(rule).toMatch(/overflow:\s*auto/)
    expect(rule).toMatch(/max-height:/)
  })

  test('says in the exact words that nothing is logged yet, and draws no table', async () => {
    renderLab(freshLab())
    const card = await region('History')
    expect(
      within(card).getByText(
        'No runs are logged yet. Log what you took after a long run, and it appears here with what it did to the ladder.',
      ),
    ).toBeInTheDocument()
    expect(within(card).queryByRole('table')).not.toBeInTheDocument()
  })

  test('a run that did not count says why, and a skipped one has no scores to show', async () => {
    const skipped = loggedRun(4, { servings: 0, gut: 0 })
    skipped.log = { ...skipped.log, skipped: true, items: [] }
    renderLab(makeLab([skipped]))
    const scroller = await region('Fuel history, newest first')
    const row = within(scroller).getAllByRole('row')[1] as HTMLElement
    expect(
      within(row).getByText('Not logged this time, so this run does not count toward your ladder.'),
    ).toBeInTheDocument()
    expectCleanCopy(scroller)
  })
})

describe('the Fuel lab page: products', () => {
  const SERVER_GEL: FuelProduct = { ...GEL }
  let list: FuelProduct[]

  beforeEach(() => {
    list = [SERVER_GEL, DRINK]
  })

  function renderProducts(routes: MockRoutes = {}) {
    return renderLab(() => makeLab(RUNS, { products: [...list], block: BLOCK }), routes)
  }

  test('lists each product with its serving, carbohydrate and sodium, and names several-source ones', async () => {
    renderProducts()
    const card = await region('Products')
    const items = within(card).getAllByRole('listitem')
    expect(items).toHaveLength(2)
    expect(within(items[0] as HTMLElement).getByText('Example gel')).toBeInTheDocument()
    expect(
      within(items[0] as HTMLElement).getByText('1 gel: 25 g carbohydrate, 50 mg sodium'),
    ).toBeInTheDocument()
    expect(
      within(items[1] as HTMLElement).getByText('500 mL bottle: 40 g carbohydrate, 300 mg sodium'),
    ).toBeInTheDocument()
    expect(
      within(items[0] as HTMLElement).getByText('Several carbohydrate sources'),
    ).toBeInTheDocument()
    expectCleanCopy(card)
  })

  test('says in the exact words when the list is empty', async () => {
    list = []
    renderProducts()
    const card = await region('Products')
    expect(
      within(card).getByText(
        'No products on your list yet. Add the gels, drink mixes and chews you carry.',
      ),
    ).toBeInTheDocument()
  })

  test('adds a product: the body is exactly what the server reads, the list refreshes and the form closes', async () => {
    const user = userEvent.setup()
    const api = renderProducts({
      'POST /api/fuel/products': ({ body }) => {
        const product = { id: 'p-new', archived: false, ...(body as object) } as FuelProduct
        list = [...list, product]
        return { status: 201, body: product }
      },
    })
    const card = await region('Products')
    await user.click(within(card).getByRole('button', { name: 'Add a product' }))
    const form = within(card).getByRole('form', { name: 'Add a product' })
    expect(within(form).getByRole('textbox', { name: 'Name' })).toHaveFocus()
    await user.type(within(form).getByRole('textbox', { name: 'Name' }), '  Example chews ')
    await user.selectOptions(within(form).getByRole('combobox', { name: 'Kind' }), 'Chews')
    await user.type(within(form).getByRole('textbox', { name: 'What one serving is' }), '1 pack')
    await user.type(
      within(form).getByRole('spinbutton', { name: 'Carbohydrate in one serving, in grams' }),
      '39',
    )
    await user.click(
      within(form).getByRole('checkbox', {
        name: 'More than one kind of carbohydrate, such as glucose and fructose',
      }),
    )
    await user.click(within(form).getByRole('button', { name: 'Save product' }))

    expect(await screen.findByText('Product saved.')).toBeInTheDocument()
    expect(api.calls.filter((call) => call.method === 'POST').map((call) => call.body)).toEqual([
      {
        name: 'Example chews',
        kind: 'chew',
        servingLabel: '1 pack',
        carbsG: 39,
        sodiumMg: null,
        kcal: null,
        multiCarb: true,
      },
    ])
    expect(await within(card).findByText('1 pack: 39 g carbohydrate')).toBeInTheDocument()
    expect(within(card).queryByRole('form')).not.toBeInTheDocument()
    await waitFor(() => {
      expect(within(card).getByRole('heading', { name: 'Products' })).toHaveFocus()
    })
  })

  test('asks for what is missing beside the field and sends nothing', async () => {
    const user = userEvent.setup()
    const api = renderProducts()
    const card = await region('Products')
    await user.click(within(card).getByRole('button', { name: 'Add a product' }))
    await user.click(within(card).getByRole('button', { name: 'Save product' }))
    const form = within(card).getByRole('form', { name: 'Add a product' })
    expect(within(form).getByText('Give the product a name.')).toBeInTheDocument()
    expect(within(form).getByText('Say what one serving is.')).toBeInTheDocument()
    expect(within(form).getByText('Use grams of carbohydrate, zero or more.')).toBeInTheDocument()
    expect(within(form).getByRole('textbox', { name: 'Name' })).toBeInvalid()
    expect(api.calls.some((call) => call.method === 'POST')).toBe(false)

    await user.type(within(form).getByRole('textbox', { name: 'Name' }), 'x')
    await user.type(within(form).getByRole('textbox', { name: 'What one serving is' }), 'x')
    await user.type(
      within(form).getByRole('spinbutton', { name: 'Carbohydrate in one serving, in grams' }),
      '10',
    )
    await user.type(
      within(form).getByRole('spinbutton', {
        name: 'Sodium in one serving, in milligrams (optional)',
      }),
      '1.5',
    )
    await user.click(within(card).getByRole('button', { name: 'Save product' }))
    expect(
      within(form).getByText('Use a whole number of zero or more, or leave it empty.'),
    ).toBeInTheDocument()
    expect(api.calls.some((call) => call.method === 'POST')).toBe(false)
  })

  test('puts the server’s sentence beside the name when it is already taken', async () => {
    const user = userEvent.setup()
    const taken = 'A product called Example gel is already on your list. Choose another name.'
    renderProducts({
      'POST /api/fuel/products': () => ({
        status: 409,
        body: { error: { code: 'conflict', message: taken, details: { code: 'name-taken' } } },
      }),
    })
    const card = await region('Products')
    await user.click(within(card).getByRole('button', { name: 'Add a product' }))
    const form = within(card).getByRole('form', { name: 'Add a product' })
    await user.type(within(form).getByRole('textbox', { name: 'Name' }), 'Example gel')
    await user.type(within(form).getByRole('textbox', { name: 'What one serving is' }), '1 gel')
    await user.type(
      within(form).getByRole('spinbutton', { name: 'Carbohydrate in one serving, in grams' }),
      '25',
    )
    await user.click(within(form).getByRole('button', { name: 'Save product' }))
    expect(await within(form).findByText(taken)).toBeInTheDocument()
    expect(within(form).getByRole('textbox', { name: 'Name' })).toBeInvalid()
    expect(within(form).getByRole('textbox', { name: 'Name' })).toHaveValue('Example gel')
  })

  test('keeps the entries and says so in an alert when the list is full or the server is away', async () => {
    const user = userEvent.setup()
    renderProducts({
      'POST /api/fuel/products': () => ({
        status: 409,
        body: {
          error: {
            code: 'conflict',
            message: 'Your list holds up to 100 products. Archive one to add another.',
            details: { code: 'products-full' },
          },
        },
      }),
    })
    const card = await region('Products')
    await user.click(within(card).getByRole('button', { name: 'Add a product' }))
    const form = within(card).getByRole('form', { name: 'Add a product' })
    await user.type(within(form).getByRole('textbox', { name: 'Name' }), 'Example bar')
    await user.type(within(form).getByRole('textbox', { name: 'What one serving is' }), '1 bar')
    await user.type(
      within(form).getByRole('spinbutton', { name: 'Carbohydrate in one serving, in grams' }),
      '30',
    )
    await user.click(within(form).getByRole('button', { name: 'Save product' }))
    expect(await within(form).findByRole('alert')).toHaveTextContent(
      'The product was not saved. Your list holds up to 100 products. Archive one to add another. Try again.',
    )
    expect(within(form).getByRole('textbox', { name: 'Name' })).toHaveValue('Example bar')
  })

  test('changes a product from its own values and sends the whole product', async () => {
    const user = userEvent.setup()
    const api = renderProducts({
      'PUT /api/fuel/products/p-gel': ({ body }) => {
        const product = { id: 'p-gel', archived: false, ...(body as object) } as FuelProduct
        list = [product, DRINK]
        return product
      },
    })
    const card = await region('Products')
    await user.click(within(card).getByRole('button', { name: 'Edit Example gel' }))
    const form = within(card).getByRole('form', { name: 'Edit Example gel' })
    expect(within(form).getByRole('textbox', { name: 'Name' })).toHaveValue('Example gel')
    expect(
      within(form).getByRole('spinbutton', { name: 'Carbohydrate in one serving, in grams' }),
    ).toHaveValue(25)
    expect(within(form).getByRole('checkbox', { name: /More than one kind/ })).toBeChecked()
    const carbs = within(form).getByRole('spinbutton', {
      name: 'Carbohydrate in one serving, in grams',
    })
    await user.clear(carbs)
    await user.type(carbs, '30')
    await user.click(within(form).getByRole('button', { name: 'Save product' }))
    expect(
      await within(card).findByText('1 gel: 30 g carbohydrate, 50 mg sodium'),
    ).toBeInTheDocument()
    expect(api.calls.filter((call) => call.method === 'PUT').map((call) => call.body)).toEqual([
      {
        name: 'Example gel',
        kind: 'gel',
        servingLabel: '1 gel',
        carbsG: 30,
        sodiumMg: 50,
        kcal: 100,
        multiCarb: true,
      },
    ])
  })

  test('cancelling a change leaves the product as it was and sends nothing', async () => {
    const user = userEvent.setup()
    const api = renderProducts()
    const card = await region('Products')
    await user.click(within(card).getByRole('button', { name: 'Edit Example gel' }))
    await user.click(within(card).getByRole('button', { name: 'Cancel' }))
    expect(within(card).queryByRole('form')).not.toBeInTheDocument()
    expect(within(card).getByText('1 gel: 25 g carbohydrate, 50 mg sodium')).toBeInTheDocument()
    expect(api.calls.some((call) => call.method !== 'GET')).toBe(false)
  })

  test('archives a product, never deletes it: the request is a DELETE, a toast says so and focus stays on the section', async () => {
    const user = userEvent.setup()
    const api = renderProducts({
      'DELETE /api/fuel/products/p-drink': () => {
        list = [SERVER_GEL]
        return { status: 204, body: undefined }
      },
    })
    const card = await region('Products')
    await user.click(within(card).getByRole('button', { name: 'Archive Example drink mix' }))
    expect(await screen.findByText('Archived Example drink mix.')).toBeInTheDocument()
    await waitFor(() => {
      expect(within(card).queryByText('Example drink mix')).not.toBeInTheDocument()
    })
    expect(api.calls.filter((call) => call.method === 'DELETE').map((call) => call.url)).toEqual([
      '/api/fuel/products/p-drink',
    ])
    await waitFor(() => {
      expect(within(card).getByRole('heading', { name: 'Products' })).toHaveFocus()
    })
  })

  test('says an archive did not happen, in an alert, and keeps the product', async () => {
    const user = userEvent.setup()
    renderProducts({
      'DELETE /api/fuel/products/p-drink': () => ({
        status: 404,
        body: { error: { code: 'not_found', message: 'That product is not on your list.' } },
      }),
    })
    const card = await region('Products')
    await user.click(within(card).getByRole('button', { name: 'Archive Example drink mix' }))
    expect(await within(card).findByRole('alert')).toHaveTextContent(
      'The product was not archived. That product is not on your list. Try again.',
    )
    expect(within(card).getByText('Example drink mix')).toBeInTheDocument()
  })
})

describe('the Fuel lab page: settings', () => {
  const OFF: FuelSettings = {
    optIn90: false,
    optInAdvanced: false,
    giDisease: false,
    gutBlock: true,
  }
  let kept: FuelSettings

  beforeEach(() => {
    kept = OFF
  })

  function renderSettings(routes: MockRoutes = {}) {
    return renderLab(() => makeLab(RUNS, { settings: kept, block: BLOCK }), {
      'PUT /api/fuel/settings': ({ body }) => {
        kept = body as FuelSettings
        return kept
      },
      ...routes,
    })
  }

  // The first opt-in opens the rungs above the first higher tier, the second those above the
  // second tier; the figures are the registry's.
  const FIRST_TIER = `Open carbohydrate rates above ${String(P.h7.carbTier1GPerH.value)} g/h, up to ${String(P.h7.carbTier2GPerH.value)} g/h`
  const SECOND_TIER = `Open carbohydrate rates above ${String(P.h7.carbTier2GPerH.value)} g/h, up to ${String(P.h7.carbAdvancedGPerH.value[1])} g/h`

  const box = (card: HTMLElement, name: string | RegExp) =>
    within(card).getByRole('checkbox', { name })

  test('shows the four switches as the server keeps them, with the highest tier closed until the first is on', async () => {
    renderSettings()
    const card = await region('Settings')
    expect(box(card, FIRST_TIER)).not.toBeChecked()
    const advanced = box(card, SECOND_TIER)
    expect(advanced).toBeDisabled()
    expect(box(card, 'Include a gut-training block before the taper')).toBeChecked()
    expect(box(card, 'I have a diagnosed gut condition')).not.toBeChecked()
    expect(advanced).toHaveAccessibleDescription(advancedLockedMessage())
    expect(within(card).getByText(advancedLockedMessage())).toBeInTheDocument()
    expectCleanCopy(card)
  })

  test('saves all four switches in one request, tells the runner, and reads the lab again', async () => {
    const user = userEvent.setup()
    const api = renderSettings()
    const card = await region('Settings')
    await user.click(box(card, FIRST_TIER))
    await user.click(within(card).getByRole('button', { name: 'Save settings' }))
    expect(await screen.findByText('Fuel settings saved.')).toBeInTheDocument()
    expect(api.calls.filter((call) => call.method === 'PUT').map((call) => call.body)).toEqual([
      { optIn90: true, optInAdvanced: false, giDisease: false, gutBlock: true },
    ])
    await waitFor(() => {
      expect(api.calls.filter((call) => call.url === '/api/fuel')).toHaveLength(2)
    })
    // The form starts again from what the server kept.
    await waitFor(async () => {
      expect(await region('Settings')).not.toBe(card)
    })
    const fresh = await region('Settings')
    expect(box(fresh, FIRST_TIER)).toBeChecked()
    expect(box(fresh, SECOND_TIER)).toBeEnabled()
  })

  test('says the ladder follows at once and the block waits for the next weekly re-plan', async () => {
    renderSettings()
    const card = await region('Settings')
    expect(
      within(card).getByText(
        'The ladder follows these switches once saved. The gut-training block reaches the plan at the next weekly re-plan, shown in its diff.',
      ),
    ).toBeInTheDocument()
  })

  test('a gut condition turns the others off and closes them, and the request says so', async () => {
    const user = userEvent.setup()
    kept = { optIn90: true, optInAdvanced: false, giDisease: false, gutBlock: true }
    const api = renderSettings()
    const card = await region('Settings')
    await user.click(box(card, 'I have a diagnosed gut condition'))
    for (const name of [FIRST_TIER, SECOND_TIER, 'Include a gut-training block before the taper']) {
      expect(box(card, name)).not.toBeChecked()
      expect(box(card, name)).toBeDisabled()
    }
    await user.click(within(card).getByRole('button', { name: 'Save settings' }))
    await screen.findByText('Fuel settings saved.')
    expect(api.calls.filter((call) => call.method === 'PUT').map((call) => call.body)).toEqual([
      { optIn90: false, optInAdvanced: false, giDisease: true, gutBlock: false },
    ])
  })

  test('opting out of the first tier unticks the highest one with it', async () => {
    const user = userEvent.setup()
    kept = { optIn90: true, optInAdvanced: true, giDisease: false, gutBlock: true }
    renderSettings()
    const card = await region('Settings')
    expect(box(card, SECOND_TIER)).toBeChecked()
    await user.click(box(card, FIRST_TIER))
    expect(box(card, SECOND_TIER)).not.toBeChecked()
    expect(box(card, SECOND_TIER)).toBeDisabled()
  })

  test('shows the server’s sentence when the highest tier is not open yet, unticks it and puts focus on it', async () => {
    const user = userEvent.setup()
    kept = { ...OFF, optIn90: true }
    const api = renderSettings({
      'PUT /api/fuel/settings': () => ({
        status: 400,
        body: {
          error: {
            code: 'validation',
            message: advancedLockedMessage(),
            details: { issues: [{ path: 'optInAdvanced', message: advancedLockedMessage() }] },
          },
        },
      }),
    })
    const card = await region('Settings')
    const advanced = box(card, SECOND_TIER)
    await user.click(advanced)
    expect(advanced).toBeChecked()
    await user.click(within(card).getByRole('button', { name: 'Save settings' }))
    await waitFor(() => {
      expect(advanced).toHaveFocus()
    })
    expect(advanced).not.toBeChecked()
    expect(advanced).toHaveAccessibleDescription(advancedLockedMessage())
    expect(
      within(card).getByText('This opens after a run at 90 g/h goes well.'),
    ).toBeInTheDocument()
    // A refusal is an answer, not an error: no alert, and no toast that it saved.
    expect(within(card).queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.queryByText('Fuel settings saved.')).not.toBeInTheDocument()
    expect(api.calls.filter((call) => call.method === 'PUT')).toHaveLength(1)
  })

  test('says the settings were not saved, in an alert, when the server is away', async () => {
    const user = userEvent.setup()
    renderSettings({
      'PUT /api/fuel/settings': () => ({
        status: 500,
        body: { error: { code: 'internal', message: 'The server did not respond.' } },
      }),
    })
    const card = await region('Settings')
    await user.click(within(card).getByRole('button', { name: 'Save settings' }))
    expect(await within(card).findByRole('alert')).toHaveTextContent(
      'The settings were not saved. The server did not respond. Try again.',
    )
  })
})

describe('the Fuel lab page: the gut-training block', () => {
  const CLAIM = 'Gut training may improve how well you tolerate carbohydrate during a run.'
  const CAVEAT =
    'It does not promise a faster time, and it has not been shown to protect the gut lining.'

  test('shows the dates ending before the taper, each week, the counting rule and the claim with its limits', async () => {
    renderLab(fullLab())
    const card = await region('Gut training')
    expect(
      within(card).getByText(
        'Gut-training weeks run from Mon 1 Mar to Sun 21 Mar, ending before the taper.',
      ),
    ).toBeInTheDocument()
    expect(
      within(card)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual(['Week of Mon 1 Mar', 'Week of Mon 8 Mar', 'Week of Mon 15 Mar'])
    expect(
      within(card).getByText(
        `In these weeks a run of 1 h or more counts toward the ladder, whether or not the app linked it to a session.`,
      ),
    ).toBeInTheDocument()
    expect(P.h7.gutTrainingSessionMinMin.value).toBe(60)
    expect(within(card).getByText(CLAIM)).toBeInTheDocument()
    expect(within(card).getByText(CAVEAT)).toBeInTheDocument()
    expect(card.textContent).not.toMatch(/faster time\b(?!, and)/)
    expectCleanCopy(card)
  })

  test('says the plan has no gut-training weeks when it has none, and still gives the claim and its limits', async () => {
    renderLab(
      freshLab({
        block: {
          ...BLOCK,
          state: 'none',
          weeks: [],
          from: null,
          to: null,
          lines: gutTrainingText(),
        },
      }),
    )
    const card = await region('Gut training')
    expect(
      within(card).getByText(
        'The plan has no gut-training weeks right now. They are added before the taper of a long goal, at a weekly re-plan.',
      ),
    ).toBeInTheDocument()
    expect(within(card).getByText(CLAIM)).toBeInTheDocument()
  })

  test('says the block is switched off, and that its weeks leave the plan at the next re-plan', async () => {
    renderLab(fullLab({ block: { ...BLOCK, state: 'off', removalPending: true } }))
    const card = await region('Gut training')
    expect(within(card).getByText('The gut-training block is switched off.')).toBeInTheDocument()
    expect(
      within(card).getByText('Its weeks leave the plan at the next weekly re-plan.'),
    ).toBeInTheDocument()
    expect(within(card).queryByText(/Gut-training weeks run from/)).not.toBeInTheDocument()
  })

  test('a gut condition locks the ladder at the floor and shows the clinician line instead of the claim', async () => {
    const engine: FuelSettingsInput = { optIn90: false, optInAdvanced: false, giDisease: true }
    const lab = makeLab([], {
      settings: { optIn90: false, optInAdvanced: false, giDisease: true, gutBlock: false },
      ladder: replayLadder({ settings: engine, runs: [], gutTrainingWeeks: [] }),
      next: targetFor([], engine),
      block: { ...BLOCK, state: 'locked', removalPending: true, lines: [] },
      disclaimers: { general: fuelDisclaimer(), gutCondition: gutConditionLock() },
    })
    renderLab(lab)
    const card = await region('Gut training')
    expect(
      within(card).getByText('A diagnosed gut condition removes the gut-training block.'),
    ).toBeInTheDocument()
    expect(within(card).getByText(gutConditionLock())).toBeInTheDocument()
    expect(within(card).queryByText(CLAIM)).not.toBeInTheDocument()
    const ladder = await region('Tier ladder')
    expect(within(ladder).getAllByText('Not available with a gut condition')).toHaveLength(
      lab.ladder.rungs.length - 1,
    )
    // The target says the same on its own card.
    const target = await region(/^Fuel target:/)
    expect(within(target).getByText(gutConditionLock())).toBeInTheDocument()
    expectCleanCopy(document.body)
  })
})

describe('the Fuel lab page: the safety card about drinking too much', () => {
  test.each([
    { name: 'standard', hours: null as number | null, stronger: false },
    {
      name: 'stronger for a long goal',
      hours: P.n7.eahStrongerAlertHours.value + 1,
      stronger: true,
    },
  ])('renders the $name variant as a note with its numbers from the registry', async (variant) => {
    const card = eahCard({ eventHours: variant.hours, hot: false })
    renderLab(fullLab({ eah: card }))
    const note = await screen.findByRole('note', { name: card.heading })
    expect(screen.getAllByRole('note')).toHaveLength(1)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(within(note).getByRole('heading', { level: 2, name: card.heading })).toBeInTheDocument()
    for (const line of card.lines) expect(within(note).getByText(line)).toBeInTheDocument()
    const strongerLine = `On events over ${String(P.n7.eahStrongerAlertHours.value)} hours, or in heat, take extra care: drink only when thirsty, and get help early if symptoms start.`
    expect(within(note).queryByText(strongerLine) !== null).toBe(variant.stronger)
    expect(note.getAttribute('data-stronger')).toBe(variant.stronger ? 'true' : null)
    expect(within(note).getByText(/Drink to thirst\. Never force fluids/)).toBeInTheDocument()
    expectCleanCopy(note)
  })

  test('is the stronger card in heat', async () => {
    const card = eahCard({ eventHours: null, hot: true })
    renderLab(fullLab({ eah: card }))
    const note = await screen.findByRole('note', { name: card.heading })
    expect(note.getAttribute('data-stronger')).toBe('true')
  })

  test('closes the page with the general disclaimer from the server', async () => {
    renderLab(fullLab())
    expect(await screen.findByText('Fuel targets are decision support.')).toBeInTheDocument()
  })
})

describe('the Fuel lab page: loading, empty and error', () => {
  test('shows a loading placeholder under the page heading while the lab is on its way', async () => {
    vi.stubGlobal('fetch', () => new Promise<Response>(() => {}))
    renderWithProviders(
      <ToastProvider>
        <FuelLabPage />
      </ToastProvider>,
      { route: '/fuel' },
    )
    expect(screen.getByRole('heading', { level: 1, name: 'Fuel lab' })).toBeInTheDocument()
    expect(await screen.findByRole('group', { name: 'Loading' })).toHaveAttribute(
      'aria-busy',
      'true',
    )
    expect(screen.queryByRole('region')).not.toBeInTheDocument()
  })

  test('says in the exact words that the lab did not load, in an alert, and shows no section', async () => {
    renderLab(fullLab(), {
      'GET /api/fuel': () => ({
        status: 500,
        body: { error: { code: 'internal', message: 'Boom' } },
      }),
    })
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The Fuel lab did not load. Reload the page to try again.',
    )
    expect(screen.queryByRole('region')).not.toBeInTheDocument()
    expectCleanCopy(document.body)
  })

  test('a runner who has logged nothing sees every section with its own empty words', async () => {
    renderLab(freshLab())
    await region('Tier ladder')
    const names = ['Fuel target', 'Tier ladder', 'History', 'Products', 'Gut training', 'Settings']
    for (const name of names) expect(await region(name)).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Fuel log' })).not.toBeInTheDocument()
    const ladder = await region('Tier ladder')
    expect(within(ladder).getAllByRole('listitem')).toHaveLength(8)
    expect(within(ladder).getByText('Next up')).toBeInTheDocument()
    expectCleanCopy(document.body)
  })
})

describe('the Fuel lab page: a hard gut day is never a failure', () => {
  test('a run scored 4 falls back at once and the page says so in the ladder’s own words', async () => {
    const runs = [
      loggedRun(1, { servings: 6, gut: 0 }),
      loggedRun(2, { servings: 8, gut: 0 }),
      loggedRun(3, { servings: 8, gut: 4 }),
    ]
    const lab = makeLab(runs, { next: targetFor(runs), block: BLOCK })
    renderLab(lab)
    const scroller = await region('Fuel history, newest first')
    const newest = lab.history[0]
    if (newest === undefined) throw new Error('The fixture has a history.')
    expect(newest.note).toBe(stepNote(newest.log.step))
    expect(within(scroller).getByText(newest.note)).toBeInTheDocument()
    expect(newest.note).toMatch(/^Scored 4 of 4 at 60 g\/h\./)
    expect(document.body.textContent).not.toMatch(
      /\b(fail\w*|miss\w*|behind|bad|poor|wrong|streak\w*|badge\w*)\b/i,
    )
    expectCleanCopy(document.body)
  })
})

describe('navigation to the Fuel lab', () => {
  const user = {
    id: 'u1',
    email: 'runner@example.com',
    displayName: null,
    units: 'km',
  }

  test('More lists the Fuel lab and links it to /fuel', () => {
    renderWithProviders(<MorePage />, { route: '/more' })
    const link = within(screen.getByRole('navigation', { name: 'More pages' })).getByRole('link', {
      name: /Fuel lab/,
    })
    expect(link).toHaveAttribute('href', '/fuel')
    expect(link).toHaveTextContent('Fuel targets, products and gut training')
  })

  test('the nav highlights More, and only More, on /fuel', () => {
    renderWithProviders(<Nav />, { route: '/fuel' })
    const current = screen
      .getAllByRole('link')
      .filter((link) => link.getAttribute('aria-current') === 'page')
    expect(current.map((link) => link.textContent)).toEqual(['More'])
  })

  test('the route renders the page inside the signed-in layout, with More current', async () => {
    mockApi({
      'GET /api/setup': () => ({ needsSetup: false }),
      'GET /api/auth/me': () => user,
      'GET /api/fuel': () => fullLab({ prompts: [] }),
      'GET /api/settings': () => settings,
    })
    renderWithProviders(<App />, { route: '/fuel' })
    expect(await screen.findByRole('heading', { level: 1, name: 'Fuel lab' })).toBeInTheDocument()
    expect(await screen.findByRole('region', { name: 'Tier ladder' })).toBeInTheDocument()
    const primary = within(screen.getByRole('navigation', { name: 'Primary' }))
    expect(primary.getByRole('link', { name: 'More' })).toHaveAttribute('aria-current', 'page')
  })

  test('from More, a tap reaches the lab', async () => {
    const tap = userEvent.setup()
    mockApi({
      'GET /api/setup': () => ({ needsSetup: false }),
      'GET /api/auth/me': () => user,
      'GET /api/fuel': () => fullLab({ prompts: [] }),
      'GET /api/settings': () => settings,
    })
    renderWithProviders(<App />, { route: '/more' })
    await tap.click(await screen.findByRole('link', { name: /Fuel lab/ }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Fuel lab' })).toBeInTheDocument()
  })
})
