import { render, screen } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import { WeeklyHoursChart } from '../../web/components/charts/lazyCharts.tsx'
import { expectCleanCopy } from './helpers.tsx'

// A release that replaced the chart's file, or an offline phone with no copy of it, makes the
// import() reject. The chart's place says so; the page around it stays.
vi.mock('../../web/components/charts/WeeklyHoursChart.tsx', () => {
  throw new Error('Failed to fetch dynamically imported module')
})

describe('a chart whose code cannot be loaded', () => {
  test('says so in its place and leaves the rest of the page', async () => {
    render(
      <main>
        <h1>Stats</h1>
        <WeeklyHoursChart weeks={[]} ariaLabel="Run hours per week" />
        <p>The table stays.</p>
      </main>,
    )
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('The chart did not load. Reload the page to try again.')
    expectCleanCopy(alert)
    expect(screen.getByRole('heading', { level: 1, name: 'Stats' })).toBeInTheDocument()
    expect(screen.getByText('The table stays.')).toBeInTheDocument()
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })
})
