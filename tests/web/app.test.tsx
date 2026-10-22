import { screen } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import { App } from '../../web/App.tsx'
import { mockApi, renderWithProviders } from './helpers.tsx'

const signedOut = {
  status: 401,
  body: { error: { code: 'unauthorized', message: 'Sign in to continue.' } },
}

describe('App routing', () => {
  test('goes to setup on a fresh install', async () => {
    mockApi({
      'GET /api/setup': () => ({ needsSetup: true }),
      'GET /api/auth/me': () => signedOut,
    })
    renderWithProviders(<App />)
    expect(await screen.findByRole('heading', { name: 'Set up your training log' })).toBeInTheDocument()
  })

  test('goes to login when set up but signed out', async () => {
    mockApi({
      'GET /api/setup': () => ({ needsSetup: false }),
      'GET /api/auth/me': () => signedOut,
    })
    renderWithProviders(<App />)
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument()
  })

  test('shows the dashboard for a signed-in user', async () => {
    mockApi({
      'GET /api/setup': () => ({ needsSetup: false }),
      'GET /api/auth/me': () => ({
        id: 'u1',
        email: 'runner@example.com',
        displayName: null,
        units: 'mi',
      }),
    })
    renderWithProviders(<App />)
    expect(await screen.findByRole('heading', { name: 'Today' })).toBeInTheDocument()
  })
})
