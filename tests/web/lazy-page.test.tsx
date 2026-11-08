import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Component as ReactComponent, StrictMode, Suspense, type ReactNode } from 'react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { lazyPage, warmPages, type Page } from '../../web/lazyPage.tsx'

function setOnline(online: boolean): void {
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(online)
}

function renderPage(page: Page) {
  const { Component } = page
  return render(
    <Suspense fallback={<p>Loading</p>}>
      <Component />
    </Suspense>,
  )
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('a lazy page that did not load', () => {
  test('shows the failed-load state, and Try again runs the import again and opens the page', async () => {
    const user = userEvent.setup()
    setOnline(true)
    let calls = 0
    const page = lazyPage(() => {
      calls += 1
      return calls === 1
        ? Promise.reject(new Error('Failed to fetch dynamically imported module.'))
        : Promise.resolve(() => <h1>The page</h1>)
    })
    renderPage(page)
    expect(await screen.findByRole('alert')).toHaveTextContent('This page did not load.')
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('heading', { name: 'The page' })).toBeInTheDocument()
    // The import ran again (the retry, then the fresh lazy component) and the page opened.
    expect(calls).toBeGreaterThanOrEqual(2)
  })

  test('offline, a failed retry stays on the failed-load state and does not reload the document', async () => {
    const user = userEvent.setup()
    setOnline(false)
    const reload = vi.fn()
    vi.stubGlobal('location', { ...window.location, reload })
    const page = lazyPage(() => Promise.reject(new Error('offline')))
    renderPage(page)
    await screen.findByRole('alert')
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    await screen.findByRole('alert')
    expect(screen.getByRole('button', { name: 'Try again' })).not.toHaveAttribute(
      'aria-busy',
      'true',
    )
    expect(reload).not.toHaveBeenCalled()
  })

  test('under Strict Mode an offline retry still clears its busy state', async () => {
    const user = userEvent.setup()
    setOnline(false)
    const page = lazyPage(() => Promise.reject(new Error('offline')))
    const { Component } = page
    render(
      <StrictMode>
        <Suspense fallback={<p>Loading</p>}>
          <Component />
        </Suspense>
      </StrictMode>,
    )
    await screen.findByRole('alert')
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    await vi.waitFor(() => {
      expect(screen.getByRole('button', { name: 'Try again' })).not.toHaveAttribute(
        'aria-busy',
        'true',
      )
    })
  })

  test('a page that loaded and then throws on render is not shown as a failed load', () => {
    setOnline(true)
    vi.spyOn(console, 'error').mockImplementation(() => {})
    function Broken(): never {
      throw new TypeError('x is undefined')
    }
    const page = lazyPage(() => Promise.resolve(Broken))
    const { Component } = page
    class Outer extends ReactComponent<{ children: ReactNode }, { error: Error | null }> {
      override state = { error: null as Error | null }
      static getDerivedStateFromError(error: Error) {
        return { error }
      }
      override render() {
        return this.state.error ? <p>Outer: {this.state.error.message}</p> : this.props.children
      }
    }
    render(
      <Outer>
        <Suspense fallback={<p>Loading</p>}>
          <Component />
        </Suspense>
      </Outer>,
    )
    return screen.findByText('Outer: x is undefined').then(() => {
      expect(screen.queryByText(/did not load/)).not.toBeInTheDocument()
    })
  })

  test('online, a second failure reloads the document', async () => {
    const user = userEvent.setup()
    setOnline(true)
    const reload = vi.fn()
    vi.stubGlobal('location', { ...window.location, reload })
    const page = lazyPage(() => Promise.reject(new Error('gone')))
    renderPage(page)
    await screen.findByRole('alert')
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    await vi.waitFor(() => {
      expect(reload).toHaveBeenCalledTimes(1)
    })
  })
})

describe('warming the tab routes', () => {
  function pageWith(load: () => Promise<unknown>): Page {
    return { Component: () => null, load }
  }

  test('fetches every page once the app is idle', () => {
    vi.stubGlobal('requestIdleCallback', (run: () => void) => {
      run()
      return 1
    })
    const load = vi.fn(() => Promise.resolve())
    warmPages([pageWith(load), pageWith(load)])
    expect(load).toHaveBeenCalledTimes(2)
  })

  test.each([
    ['Save-Data', { saveData: true }],
    ['a 2g connection', { effectiveType: '2g' }],
  ])('fetches nothing on %s', (_name, connection) => {
    vi.stubGlobal('requestIdleCallback', (run: () => void) => {
      run()
      return 1
    })
    vi.stubGlobal('navigator', { ...navigator, onLine: true, connection })
    const load = vi.fn(() => Promise.resolve())
    warmPages([pageWith(load)])
    expect(load).not.toHaveBeenCalled()
  })
})
