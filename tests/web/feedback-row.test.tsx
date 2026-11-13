import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { feedbackReport } from '../../shared/copy/feedback.ts'
import { keys } from '../../web/api/client.ts'
import { notePagePath, resetPageTrailForTests } from '../../web/pwa/pageTrail.ts'
import { SettingsPage } from '../../web/pages/SettingsPage.tsx'
import { makeTestQueryClient, mockApi, renderWithProviders } from './helpers.tsx'

// FB1: "Send feedback" in Settings builds a short plain-text note and copies it.

const EMAIL = 'runner@example.com'
// Figures from the fixture's plan and activities: none of them may reach the note.
const FIXTURE_NUMBERS = ['12345', '6789', '41.7']

const settingsRoutes = {
  'GET /api/settings': () => ({ email: EMAIL, displayName: null, units: 'km' }),
}

function Pages() {
  return (
    <Routes>
      <Route path="/settings" element={<SettingsPage />} />
    </Routes>
  )
}

/** A query cache that holds the plan and its revisions, as a page that has opened the Plan does. */
function clientWithPlan() {
  const queryClient = makeTestQueryClient()
  queryClient.setQueryData([keys.plan], {
    id: 'plan-abc',
    name: `Plan for ${EMAIL}`,
    weeks: [{ targetDistanceM: 12345, longRunMin: 6789 }],
    sessions: [{ distanceM: 12345, notes: '41.7 km' }],
  })
  queryClient.setQueryData(
    [keys.planRevisions],
    [{ id: 'r2', createdAt: '2026-11-10T08:30:00.000Z' }],
  )
  return queryClient
}

beforeEach(() => {
  resetPageTrailForTests()
  notePagePath('/plan')
  notePagePath('/settings')
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-12T10:00:00.000Z'))
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('the Send feedback row', () => {
  test('copies the note, with only the allowed lines, and shows Copied', async () => {
    mockApi(settingsRoutes)
    const user = userEvent.setup({ advanceTimers: () => {} })
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue()
    renderWithProviders(<Pages />, { route: '/settings', queryClient: clientWithPlan() })

    expect(await screen.findByRole('heading', { name: 'Send feedback' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Copy feedback note' }))

    expect(await screen.findByText('Copied')).toBeInTheDocument()
    expect(writeText).toHaveBeenCalledTimes(1)
    const text = writeText.mock.calls[0]?.[0] ?? ''
    const lines = text.split('\n')
    expect(lines).toEqual([
      'Paste this into a message to the person who runs this app.',
      '',
      'Page: /plan',
      'Build: dev',
      'Time: 2026-11-12T10:00:00.000Z',
      `Browser: ${navigator.userAgent}`,
      'Plan: plan-abc',
      'Plan last changed: 2026-11-10T08:30:00.000Z',
      '',
      'What happened:',
      '',
      '',
    ])
    expect(text).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.]+/)
    for (const number of FIXTURE_NUMBERS) expect(text).not.toContain(number)
    expect(screen.queryByRole('textbox', { name: 'Feedback note' })).not.toBeInTheDocument()
  })

  test('leaves out the plan lines when the page holds no plan, and the page when opened directly', async () => {
    resetPageTrailForTests()
    notePagePath('/settings')
    mockApi(settingsRoutes)
    const user = userEvent.setup({ advanceTimers: () => {} })
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue()
    renderWithProviders(<Pages />, { route: '/settings' })

    await user.click(await screen.findByRole('button', { name: 'Copy feedback note' }))
    await waitFor(() => {
      expect(writeText).toHaveBeenCalled()
    })
    const text = writeText.mock.calls[0]?.[0] ?? ''
    expect(text).toContain('Page: none (opened directly)')
    expect(text).not.toContain('Plan:')
    expect(text).not.toContain('Plan last changed:')
  })

  test('shows the note selected when the clipboard is unavailable', async () => {
    mockApi(settingsRoutes)
    const user = userEvent.setup({ advanceTimers: () => {} })
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('denied'))
    renderWithProviders(<Pages />, { route: '/settings', queryClient: clientWithPlan() })

    await user.click(await screen.findByRole('button', { name: 'Copy feedback note' }))

    const field = await screen.findByRole<HTMLTextAreaElement>('textbox', { name: 'Feedback note' })
    expect(field).toHaveAttribute('readonly')
    expect(field).toHaveFocus()
    expect(field.value).toContain('Page: /plan')
    expect(field.value).toContain('Plan: plan-abc')
    await waitFor(() => {
      expect(field.selectionStart).toBe(0)
      expect(field.selectionEnd).toBe(field.value.length)
    })
    expect(screen.getByText(/The clipboard is not available/)).toBeInTheDocument()
    expect(screen.queryByText('Copied')).not.toBeInTheDocument()
  })

  test('shows the note selected when there is no clipboard object', async () => {
    mockApi(settingsRoutes)
    const user = userEvent.setup({ advanceTimers: () => {} })
    renderWithProviders(<Pages />, { route: '/settings' })
    const button = await screen.findByRole('button', { name: 'Copy feedback note' })
    vi.stubGlobal('navigator', { userAgent: navigator.userAgent })
    await user.click(button)
    expect(await screen.findByRole('textbox', { name: 'Feedback note' })).toBeInTheDocument()
  })
})

describe('feedbackReport', () => {
  test('holds no request id and states each fact once', () => {
    const text = feedbackReport({
      fromPath: '/log',
      buildId: 'index-abc',
      at: '2026-11-12T10:00:00.000Z',
      userAgent: 'UA',
      planId: null,
      planRevisedAt: null,
    })
    expect(text.split('\n').filter((line) => line !== '')).toEqual([
      'Paste this into a message to the person who runs this app.',
      'Page: /log',
      'Build: index-abc',
      'Time: 2026-11-12T10:00:00.000Z',
      'Browser: UA',
      'What happened:',
    ])
  })
})
