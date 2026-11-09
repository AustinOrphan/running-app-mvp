import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { HeatMarkPicker } from '../../web/components/FeelPicker.tsx'
import { makeActivity } from '../factories.ts'
import { makeHeat, makeToday } from './today-fixtures.ts'
import { renderToday, startToday } from './today-render.tsx'

// The heat mark on a rating and the Today note about heat days (rule I8, task HT1). The fixed
// clock is Wednesday 2026-03-18.

beforeEach(startToday)

afterEach(() => {
  vi.useRealTimers()
})

describe('HeatMarkPicker', () => {
  test('offers none, overdressed or warm room, and hot bath or sauna after; none is the cleared state', async () => {
    const onChange = vi.fn()
    render(<HeatMarkPicker value={null} onChange={onChange} />)
    const group = screen.getByRole('group', { name: 'Heat' })
    const buttons = within(group).getAllByRole('button')
    expect(buttons.map((b) => b.textContent)).toEqual([
      'None',
      'Ran overdressed or in a warm room',
      'Hot bath or sauna after',
    ])
    expect(buttons[0]).toHaveAttribute('aria-pressed', 'true')
    await userEvent.click(within(group).getByRole('button', { name: 'Hot bath or sauna after' }))
    expect(onChange).toHaveBeenLastCalledWith('passive')
    await userEvent.click(
      within(group).getByRole('button', { name: 'Ran overdressed or in a warm room' }),
    )
    expect(onChange).toHaveBeenLastCalledWith('overdressed')
  })

  test('a second tap on the chosen mark clears it', async () => {
    const onChange = vi.fn()
    render(<HeatMarkPicker value="passive" onChange={onChange} />)
    const chosen = screen.getByRole('button', { name: 'Hot bath or sauna after' })
    expect(chosen).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'None' })).toHaveAttribute('aria-pressed', 'false')
    await userEvent.click(chosen)
    expect(onChange).toHaveBeenLastCalledWith(null)
  })
})

describe('Today: the heat mark on the rating card', () => {
  test('a heat mark alone enables Save and goes up with the rating write', async () => {
    const user = userEvent.setup()
    const { api } = renderToday(
      makeToday({ unrated: [makeActivity({ id: 'r1', date: '2026-03-17', type: 'run' })] }),
      { 'PUT /api/activities/r1/feedback': () => ({}) },
    )
    const card = await screen.findByRole('region', { name: 'How did it go?' })
    expect(within(card).getByRole('button', { name: 'Save' })).toBeDisabled()
    await user.click(
      within(card).getByRole('button', { name: 'Ran overdressed or in a warm room' }),
    )
    expect(within(card).getByRole('button', { name: 'Save' })).toBeEnabled()
    await user.click(within(card).getByRole('button', { name: 'Save' }))
    await waitFor(() => {
      expect(api.calls.some((c) => c.method === 'PUT')).toBe(true)
    })
    expect(api.calls.find((c) => c.method === 'PUT')?.body).toEqual({
      rpe: null,
      feel: null,
      pain: null,
      heatExposure: 'overdressed',
    })
  })

  test('starts from the saved mark so a rating that only sets RPE keeps it', async () => {
    const user = userEvent.setup()
    const { api } = renderToday(
      makeToday({
        unrated: [
          makeActivity({ id: 'r1', date: '2026-03-17', type: 'run', heatExposure: 'passive' }),
        ],
      }),
      { 'PUT /api/activities/r1/feedback': () => ({}) },
    )
    const card = await screen.findByRole('region', { name: 'How did it go?' })
    expect(within(card).getByRole('button', { name: 'Hot bath or sauna after' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(within(card).getByRole('button', { name: 'Save' })).toBeDisabled()
    await user.click(within(card).getByRole('button', { name: 'RPE 3' }))
    await user.click(within(card).getByRole('button', { name: 'Save' }))
    await waitFor(() => {
      expect(api.calls.some((c) => c.method === 'PUT')).toBe(true)
    })
    expect(api.calls.find((c) => c.method === 'PUT')?.body).toMatchObject({
      rpe: 3,
      heatExposure: 'passive',
    })
  })
})

describe('Today: the note about heat days', () => {
  const COUNTS =
    'Heat days count from runs at 25 °C or more, runs in extra layers or a warm room, or a hot bath or sauna after an easy run.'

  test('says what counts, as an option, with the safety lines behind a closed disclosure', async () => {
    const user = userEvent.setup()
    renderToday(makeToday({ heat: makeHeat({ heatDays: true }) }))
    const note = await screen.findByRole('region', { name: 'Heat days before a warm race' })
    expect(within(note).getByText(COUNTS)).toBeVisible()
    expect(within(note).getByText(/option, not a target/)).toBeVisible()

    const disclosure = within(note).getByText('How to do it safely').closest('details')!
    expect(disclosure).not.toHaveAttribute('open')
    await user.click(within(note).getByText('How to do it safely'))
    expect(disclosure).toHaveAttribute('open')
    const lines = within(disclosure)
      .getAllByRole('listitem')
      .map((li) => li.textContent)
    expect(lines).toEqual([
      'Drink before and after.',
      'Start shorter than you think you need to.',
      'Do not do it alone at first.',
      'Get out if you feel dizzy, sick or confused.',
      'Skip it with a heart or blood-pressure condition, in pregnancy, or on medicines that change how you handle heat, and ask a clinician.',
    ])
  })

  test('never states a count of days or one that is missing', async () => {
    renderToday(makeToday({ heat: makeHeat({ heatDays: true }) }))
    const note = await screen.findByRole('region', { name: 'Heat days before a warm race' })
    expect(note.textContent).not.toMatch(/\d+ (more )?days|behind|missed|missing|streak|badge|!/i)
  })

  test('offers the Explain of the rule', async () => {
    renderToday(makeToday({ heat: makeHeat({ heatDays: true }) }))
    const note = await screen.findByRole('region', { name: 'Heat days before a warm race' })
    expect(within(note).getByRole('button', { name: /heat days/i })).toBeInTheDocument()
  })

  test('is absent when the race is not expected warm or the block is closed', async () => {
    renderToday(makeToday({ heat: makeHeat({ heatDays: false }) }))
    await screen.findByText(/No plan yet/)
    expect(
      screen.queryByRole('region', { name: 'Heat days before a warm race' }),
    ).not.toBeInTheDocument()
  })
})
