import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { keys } from '../../web/api/client.ts'
import { DoneSheet } from '../../web/components/today/DoneSheet.tsx'
import { ToastProvider } from '../../web/components/Toast.tsx'

const DATE = '2026-03-18'

function open(userId: string | null) {
  const queryClient = new QueryClient()
  if (userId !== null) queryClient.setQueryData([keys.me], { id: userId })
  return render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <DoneSheet
          plan={{ kind: 'easy', durationMin: 40, distanceM: 6000 }}
          date={DATE}
          units="km"
          onClose={vi.fn()}
          onSaved={vi.fn()}
        />
      </ToastProvider>
    </QueryClientProvider>,
  )
}

const sheet = () => screen.findByRole('dialog', { name: "Log today's run" })

beforeEach(() => {
  window.localStorage.clear()
})

describe('the Done draft', () => {
  test('is kept under the signed-in user and the day', async () => {
    const user = userEvent.setup()
    open('u-a')
    const dialog = await sheet()
    await user.click(within(dialog).getByRole('button', { name: 'RPE 6' }))
    expect(JSON.parse(window.localStorage.getItem(`rl_done_draft_u-a_${DATE}`) ?? 'null')).toEqual({
      duration: '40',
      distance: '6',
      rpe: 6,
      feel: null,
    })
    expect(window.localStorage.getItem(`rl_done_draft_${DATE}`)).toBeNull()
  })

  test('is not opened by a second account on the same browser', async () => {
    const user = userEvent.setup()
    const first = open('u-a')
    const dialog = await sheet()
    const duration = within(dialog).getByRole('textbox', { name: 'Duration' })
    await user.clear(duration)
    await user.type(duration, '52')
    first.unmount()

    open('u-b')
    const other = await sheet()
    expect(within(other).getByRole('textbox', { name: 'Duration' })).toHaveValue('40')
  })

  test('is found again by the user who left it', async () => {
    const user = userEvent.setup()
    const first = open('u-a')
    const dialog = await sheet()
    const duration = within(dialog).getByRole('textbox', { name: 'Duration' })
    await user.clear(duration)
    await user.type(duration, '52')
    first.unmount()

    open('u-a')
    const again = await sheet()
    expect(within(again).getByRole('textbox', { name: 'Duration' })).toHaveValue('52')
  })
})
