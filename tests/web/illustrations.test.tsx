import { act, renderHook, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { EmptyState } from '../../web/components/EmptyState.tsx'
import { ErrorState } from '../../web/components/ErrorState.tsx'
import {
  ILLUSTRATIONS_KEY,
  useIllustrations,
} from '../../web/components/illustrations/useIllustrations.ts'
import { renderWithProviders } from './helpers.tsx'

const ART_KEYS = ['runs', 'plan', 'offline', 'load', 'race', 'trends', 'strength', 'paces'] as const

beforeEach(() => {
  localStorage.removeItem(ILLUSTRATIONS_KEY)
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  // one write that works clears any write failure a test left behind
  renderHook(() => useIllustrations()).result.current.setOn(false)
  localStorage.removeItem(ILLUSTRATIONS_KEY)
})

function art(container: HTMLElement) {
  return container.querySelectorAll('svg[data-art]')
}

describe('the Illustrations switch', () => {
  test('is off by default and persists once set', () => {
    const first = renderHook(() => useIllustrations())
    expect(first.result.current.on).toBe(false)
    act(() => {
      first.result.current.setOn(true)
    })
    expect(first.result.current.on).toBe(true)
    expect(localStorage.getItem(ILLUSTRATIONS_KEY)).toBe('on')
    first.unmount()

    // a new mount, as after a reload, reads the stored choice
    const second = renderHook(() => useIllustrations())
    expect(second.result.current.on).toBe(true)
    act(() => {
      second.result.current.setOn(false)
    })
    expect(second.result.current.on).toBe(false)
    expect(localStorage.getItem(ILLUSTRATIONS_KEY)).toBe('off')
  })

  test('reads as off, and holds for the page, where storage is blocked', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    const { result } = renderHook(() => useIllustrations())
    expect(result.current.on).toBe(false)
    act(() => {
      result.current.setOn(true)
    })
    expect(result.current.on).toBe(true)
    act(() => {
      result.current.setOn(false)
    })
    expect(result.current.on).toBe(false)
  })
})

describe('the switch where storage can be read but not written', () => {
  test('holds the choice for the page when setItem throws', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota')
    })
    const { result } = renderHook(() => useIllustrations())
    act(() => {
      result.current.setOn(true)
    })
    expect(result.current.on).toBe(true)
    act(() => {
      result.current.setOn(false)
    })
    expect(result.current.on).toBe(false)
    vi.restoreAllMocks()
    // a later write that works goes back to the stored value
    act(() => {
      result.current.setOn(true)
    })
    expect(localStorage.getItem(ILLUSTRATIONS_KEY)).toBe('on')
    expect(result.current.on).toBe(true)
  })
})

describe('EmptyState', () => {
  test.each(ART_KEYS)(
    'draws "%s" only while the switch is on, hidden from assistive tech',
    (key) => {
      const off = renderWithProviders(<EmptyState title="Nothing here." art={key} />)
      expect(art(off.container)).toHaveLength(0)
      off.unmount()

      localStorage.setItem(ILLUSTRATIONS_KEY, 'on')
      const on = renderWithProviders(<EmptyState title="Nothing here." art={key} />)
      const drawn = art(on.container)
      expect(drawn).toHaveLength(1)
      expect(drawn[0]).toHaveAttribute('data-art', key)
      expect(drawn[0]).toHaveAttribute('aria-hidden', 'true')
      expect(screen.getByText('Nothing here.')).toBeInTheDocument()
    },
  )

  test('draws nothing without an art key, even with the switch on', () => {
    localStorage.setItem(ILLUSTRATIONS_KEY, 'on')
    const { container } = renderWithProviders(<EmptyState title="Nothing here." />)
    expect(art(container)).toHaveLength(0)
  })
})

describe('ErrorState', () => {
  test('draws the load art only while the switch is on', () => {
    const off = renderWithProviders(<ErrorState subject="Goals" onRetry={() => undefined} />)
    expect(art(off.container)).toHaveLength(0)
    off.unmount()

    localStorage.setItem(ILLUSTRATIONS_KEY, 'on')
    const on = renderWithProviders(<ErrorState subject="Goals" onRetry={() => undefined} />)
    const drawn = art(on.container)
    expect(drawn).toHaveLength(1)
    expect(drawn[0]).toHaveAttribute('data-art', 'load')
    expect(drawn[0]).toHaveAttribute('aria-hidden', 'true')
  })

  test('draws the offline art while the browser is offline', () => {
    localStorage.setItem(ILLUSTRATIONS_KEY, 'on')
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    const { container } = renderWithProviders(
      <ErrorState subject="Goals" onRetry={() => undefined} />,
    )
    expect(art(container)[0]).toHaveAttribute('data-art', 'offline')
  })

  test('art={false} draws none', () => {
    localStorage.setItem(ILLUSTRATIONS_KEY, 'on')
    const { container } = renderWithProviders(
      <ErrorState subject="Goals" onRetry={() => undefined} art={false} />,
    )
    expect(art(container)).toHaveLength(0)
  })
})
