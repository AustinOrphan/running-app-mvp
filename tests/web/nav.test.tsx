import { fireEvent, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { Layout, useTheme } from '../../web/components/Layout.tsx'
import { Nav } from '../../web/components/Nav.tsx'
import { renderWithProviders } from './helpers.tsx'

function primaryLinks() {
  return within(screen.getByRole('navigation', { name: 'Primary' })).getAllByRole('link')
}

describe('Nav', () => {
  test('five items in order; exactly one is current', () => {
    renderWithProviders(<Nav />, { route: '/plan' })
    const links = primaryLinks()
    expect(links.map((l) => l.textContent)).toEqual(['Today', 'Log', 'Plan', 'Review', 'More'])
    expect(links.map((l) => l.getAttribute('href'))).toEqual([
      '/',
      '/activities',
      '/plan',
      '/review',
      '/more',
    ])
    const current = links.filter((l) => l.getAttribute('aria-current') === 'page')
    expect(current.map((l) => l.textContent)).toEqual(['Plan'])
  })

  test.each(['/more', '/goals', '/stats', '/settings'])('More is current on %s', (route) => {
    renderWithProviders(<Nav />, { route })
    const current = primaryLinks().filter((l) => l.getAttribute('aria-current') === 'page')
    expect(current.map((l) => l.textContent)).toEqual(['More'])
  })

  test('Today is current only on the root path', () => {
    renderWithProviders(<Nav />, { route: '/' })
    const current = primaryLinks().filter((l) => l.getAttribute('aria-current') === 'page')
    expect(current.map((l) => l.textContent)).toEqual(['Today'])
  })

  test('the rail group lists Goals, Stats and Settings', () => {
    renderWithProviders(<Nav />, { route: '/stats' })
    const group = within(screen.getByRole('navigation', { name: 'Other pages' }))
    expect(group.getAllByRole('link').map((l) => l.textContent)).toEqual([
      'Goals',
      'Stats',
      'Settings',
    ])
    expect(group.getByRole('link', { name: 'Stats' })).toHaveAttribute('aria-current', 'page')
  })
})

describe('theme', () => {
  beforeEach(() => {
    document.documentElement.removeAttribute('data-theme')
    localStorage.removeItem('rl_theme')
  })
  afterEach(() => {
    vi.restoreAllMocks()
    document.documentElement.removeAttribute('data-theme')
    localStorage.removeItem('rl_theme')
  })

  test('the toggle cycles system, light, dark and sets data-theme', () => {
    renderWithProviders(<Nav />)
    const toggle = screen.getByRole('button', { name: /Theme: System/ })
    expect(document.documentElement).not.toHaveAttribute('data-theme')
    fireEvent.click(toggle)
    expect(document.documentElement).toHaveAttribute('data-theme', 'light')
    fireEvent.click(screen.getByRole('button', { name: /Theme: Light/ }))
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark')
    expect(localStorage.getItem('rl_theme')).toBe('dark')
    fireEvent.click(screen.getByRole('button', { name: /Theme: Dark/ }))
    expect(document.documentElement).not.toHaveAttribute('data-theme')
    expect(localStorage.getItem('rl_theme')).toBe('system')
  })

  test('survives a storage error', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    renderWithProviders(<Nav />)
    fireEvent.click(screen.getByRole('button', { name: /Theme: System/ }))
    expect(document.documentElement).toHaveAttribute('data-theme', 'light')
  })

  test('a stored theme is applied when the layout mounts', () => {
    localStorage.setItem('rl_theme', 'dark')
    function Probe() {
      return <span data-testid="probe">{useTheme().theme}</span>
    }
    renderWithProviders(
      <>
        <Layout />
        <Probe />
      </>,
    )
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark')
    expect(screen.getByTestId('probe')).toHaveTextContent('dark')
  })
})

describe('Layout', () => {
  test('has a skip link and a main landmark', () => {
    renderWithProviders(<Layout />)
    expect(screen.getByRole('link', { name: 'Skip to content' })).toHaveAttribute('href', '#main')
    expect(screen.getByRole('main')).toHaveAttribute('id', 'main')
  })
})
