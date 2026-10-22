import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, test } from 'vitest'
import type { Param } from '../../shared/engine/types.ts'
import type { ResearchParams } from '../../shared/types.ts'
import { WhyDrawer } from '../../web/components/WhyDrawer.tsx'
import { ResearchPage } from '../../web/pages/ResearchPage.tsx'
import { mockApi, renderWithProviders } from './helpers.tsx'

const taperParam: Param<unknown> = {
  id: 'k1.weeklyMultipliers',
  value: [0.75, 0.55, 0.35],
  grade: 'B',
  rule: 'k-1',
  evidence: ['bosquet-2007-taper-meta-analysis'],
}
const defaultParam: Param<unknown> = {
  id: 'expectedRpe.easy',
  value: 3,
  range: [2, 4],
  unit: 'CR-10',
  grade: 'D',
  rule: 'c-4',
  evidence: [],
  note: 'Default chosen for the plan; no direct evidence.',
}
const registry: ResearchParams = { version: '2026-10-22.1', params: [taperParam, defaultParam] }

function Harness({ rules }: { rules: string[] }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        type="button"
        onClick={() => {
          setOpen(true)
        }}
      >
        Why
      </button>
      <WhyDrawer
        rules={rules}
        open={open}
        onClose={() => {
          setOpen(false)
        }}
      />
    </>
  )
}

// The corpus is one chunk of 300 papers; a full parallel run can need more than the 1 s default.
const SLOW = { timeout: 8000 }

describe('WhyDrawer', () => {
  test('requests nothing while closed', () => {
    const { calls } = mockApi({})
    renderWithProviders(<WhyDrawer rules={['k-1']} open={false} onClose={() => {}} />)
    expect(calls).toHaveLength(0)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  test('shows each rule with its parameters, grades and papers', async () => {
    mockApi({ 'GET /api/research/params': () => registry })
    const user = userEvent.setup()
    renderWithProviders(<Harness rules={['K1', 'c-4']} />)
    await user.click(screen.getByRole('button', { name: 'Why' }))

    const dialog = await screen.findByRole('dialog', { name: 'Why this?' })
    // Rule ids match regardless of case and hyphens, as in explain().
    expect(await within(dialog).findByText('0.75, 0.55, 0.35')).toBeInTheDocument()
    expect(within(dialog).getByText('Evidence grade B')).toBeInTheDocument()
    expect(within(dialog).getByText('Evidence grade D')).toBeInTheDocument()
    // Grade D says it is a default, in the parameter's own words.
    expect(within(dialog).getByText(/Default, not evidence/)).toBeInTheDocument()
    expect(within(dialog).getByText(/no direct evidence/)).toBeInTheDocument()
    expect(within(dialog).getByText('2 to 4 CR-10')).toBeInTheDocument()
    // The paper behind a grade B parameter, from the bundled corpus.
    expect(
      await within(dialog).findByText(
        'Effects of tapering on performance: a meta-analysis',
        undefined,
        SLOW,
      ),
    ).toBeInTheDocument()
  })

  test('says so when a rule has no parameter', async () => {
    mockApi({ 'GET /api/research/params': () => registry })
    const user = userEvent.setup()
    renderWithProviders(<Harness rules={['zz-9']} />)
    await user.click(screen.getByRole('button', { name: 'Why' }))
    expect(await screen.findByText(/No parameter is recorded for zz-9/)).toBeInTheDocument()
  })

  test('shows an error line when the registry cannot be loaded', async () => {
    mockApi({
      'GET /api/research/params': () => ({
        status: 500,
        body: { error: { code: 'internal', message: 'Boom' } },
      }),
    })
    const user = userEvent.setup()
    renderWithProviders(<Harness rules={['k-1']} />)
    await user.click(screen.getByRole('button', { name: 'Why' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not be loaded/i)
  })
})

describe('ResearchPage', () => {
  test('lists the topics, and a topic shows its text, rules and papers', async () => {
    const user = userEvent.setup()
    renderWithProviders(<ResearchPage />)
    expect(screen.getByRole('heading', { level: 1, name: 'Research' })).toBeInTheDocument()

    await user.click(await screen.findByRole('button', { name: /Tapering/ }, SLOW))

    expect(
      await screen.findByRole('heading', { level: 2, name: 'Tapering' }, SLOW),
    ).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Well established' })).toBeInTheDocument()
    const rule = screen.getByRole('article', { name: 'taper-duration-marathon' })
    expect(within(rule).getByText('Evidence grade B')).toBeInTheDocument()
    expect(within(rule).getByText(/21-day \(3-week\) taper/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'All topics' }))
    expect(await screen.findByRole('button', { name: /Tapering/ }, SLOW)).toBeVisible()
  })

  test('filters rules by grade', async () => {
    const user = userEvent.setup()
    renderWithProviders(<ResearchPage />)
    await user.click(await screen.findByRole('button', { name: /Tapering/ }, SLOW))
    await screen.findByRole('article', { name: 'taper-duration-marathon' }, SLOW)

    await user.click(screen.getByRole('radio', { name: 'Grade A' }))
    expect(screen.getByRole('article', { name: 'taper-duration-default' })).toBeInTheDocument()
    expect(
      screen.queryByRole('article', { name: 'taper-duration-marathon' }),
    ).not.toBeInTheDocument()

    await user.click(screen.getByRole('radio', { name: 'All grades' }))
    expect(screen.getByRole('article', { name: 'taper-duration-marathon' })).toBeInTheDocument()
  })

  test('a paper opens to its findings and a DOI link', async () => {
    const user = userEvent.setup()
    renderWithProviders(<ResearchPage />)
    await user.click(await screen.findByRole('button', { name: /Tapering/ }, SLOW))
    const title = 'Effects of tapering on performance: a meta-analysis'
    await user.click(await screen.findByText(title, undefined, SLOW))
    const link = await screen.findByRole('link', { name: /doi\.org\/10\.1249\/mss\.0b013e3180/ })
    expect(link).toHaveAttribute('href', expect.stringContaining('https://doi.org/10.1249/'))
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'))
    await waitFor(() => {
      expect(screen.getAllByText('Findings')[0]).toBeVisible()
    })
  })

  test('a citation in the text opens that paper, and the rules table is not repeated', async () => {
    const user = userEvent.setup()
    renderWithProviders(<ResearchPage />)
    await user.click(await screen.findByRole('button', { name: /Tapering/ }, SLOW))
    await screen.findByRole('heading', { level: 2, name: 'Tapering' }, SLOW)
    expect(screen.queryByRole('columnheader')).not.toBeInTheDocument()

    const summary = screen.getByRole('region', { name: 'What the research says' })
    await user.click(
      within(summary).getAllByRole('button', { name: 'Bosquet 2007' })[0] as HTMLElement,
    )
    const paper = screen.getByRole('button', {
      name: /Effects of tapering on performance: a meta-analysis/,
    })
    expect(paper).toHaveAttribute('aria-expanded', 'true')
  })

  test('says that the research is decision support and not medical advice', () => {
    renderWithProviders(<ResearchPage />)
    expect(screen.getByText(/not medical advice/i)).toBeInTheDocument()
  })
})
