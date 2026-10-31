import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createElement } from 'react'
import { describe, expect, test, vi } from 'vitest'
import { DoneSheet, ReplanSheet, warmSheets } from '../../web/components/lazySheets.tsx'

// The sheets are stood in for, so the test sees when their code is asked for and can make one fail
// to load. Each factory runs once, when its module is first imported.
const loaded = vi.hoisted(() => [] as string[])

vi.mock('../../web/components/disruption/ReplanSheet.tsx', async () => {
  const { createElement: h } = await import('react')
  loaded.push('ReplanSheet')
  return {
    ReplanSheet: ({ onClose }: { onClose: () => void }) =>
      h('button', { type: 'button', onClick: onClose }, 'Stand-in for the re-plan sheet'),
  }
})
vi.mock('../../web/components/today/DoneSheet.tsx', () => {
  loaded.push('DoneSheet')
  throw new Error('Failed to fetch dynamically imported module.')
})
vi.mock('../../web/components/today/CheckinSheet.tsx', () => {
  loaded.push('CheckinSheet')
  return { CheckinSheet: () => null }
})
vi.mock('../../web/components/fuel/FuelLogSheet.tsx', () => {
  loaded.push('FuelLogSheet')
  return { FuelLogSheet: () => null }
})
vi.mock('../../web/components/strength/StrengthSheet.tsx', () => {
  loaded.push('StrengthSheet')
  return { StrengthSheet: () => null }
})
vi.mock('../../web/components/strength/SetupSheets.tsx', () => {
  loaded.push('SetupSheets')
  return { StrengthSetupSheet: () => null }
})
vi.mock('../../web/components/disruption/NotFullSheet.tsx', () => {
  loaded.push('NotFullSheet')
  return { NotFullSheet: () => null }
})
vi.mock('../../web/components/disruption/WindowActionSheet.tsx', () => {
  loaded.push('WindowActionSheet')
  return { WindowActionSheet: () => null }
})
vi.mock('../../web/pages/RaceResultSheet.tsx', () => {
  loaded.push('RaceResultSheet')
  return { RaceResultSheet: () => null }
})

const SHEETS = [
  'CheckinSheet',
  'DoneSheet',
  'FuelLogSheet',
  'StrengthSheet',
  'SetupSheets',
  'NotFullSheet',
  'ReplanSheet',
  'WindowActionSheet',
  'RaceResultSheet',
]

describe('the sheets that open on a tap', () => {
  test('ask for no sheet code until one is opened', () => {
    expect(loaded).toEqual([])
  })

  test('open once their code has loaded, with the props the sheet takes', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(createElement(ReplanSheet, { onClose }))
    await user.click(await screen.findByRole('button', { name: 'Stand-in for the re-plan sheet' }))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(loaded).toEqual(['ReplanSheet'])
  })

  test('open a notice, not a blank page, when their code cannot be loaded', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(
      createElement(DoneSheet, {
        plan: { kind: 'easy', durationMin: 40, distanceM: 6000 },
        date: '2026-03-18',
        units: 'km',
        onClose,
        onSaved: vi.fn(),
      }),
    )
    const sheet = await screen.findByRole('dialog', { name: 'This did not open' })
    expect(within(sheet).getByRole('alert')).toHaveTextContent(
      'This part of the app did not load. Reload the page to try again.',
    )
    await user.click(within(sheet).getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  test('are all fetched once the app is idle, and a sheet that will not load is left to itself', async () => {
    vi.stubGlobal('requestIdleCallback', (run: () => void) => {
      run()
      return 1
    })
    warmSheets()
    await waitFor(() => {
      expect([...new Set(loaded)].sort()).toEqual([...SHEETS].sort())
    })
  })
})
