import { act, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, test } from 'vitest'
import type { StandoutView } from '../../shared/copy/standoutRender.ts'
import { allParams } from '../../shared/engine/params/index.ts'
import type { InputFact, Quantity } from '../../shared/engine/types.ts'
import type { Units, UserSettings } from '../../shared/types.ts'
import { StandoutCard } from '../../web/components/StandoutCard.tsx'
import { expectCleanCopy, mockApi, renderWithProviders, type MockRoutes } from './helpers.tsx'

function fact(
  rule: string,
  name: string,
  template: string,
  slots: Record<string, Quantity | string> = {},
): InputFact {
  return {
    id: `${rule.toLowerCase()}.${name}`,
    template,
    slots,
    rule,
    sources: [{ kind: 'activity', id: 'a1', date: '2026-10-20', label: 'Run' }],
    moreSources: 0,
    state: 'used',
  }
}

const PAIN = fact('design-4.2', 'pain', 'standout.pain', { pain: { kind: 'count', n: 6 } })
const HEART_RATE = fact('A8', 'hr-higher', 'standout.hr-higher', { bpm: { kind: 'bpm', bpm: 8 } })
const LONGEST = fact('design-explain', 'longest', 'standout.longest-distance', {
  distance: { kind: 'distance', m: 21_000 },
  weeks: { kind: 'count', n: 12 },
})

const settings = (units: Units) => ({
  'GET /api/settings': (): UserSettings => ({
    email: 'runner@example.com',
    displayName: null,
    units,
  }),
})

function renderCard(view: StandoutView | { status: number; body: unknown }, units: Units = 'km') {
  const routes: MockRoutes = {
    ...settings(units),
    'GET /api/activities/a1/standout': () => view,
  }
  const api = mockApi(routes)
  const rendered = renderWithProviders(<StandoutCard activityId="a1" units={units} />)
  return { api, ...rendered }
}

/** Lets a query that has just been answered reach the page, so an absence check is not premature. */
async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

describe('StandoutCard', () => {
  test('shows each fact as a sentence with a Why that names it', async () => {
    renderCard({ items: [PAIN, HEART_RATE, LONGEST], more: 2 })
    const card = await screen.findByRole('region', { name: 'What stood out' })
    const items = await within(card).findAllByRole('listitem')
    expect(items.map((item) => item.querySelector('p')?.textContent)).toEqual([
      'Pain of 6 out of 10 was reported with this run. See the guidance on warning signs before the next run.',
      'Average heart rate was 8 bpm higher than your usual at this pace.',
      'At 21 km, this is your longest run in the last 12 weeks.',
    ])
    expect(within(card).getByRole('button', { name: 'Why: pain' })).toBeInTheDocument()
    expect(within(card).getByRole('button', { name: 'Why: heart rate' })).toBeInTheDocument()
    expect(within(card).getByRole('button', { name: 'Why: longest run' })).toBeInTheDocument()
    expectCleanCopy(card)
  })

  test('reads distances in miles for a runner who uses them', async () => {
    renderCard({ items: [LONGEST], more: 0 }, 'mi')
    expect(
      await screen.findByText('At 13 mi, this is your longest run in the last 12 weeks.'),
    ).toBeInTheDocument()
  })

  test('says nothing unusual when there is nothing to report', async () => {
    renderCard({ items: [], more: 0 })
    const card = await screen.findByRole('region', { name: 'What stood out' })
    expect(
      await within(card).findByText('Nothing unusual to report on this run.'),
    ).toBeInTheDocument()
    expect(within(card).queryByRole('list')).not.toBeInTheDocument()
    expect(within(card).queryByRole('button')).not.toBeInTheDocument()
    expectCleanCopy(card)
  })

  test('says so, quietly, when the facts did not load', async () => {
    renderCard({
      status: 500,
      body: { error: { code: 'internal', message: 'Something went wrong.' } },
    })
    const card = await screen.findByRole('region', { name: 'What stood out' })
    expect(
      await within(card).findByText(
        'What stood out could not be loaded. Reload the page to try again.',
      ),
    ).toBeInTheDocument()
    expect(within(card).queryByRole('alert')).not.toBeInTheDocument()
    expectCleanCopy(card)
  })

  test('requests only the facts of the run, and asks for the rules only when a Why is opened', async () => {
    const { api } = renderCard({ items: [PAIN], more: 0 })
    await screen.findByText(/Pain of 6 out of 10/)
    await settle()
    expect(api.calls.map((call) => `${call.method} ${call.url}`)).toEqual([
      'GET /api/activities/a1/standout',
    ])
  })

  test('a Why opens the drawer on the rule of the fact and on the thresholds', async () => {
    mockApi({
      ...settings('km'),
      'GET /api/activities/a1/standout': () => ({ items: [HEART_RATE], more: 0 }),
      'GET /api/research/params': () => ({ version: 'v', params: allParams() }),
    })
    renderWithProviders(<StandoutCard activityId="a1" units="km" />)
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Why: heart rate' }))

    const dialog = await screen.findByRole('dialog', { name: 'Why this?' })
    expect(
      await within(dialog).findByRole('heading', { name: 'Efficiency index' }),
    ).toBeInTheDocument()
    expect(
      within(dialog).getByRole('heading', { name: 'What stood out on a run' }),
    ).toBeInTheDocument()
    // The threshold the heart-rate finding rests on, in words.
    expect(
      await within(dialog).findByText(/a heart-rate comparison between runs is stated only/),
    ).toBeInTheDocument()
    expectCleanCopy(dialog)
  })
})
