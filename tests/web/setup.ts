import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach, vi } from 'vitest'
import { resetOutboxForTests } from '../../web/pwa/outbox.ts'
import { unmatchedCalls } from './helpers.tsx'

class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
vi.stubGlobal('ResizeObserver', ResizeObserverStub)

// jsdom has no layout, so nothing is ever near the viewport: sections that load once in view stay
// unloaded unless a test installs an observer that reports an intersection.
class IntersectionObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
  takeRecords(): IntersectionObserverEntry[] {
    return []
  }
}
vi.stubGlobal('IntersectionObserver', IntersectionObserverStub)

Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string): MediaQueryList => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }),
})

afterEach(() => {
  cleanup()
  // The outbox is one per page; a test starts with an empty one.
  resetOutboxForTests()
  // Restore the real fetch, but keep the stubs installed above.
  vi.unstubAllGlobals()
  vi.stubGlobal('ResizeObserver', ResizeObserverStub)
  vi.stubGlobal('IntersectionObserver', IntersectionObserverStub)
  const unmatched = unmatchedCalls.splice(0)
  if (unmatched.length > 0) {
    throw new Error(`Requests with no mock route: ${unmatched.join(', ')}`)
  }
})
