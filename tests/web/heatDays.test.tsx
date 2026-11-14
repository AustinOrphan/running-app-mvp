import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { HeatMarkPicker } from '../../web/components/FeelPicker.tsx'
import { makeActivity } from '../factories.ts'
import { makeCoach, makeHeat, makeHero, makeSession, makeToday } from './today-fixtures.ts'
import { renderToday, startToday } from './today-render.tsx'

// The heat mark on a rating and the Today note about heat days (rule I8, task HT1). The fixed
// clock is Wednesday 2026-03-18.

beforeEach(startToday)

afterEach(() => {
  vi.useRealTimers()
})

describe('HeatMarkPicker', () => {
  test('offers none, a warm room, and hot bath or sauna after; none is the cleared state', async () => {
    const onChange = vi.fn()
    render(<HeatMarkPicker value={null} onChange={onChange} />)
    const group = screen.getByRole('group', { name: 'Heat' })
    const buttons = within(group).getAllByRole('button')
    expect(buttons.map((b) => b.textContent)).toEqual([
      'None',
      'Ran in a warm room (25 °C or more)',
      'Hot bath or sauna after',
    ])
    expect(buttons[0]).toHaveAttribute('aria-pressed', 'true')
    await userEvent.click(within(group).getByRole('button', { name: 'Hot bath or sauna after' }))
    expect(onChange).toHaveBeenLastCalledWith('passive')
    await userEvent.click(
      within(group).getByRole('button', { name: 'Ran in a warm room (25 °C or more)' }),
    )
    expect(onChange).toHaveBeenLastCalledWith('warm-room')
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
      makeToday({
        heat: makeHeat({ heatDays: true }),
        unrated: [makeActivity({ id: 'r1', date: '2026-03-17', type: 'run' })],
      }),
      { 'PUT /api/activities/r1/feedback': () => ({}) },
    )
    const card = await screen.findByRole('region', { name: 'How did it go?' })
    expect(within(card).getByRole('button', { name: 'Save' })).toBeDisabled()
    await user.click(
      within(card).getByRole('button', { name: 'Ran in a warm room (25 °C or more)' }),
    )
    expect(within(card).getByRole('button', { name: 'Save' })).toBeEnabled()
    await user.click(within(card).getByRole('button', { name: 'Save' }))
    await waitFor(() => {
      expect(api.calls.some((c) => c.method === 'PUT')).toBe(true)
    })
    expect(api.calls.find((c) => c.method === 'PUT')?.body).toEqual({
      feel: null,
      pain: null,
      heatExposure: 'warm-room',
    })
    // only the mark changed, so the toast says so
    expect(await screen.findByText('Heat saved.')).toBeInTheDocument()
  })

  test('the control is offered on a run only while Today says what counts, or when marked', async () => {
    const run = makeActivity({ id: 'r1', date: '2026-03-17', type: 'run' })
    const marked = makeActivity({
      id: 'r2',
      date: '2026-03-16',
      type: 'run',
      heatExposure: 'passive',
    })
    const race = makeActivity({ id: 'r3', date: '2026-03-15', type: 'race' })
    // suggestion off: no control on an unmarked run or a race, but a marked run keeps its mark
    renderToday(makeToday({ unrated: [run, marked, race] }))
    const card = await screen.findByRole('region', { name: 'How did it go?' })
    expect(within(card).queryAllByRole('group', { name: 'Heat' })).toHaveLength(0)
    await userEvent.click(within(card).getByRole('button', { name: /^Rate run Mon 16 Mar/ }))
    expect(within(card).getAllByRole('group', { name: 'Heat' })).toHaveLength(1)
    expect(within(card).getByRole('button', { name: 'Hot bath or sauna after' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })

  test('with the suggestion on, a run shows the control and its safety disclosure, a race does not', async () => {
    const run = makeActivity({ id: 'r1', date: '2026-03-17', type: 'run' })
    const race = makeActivity({ id: 'r3', date: '2026-03-15', type: 'race' })
    renderToday(makeToday({ heat: makeHeat({ heatDays: true }), unrated: [run, race] }))
    const card = await screen.findByRole('region', { name: 'How did it go?' })
    expect(within(card).getAllByRole('group', { name: 'Heat' })).toHaveLength(1)
    await userEvent.click(within(card).getByText('How to do it safely'))
    expect(within(card).getByText('Stand up slowly afterwards.')).toBeVisible()
    await userEvent.click(within(card).getByRole('button', { name: /^Rate race/ }))
    expect(within(card).getAllByRole('group', { name: 'Heat' })).toHaveLength(1)
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
    'Heat days count from runs at 25 °C or more, outdoors or in a warm room, or a hot bath or sauna after an easy run.'

  test('says what counts, as an option, with the safety lines behind a closed disclosure', async () => {
    const user = userEvent.setup()
    renderToday(makeToday({ heat: makeHeat({ heatDays: true }) }))
    const note = await screen.findByRole('region', { name: 'Heat days before a warm race' })
    expect(within(note).getByText(COUNTS)).toBeVisible()
    expect(within(note).getByText('This is an option, not a target.')).toBeVisible()

    const disclosure = within(note).getByText('How to do it safely').closest('details')!
    expect(disclosure).not.toHaveAttribute('open')
    await user.click(within(note).getByText('How to do it safely'))
    expect(disclosure).toHaveAttribute('open')
    const lines = within(disclosure)
      .getAllByRole('listitem')
      .map((li) => li.textContent)
    expect(within(disclosure).getByText(/^The trials used about 40 minutes in water/)).toBeVisible()
    expect(lines).toEqual([
      'Drink before and after.',
      'Start shorter than that.',
      'Do not go hotter than that.',
      'Not after a hard or long run, or a run in the heat.',
      'Not when you are unwell, feverish or dehydrated.',
      'No alcohol before or during.',
      'Do not do it alone at first.',
      'Stand up slowly afterwards.',
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

describe('Today: the hero rating with the heat mark', () => {
  const TODAY_RUN = '2026-03-18'
  const run = makeActivity({ id: 'h1', date: TODAY_RUN, type: 'run', durationSec: 2700 })
  const session = makeSession({ status: 'completed', activityId: 'h1' })
  const day = (heatDays: boolean) =>
    makeToday({
      heat: makeHeat({ heatDays }),
      sessions: [{ session, advice: 'as-planned', reasons: [] }],
      coach: makeCoach({ hero: makeHero({ session, linkedRun: run }) }),
      unrated: [run],
    })

  test('offers the mark with the suggestion on, and a heat-only save says "Heat saved."', async () => {
    const user = userEvent.setup()
    const { api } = renderToday(day(true), { 'PUT /api/activities/h1/feedback': () => ({}) })
    const ask = await screen.findByRole('region', { name: 'Rate this run' })
    await user.click(within(ask).getByRole('button', { name: 'Hot bath or sauna after' }))
    await user.click(within(ask).getByRole('button', { name: 'Save rating' }))
    // the line that replaces the form, and the toast
    expect((await screen.findAllByText('Heat saved.')).length).toBeGreaterThanOrEqual(1)
    const puts = api.calls.filter((c) => c.method === 'PUT')
    expect(puts).toHaveLength(1)
    expect(puts[0]).toMatchObject({
      url: '/api/activities/h1/feedback',
      body: { feel: null, heatExposure: 'passive' },
    })
  })

  test('does not offer the mark with the suggestion off', async () => {
    renderToday(day(false))
    const ask = await screen.findByRole('region', { name: 'Rate this run' })
    expect(within(ask).queryByRole('group', { name: 'Heat' })).not.toBeInTheDocument()
  })
})
