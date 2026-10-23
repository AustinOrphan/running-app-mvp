import { vi } from 'vitest'
import type { TodayView, Units } from '../../shared/types.ts'
import { ToastProvider } from '../../web/components/Toast.tsx'
import { DashboardPage } from '../../web/pages/DashboardPage.tsx'
import { mockApi, renderWithProviders, type MockRoutes } from './helpers.tsx'

/**
 * Starts a Today test: the fixed clock (Wednesday 2026-03-18, noon) and no stored state on the
 * device, so the disclosure starts closed.
 */
export function startToday(): void {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 2, 18, 12, 0, 0))
  window.localStorage.clear()
}

export function settingsOf(units: Units = 'mi') {
  return { email: 'runner@example.com', displayName: null, units }
}

/**
 * Renders the Today page against a payload. Only the two requests of the first screen are
 * mocked, so a request for anything else fails the test (tests/web/setup.ts); `extra` adds the
 * routes a test exercises (a save, the history sections).
 */
export function renderToday(today: TodayView, extra: MockRoutes = {}, units: Units = 'mi') {
  const api = mockApi({
    'GET /api/today': () => today,
    'GET /api/settings': () => settingsOf(units),
    ...extra,
  })
  const view = renderWithProviders(
    <ToastProvider>
      <DashboardPage />
    </ToastProvider>,
  )
  return { api, ...view }
}

/** Makes every `IntersectionObserver` report an intersection at once, as if scrolled to the foot. */
export function scrollToFoot(): void {
  class Intersecting {
    private readonly callback: IntersectionObserverCallback
    constructor(callback: IntersectionObserverCallback) {
      this.callback = callback
    }
    observe(target: Element): void {
      this.callback(
        [{ isIntersecting: true, target } as IntersectionObserverEntry],
        this as unknown as IntersectionObserver,
      )
    }
    unobserve(): void {}
    disconnect(): void {}
    takeRecords(): IntersectionObserverEntry[] {
      return []
    }
  }
  vi.stubGlobal('IntersectionObserver', Intersecting)
}
