import { act, renderHook, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { MAP_TILES_KEY, useMapTiles } from '../../web/components/map/useMapTiles.ts'
import { ToastProvider } from '../../web/components/Toast.tsx'
import { SettingsPage } from '../../web/pages/SettingsPage.tsx'
import { mockApi, renderWithProviders } from './helpers.tsx'

beforeEach(() => {
  localStorage.removeItem(MAP_TILES_KEY)
})
afterEach(() => {
  vi.restoreAllMocks()
  // one write that works clears any write failure a test left behind
  renderHook(() => useMapTiles()).result.current.setOn(true)
  localStorage.removeItem(MAP_TILES_KEY)
})

describe('the Map tiles switch', () => {
  test('is on by default, persists once turned off and reads the choice after a reload', () => {
    const first = renderHook(() => useMapTiles())
    expect(first.result.current.on).toBe(true)
    act(() => {
      first.result.current.setOn(false)
    })
    expect(first.result.current.on).toBe(false)
    expect(localStorage.getItem(MAP_TILES_KEY)).toBe('off')
    first.unmount()

    const second = renderHook(() => useMapTiles())
    expect(second.result.current.on).toBe(false)
    act(() => {
      second.result.current.setOn(true)
    })
    expect(localStorage.getItem(MAP_TILES_KEY)).toBe('on')
  })

  test('reads as on where storage is blocked, and holds a choice for the page', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    const { result } = renderHook(() => useMapTiles())
    expect(result.current.on).toBe(true)
    act(() => {
      result.current.setOn(false)
    })
    expect(result.current.on).toBe(false)
  })
})

describe('the Map tiles setting', () => {
  test('is a checkbox in the Maps section, checked, with the privacy line, and stays on this device', async () => {
    const { calls } = mockApi({
      'GET /api/settings': () => ({
        email: 'runner@example.com',
        displayName: null,
        units: 'mi',
        weightUnit: 'lb',
        showBodyWeight: false,
        hideMapEnds: true,
      }),
      'GET /api/auth/me': () => ({ id: 'u1', email: 'runner@example.com', displayName: null }),
    })
    renderWithProviders(
      <ToastProvider>
        <Routes>
          <Route path="/settings" element={<SettingsPage />} />
        </Routes>
      </ToastProvider>,
      { route: '/settings' },
    )
    const typist = userEvent.setup()

    await screen.findByRole('heading', { name: 'Settings' })
    const box = screen.getByRole('checkbox', { name: 'Map tiles' })
    expect(box).toBeChecked()
    expect(box).toHaveAccessibleDescription(
      'Loads map tiles from OpenStreetMap, which sees the area of each run you open (the tile addresses, not the route). This device only.',
    )
    await typist.click(box)
    expect(box).not.toBeChecked()
    expect(localStorage.getItem(MAP_TILES_KEY)).toBe('off')
    // nothing was sent to the server
    expect(calls.filter((c) => c.method === 'PUT')).toEqual([])
  })
})
