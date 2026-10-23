import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, test, vi } from 'vitest'
import type { ExplainView, Param } from '../../shared/engine/types.ts'
import type { ResearchParams } from '../../shared/types.ts'
import { ExplainButton } from '../../web/components/ExplainButton.tsx'
import { mockApi, renderWithProviders } from './helpers.tsx'

// The drawer's three requests, the figures, the rule registry and the papers, do not wait for one
// another: the registry and the research bundle start while the figures are still on their way.

// The research bundle is a dynamic import; the factory runs when the drawer first asks for it.
const bundle = vi.hoisted(() => ({ loads: 0 }))
vi.mock('../../web/components/researchBundle.ts', () => {
  bundle.loads += 1
  return { papers: [], rulesByTopic: {}, topicTexts: {} }
})

const lookback: Param<unknown> = {
  id: 'a3.lookbackDays',
  value: 30,
  grade: 'B',
  rule: 'A3',
  evidence: [],
  note: 'The window for the longest recent run.',
}
const registry: ResearchParams = { version: 'v', params: [lookback] }

const figures: ExplainView = {
  subject: 'session',
  asOf: '2026-10-23',
  frozen: false,
  rules: ['A3'],
  groups: [],
  rest: [],
}

describe('WhyDrawer, requests', () => {
  test('asks for the rule registry and the research bundle while the figures are pending', async () => {
    const user = userEvent.setup()
    const { calls } = mockApi({
      'GET /api/settings': () => ({ email: 'runner@example.com', displayName: null, units: 'km' }),
      'GET /api/research/params': () => registry,
      'GET /api/explain': () => figures,
    })
    // Holds the figures back until the test lets them go; the other answers come at once.
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const answer = globalThis.fetch
    let explainAsked = false
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : String(input), 'http://localhost')
      if (url.pathname === '/api/explain') {
        explainAsked = true
        await gate
      }
      return answer(input, init)
    })

    renderWithProviders(
      <ExplainButton
        subject="longest run"
        rules={['A3']}
        explain={{ subject: 'session', id: 's1' }}
      />,
    )
    await user.click(screen.getByRole('button', { name: 'Why: longest run' }))

    expect(await screen.findByText('Loading the evidence.')).toBeInTheDocument()
    await waitFor(() => {
      expect(explainAsked).toBe(true)
      expect(calls.map((call) => call.url)).toContain('/api/research/params')
      expect(bundle.loads).toBe(1)
    })
    // The figures have not arrived: the drawer still waits on them to render.
    expect(screen.queryByRole('heading', { name: 'From your numbers' })).not.toBeInTheDocument()
    expect(calls.some((call) => call.url.startsWith('/api/explain'))).toBe(false)

    release()
    expect(await screen.findByRole('heading', { name: 'From your numbers' })).toBeInTheDocument()
    expect(await screen.findByText('The window for the longest recent run.')).toBeInTheDocument()
    // The rule section reads the queries the body started: nothing is asked for twice.
    expect(calls.filter((call) => call.url === '/api/research/params')).toHaveLength(1)
    expect(bundle.loads).toBe(1)
  })
})
