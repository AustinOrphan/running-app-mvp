import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test } from 'vitest'
import type { BriefListItem, TodayView } from '../../shared/types.ts'
import { makeItem, makeUpdate, makeView } from './brief-fixtures.ts'
import { expectCleanCopy, type MockRoutes } from './helpers.tsx'
import { makePreview, makeRevision } from './plan-fixtures.ts'
import { makeCoach, makeHero, makeToday } from './today-fixtures.ts'
import { renderToday, startToday } from './today-render.tsx'

// Monday on Today (build list item 3): an unopened brief that changed sessions leads the session
// column with Open and Undo, and a review that is due stands beside it.

beforeEach(startToday)

function dayWith(brief: BriefListItem | null, lastWeekReady = false): TodayView {
  const base = makeCoach()
  return makeToday({
    coach: makeCoach({
      hero: makeHero(),
      health: { possibleDuplicates: 0, pastUnconfirmedWeeks: 0, lastWeekReady, notes: [] },
      slots: { ...base.slots, brief },
    }),
  })
}

const withBrief = (over: Parameters<typeof makeView>[0] = {}): MockRoutes => ({
  'GET /api/brief': () => ({ brief: makeView(over) }),
})

describe('Today: the Monday card', () => {
  test('leads with the sentence, a link that opens the brief and the update’s undo', async () => {
    const { container } = renderToday(
      dayWith(makeItem({ seen: false, changeCount: 3 }), true),
      withBrief(),
    )
    const card = await screen.findByRole('region', { name: 'The plan was updated' })
    expect(card).toHaveTextContent('Since last week: 3 changes, next key session Saturday')
    expect(within(card).getByRole('link', { name: 'Open the brief' })).toHaveAttribute(
      'href',
      '/brief',
    )
    // Undo is the revision's own control: it reads what undoing would change before it acts.
    const undo = await within(card).findByRole('button', { name: 'Undo update' })
    expect(card.closest('[data-layout]')?.firstElementChild).toContainElement(card)
    expect(screen.getByRole('link', { name: /Review last week/ })).toHaveAttribute(
      'href',
      '/review',
    )
    expectCleanCopy(container)
    expect(undo).toBeEnabled()
  })

  test('Undo asks what it would change first, and nothing is undone by the first tap', async () => {
    const user = userEvent.setup()
    const { api } = renderToday(dayWith(makeItem({ seen: false, changeCount: 2 })), {
      ...withBrief(),
      'POST /api/plan/preview': () => makePreview(),
    })
    const card = await screen.findByRole('region', { name: 'The plan was updated' })
    await user.click(await within(card).findByRole('button', { name: 'Undo update' }))
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    expect(api.calls.filter((call) => call.url === '/api/plan/preview')).toHaveLength(1)
    expect(api.calls.some((call) => call.url.includes('/undo'))).toBe(false)
  })

  test('offers no undo for an update that cannot be undone, and still shows the card', async () => {
    renderToday(
      dayWith(makeItem({ seen: false, changeCount: 2 })),
      withBrief({ revision: makeRevision() }),
    )
    const card = await screen.findByRole('region', { name: 'The plan was updated' })
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Undo update' })).not.toBeInTheDocument()
    })
    expect(within(card).getByRole('link', { name: 'Open the brief' })).toBeInTheDocument()
  })

  test('stands without the undo when the brief cannot be read', async () => {
    renderToday(dayWith(makeItem({ seen: false, changeCount: 2 })), {
      'GET /api/brief': () => ({
        status: 500,
        body: { error: { code: 'internal', message: 'Server error' } },
      }),
    })
    const card = await screen.findByRole('region', { name: 'The plan was updated' })
    expect(within(card).getByRole('link', { name: 'Open the brief' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Undo update' })).not.toBeInTheDocument()
  })

  test.each([
    ['opened', { seen: true, changeCount: 3 }],
    ['undone', { seen: false, changeCount: 3, undone: true }],
    ['without changes', { seen: false, changeCount: 0 }],
  ])('a brief that is %s keeps its quiet line under the week', async (_name, over) => {
    renderToday(dayWith(makeItem(over), true))
    await screen.findByRole('link', { name: 'Last week is ready to review.' })
    expect(screen.queryByRole('region', { name: 'The plan was updated' })).not.toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Weekly brief' })).toBeInTheDocument()
  })

  test('the review link stands alone at the foot while the brief is not leading', async () => {
    renderToday(dayWith(null, true))
    expect(
      await screen.findByRole('link', { name: 'Last week is ready to review.' }),
    ).toHaveAttribute('href', '/review')
    expect(screen.queryByRole('link', { name: /Review last week/ })).not.toBeInTheDocument()
  })

  test('the update the card describes is the revision of the brief', () => {
    expect(makeUpdate().undo.available).toBe(true)
  })
})
