import { act, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, test } from 'vitest'
import type { DisruptionSlot as DisruptionSlotData } from '../../shared/types.ts'
import { DisruptionSlot } from '../../web/components/today/DisruptionSlot.tsx'
import { renderWithProviders } from './helpers.tsx'
import { makeWindow } from './plan-fixtures.ts'
import { makeCoach, makeToday } from './today-fixtures.ts'

const ASK = 'Set a rest window and a return plan?'

const viewOf = (slot: DisruptionSlotData | null) =>
  makeToday({ coach: makeCoach({ slots: { ...makeCoach().slots, disruption: slot } }) })

let arrive: (slot: DisruptionSlotData | null) => void = () => {}

/** The slot under the main landmark that the layout supplies, with the payload it is given. */
function Harness({ initial }: { initial: DisruptionSlotData | null }) {
  const [slot, setSlot] = useState(initial)
  arrive = setSlot
  return (
    <main id="main" tabIndex={-1}>
      <button type="button">Before</button>
      <DisruptionSlot view={viewOf(slot)} units="km" />
    </main>
  )
}

describe('the Today disruption slot: focus and announcement', () => {
  test('"Not now" moves focus to the main landmark instead of dropping it to the page', async () => {
    const user = userEvent.setup()
    renderWithProviders(<Harness initial={{ windows: [], offer: true }} />)
    const notNow = await screen.findByRole('button', { name: 'Not now' })
    notNow.focus()
    expect(notNow).toHaveFocus()

    await user.keyboard('{Enter}')
    expect(screen.queryByRole('region', { name: 'Rest window offer' })).not.toBeInTheDocument()
    expect(screen.getByRole('main')).toHaveFocus()
  })

  test('"Not now" leaves focus alone when it is already somewhere else', async () => {
    renderWithProviders(<Harness initial={{ windows: [], offer: true }} />)
    const offer = await screen.findByRole('region', { name: 'Rest window offer' })
    const before = screen.getByRole('button', { name: 'Before' })
    // A pointer press on a button that does not take focus (Safari) leaves it where it was.
    before.focus()
    act(() => {
      within(offer).getByRole('button', { name: 'Not now' }).click()
    })
    expect(screen.queryByRole('region', { name: 'Rest window offer' })).not.toBeInTheDocument()
    expect(before).toHaveFocus()
  })

  test('the offer is said by a live region that was already in the page when it arrived', async () => {
    renderWithProviders(<Harness initial={null} />)
    const status = await screen.findByRole('status')
    expect(status).toBeEmptyDOMElement()
    expect(screen.queryByRole('region', { name: 'Rest window offer' })).not.toBeInTheDocument()

    // A check-in that reports illness is saved and Today is read again.
    act(() => {
      arrive({ windows: [], offer: true })
    })
    expect(await screen.findByRole('region', { name: 'Rest window offer' })).toBeInTheDocument()
    expect(screen.getByRole('status')).toBe(status)
    expect(status).toHaveTextContent(ASK)

    // Taken away, it says nothing more.
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Not now' }))
    expect(screen.getByRole('status')).toBe(status)
    expect(status).toBeEmptyDOMElement()
  })

  test('a window in effect says nothing, and the status does not wrap the slot', async () => {
    const window = makeWindow({
      startDate: '2026-03-16',
      endDate: '2026-03-20',
      runFrom: '2026-03-22',
      qualityFrom: '2026-03-25',
    })
    renderWithProviders(<Harness initial={{ windows: [window], offer: false }} />)
    const banner = await screen.findByRole('region', { name: 'Rest window' })
    const status = screen.getByRole('status')
    expect(status).toBeEmptyDOMElement()
    // The page styles `[data-slot]` as a child of its column (`DashboardPage.module.css`), so the
    // status is a sibling of the slot, not its parent.
    const slot = banner.closest('[data-slot]')
    expect(slot?.parentElement).toBe(screen.getByRole('main'))
    expect(status.parentElement).toBe(screen.getByRole('main'))
    expect(status.contains(slot)).toBe(false)
  })
})
