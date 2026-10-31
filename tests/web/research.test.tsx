import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, test } from 'vitest'
import { allParams } from '../../shared/engine/params/index.ts'
import type { ExplainView, Param } from '../../shared/engine/types.ts'
import type { ResearchParams, Units, UserSettings } from '../../shared/types.ts'
import { PaperCard } from '../../web/components/PaperCard.tsx'
import { WhyDrawer } from '../../web/components/WhyDrawer.tsx'
import { shortCitation, type CorpusPaper } from '../../web/components/researchCorpus.ts'
import { ResearchPage } from '../../web/pages/ResearchPage.tsx'
import { expectCleanCopy, mockApi, renderWithProviders } from './helpers.tsx'

const taperParam: Param<unknown> = {
  id: 'k1.weeklyMultipliers',
  value: [0.75, 0.55, 0.35],
  grade: 'B',
  rule: 'K1',
  evidence: ['bosquet-2007-taper-meta-analysis'],
}
const defaultParam: Param<unknown> = {
  id: 'expectedRpe.easy',
  value: 3,
  range: [2, 4],
  unit: 'CR-10',
  grade: 'D',
  rule: 'C4',
  evidence: [],
  note: 'Default chosen for the plan; no direct evidence.',
}
const effortParam: Param<unknown> = {
  id: 'effort.weightRpe',
  value: 0.4,
  grade: 'D',
  rule: 'J2',
  evidence: [],
  note: 'Default: the weight of the RPE part of the effort score.',
}
const registry: ResearchParams = {
  version: '2026-10-22.1',
  params: [taperParam, defaultParam, effortParam],
}

/**
 * What the drawer asks besides the registry: the settings, to show values in the runner's units,
 * and its figures, here an empty list so the rule section stands alone (the drawer's own tests,
 * `why-drawer-inputs.test.tsx`, cover the figures).
 */
const drawerRoutes = (units: Units = 'mi') => ({
  'GET /api/settings': (): UserSettings => ({
    email: 'runner@example.com',
    displayName: null,
    units,
    weightUnit: 'lb',
  }),
  'GET /api/explain': (): ExplainView => ({
    subject: 'rules',
    asOf: '2026-10-23',
    frozen: false,
    rules: [],
    groups: [],
    rest: [],
  }),
})

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
    renderWithProviders(<WhyDrawer rules={['K1']} open={false} onClose={() => {}} />)
    expect(calls).toHaveLength(0)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  test('shows each rule with its parameters, grades and papers', async () => {
    mockApi({ ...drawerRoutes(), 'GET /api/research/params': () => registry })
    const user = userEvent.setup()
    renderWithProviders(<Harness rules={['k1', 'c4']} />)
    await user.click(screen.getByRole('button', { name: 'Why' }))

    const dialog = await screen.findByRole('dialog', { name: 'Why this?' })
    // Rule ids match regardless of case, as in paramsForRule().
    expect(await within(dialog).findByText('0.75, 0.55, 0.35')).toBeInTheDocument()
    expect(within(dialog).getByText('Evidence grade B')).toBeInTheDocument()
    expect(within(dialog).getByText('Evidence grade D')).toBeInTheDocument()
    // Grade D says it is a default, and the sentence is the parameter's own note.
    expect(within(dialog).getByText('Default (no direct study)')).toBeInTheDocument()
    expect(within(dialog).getByText(/no direct evidence/)).toBeInTheDocument()
    // The rule is named in words, and no raw parameter id is shown.
    expect(within(dialog).getByRole('heading', { name: 'Taper length' })).toBeInTheDocument()
    expect(
      within(dialog).getByRole('heading', { name: 'First threshold when untested' }),
    ).toBeInTheDocument()
    expect(dialog.textContent).not.toMatch(/k1\.weeklyMultipliers|expectedRpe\.easy/)
    // a parameter without a note reads as words
    expect(within(dialog).getByText('Weekly multipliers')).toBeInTheDocument()
    expect(within(dialog).getByText('2 to 4 on the CR-10 scale')).toBeInTheDocument()
    // The paper behind a grade B parameter, from the bundled corpus.
    expect(
      await within(dialog).findByText(
        'Effects of tapering on performance: a meta-analysis',
        undefined,
        SLOW,
      ),
    ).toBeInTheDocument()
    // Everything the drawer says in its own words passes the shared G5 lint.
    expectCleanCopy(dialog)
    // The wait for the corpus is 8 s, so the test must allow more than the 5 s default.
  }, 15_000)

  test('the effort assessment says that an effort verdict needs a rating', async () => {
    mockApi({ ...drawerRoutes(), 'GET /api/research/params': () => registry })
    const user = userEvent.setup()
    renderWithProviders(<Harness rules={['J2', 'K1']} />)
    await user.click(screen.getByRole('button', { name: 'Why' }))

    const dialog = await screen.findByRole('dialog', { name: 'Why this?' })
    const effort = await within(dialog).findByRole('region', { name: 'Subjective first' })
    expect(within(effort).getByText(/the weight of the RPE part/)).toBeInTheDocument()
    expect(
      within(effort).getByText(
        'An effort verdict needs a rating of effort or feel: without one it rests on heart rate and pace alone, stays at low confidence, and never changes the plan on its own.',
      ),
    ).toBeInTheDocument()
    // The sentence speaks about the effort verdict only: check-ins, pain, illness and completion
    // change the plan without a rating.
    expect(dialog.textContent).not.toMatch(/An adjustment needs a rating/)
    // Only the effort parameters bring the sentence; another rule in the same drawer does not.
    expect(within(dialog).getAllByText(/An effort verdict needs a rating/)).toHaveLength(1)
  })

  test.each([
    {
      units: 'mi' as const,
      step: 'the minimum step is 0.3 mi (stored in metres)',
      gain: 'with a minimum step of 328 ft.',
    },
    {
      units: 'km' as const,
      step: 'the minimum step is 0.5 km (stored in metres)',
      gain: 'with a minimum step of 100 m.',
    },
  ])('a parameter note reads in the units of its value ($units)', async ({ units, step, gain }) => {
    const real = (id: string): Param<unknown> => {
      const found = allParams().find((p) => p.id === id)
      if (found === undefined) throw new Error(`No parameter ${id} in the registry`)
      return found
    }
    const params = [real('g1.minStepDistanceM'), real('h4.minStepGainM')]
    mockApi({
      ...drawerRoutes(units),
      'GET /api/research/params': () => ({ version: 'v', params }),
    })
    const user = userEvent.setup()
    renderWithProviders(<Harness rules={params.map((p) => p.rule)} />)
    await user.click(screen.getByRole('button', { name: 'Why' }))

    const dialog = await screen.findByRole('dialog', { name: 'Why this?' })
    const sentence = (part: string) => (content: string) => content.includes(part)
    expect(await within(dialog).findByText(sentence(step))).toBeInTheDocument()
    expect(within(dialog).getByText(sentence(gain))).toBeInTheDocument()
  })

  test('prints the novice ladder one rung and session to a line, not as a flat list', async () => {
    const ladder: Param<unknown> = {
      id: 'noviceLadder.rungs',
      value: [[[1, 2, 1, 2, 1]], [[3, 1.5, 5, 2.5, 3, 1.5, 5]], [[5, 3, 5], [8, 5, 8], [20]]],
      grade: 'D',
      rule: 'E6',
      evidence: [],
      unit: 'min of running and walking per session',
      note: 'Default: nine rungs.',
    }
    mockApi({
      ...drawerRoutes(),
      'GET /api/research/params': () => ({ version: 'v', params: [ladder, taperParam] }),
    })
    const user = userEvent.setup()
    renderWithProviders(<Harness rules={['E6']} />)
    await user.click(screen.getByRole('button', { name: 'Why' }))

    const dialog = await screen.findByRole('dialog', { name: 'Why this?' })
    const line = async (label: string) =>
      (await within(dialog).findByText(label)).nextElementSibling?.textContent
    expect(await line('Rung 1')).toBe('1 run, 2 walk, 1 run, 2 walk, 1 run')
    expect(await line('Rung 2')).toBe('3 run, 1.5 walk, 5 run, 2.5 walk, 3 run, 1.5 walk, 5 run')
    // A rung with several sessions has a line for each.
    expect(await line('Rung 3, session 1')).toBe('5 run, 3 walk, 5 run')
    expect(await line('Rung 3, session 2')).toBe('8 run, 5 walk, 8 run')
    expect(await line('Rung 3, session 3')).toBe('20 run')
    expect(await line('Unit')).toBe('min of running and walking per session')
    // No flat run of numbers.
    expect(dialog.textContent).not.toMatch(/1, 2, 1, 2/)
    expect(within(dialog).queryByText('Value')).not.toBeInTheDocument()
  })

  test('keeps the tightened profiles apart from the third global principle', async () => {
    const injury: Param<unknown> = {
      id: 'injuryReturn.levelsMin',
      value: [5, 7],
      grade: 'D',
      rule: 'g-3',
      evidence: [],
      note: 'Default: the injury-return levels.',
    }
    const prior: Param<unknown> = {
      id: 'global3.minObservations',
      value: 8,
      grade: 'D',
      rule: 'G3',
      evidence: [],
      note: 'Default: observations before a personal model replaces the prior.',
    }
    mockApi({
      ...drawerRoutes(),
      'GET /api/research/params': () => ({ version: 'v', params: [prior, injury] }),
    })
    const user = userEvent.setup()
    renderWithProviders(<Harness rules={['g-3']} />)
    await user.click(screen.getByRole('button', { name: 'Why' }))

    const dialog = await screen.findByRole('dialog', { name: 'Why this?' })
    const section = await within(dialog).findByRole('region', { name: 'Tightened profiles' })
    expect(within(section).getByText('Default: the injury-return levels.')).toBeInTheDocument()
    expect(dialog.textContent).not.toMatch(/observations before a personal model/)
  })

  test('shows parameter values in plain words and in the runner s units', async () => {
    const params: Array<Param<unknown>> = [
      {
        id: 'flib.fastFinishFraction',
        value: 0.2,
        unit: 'fraction of duration',
        grade: 'D',
        rule: 'F3',
        evidence: [],
        note: 'Default: the fast finish of a long run.',
      },
      {
        id: 'd3.halfMinWeeklyKm',
        value: 32,
        unit: 'km/week',
        grade: 'C',
        rule: 'F3',
        evidence: [],
        note: 'A soft floor for a half-marathon time goal.',
      },
      {
        id: 'd1Prior.paceSecPerKm',
        value: 420,
        range: [390, 450],
        unit: 'sec/km',
        grade: 'D',
        rule: 'F3',
        evidence: [],
        note: 'Default: the pace prior.',
      },
      {
        id: 'h4.walkReferenceClimbRateMh',
        value: 800,
        unit: 'm/h',
        grade: 'C',
        rule: 'F3',
        evidence: [],
        note: 'The climb rate of a walk.',
      },
    ]
    const expectations: Array<[Units, string[]]> = [
      ['mi', ['19.9 mi per week', '11:16 /mi', '10:28 to 12:04 /mi', '2625 ft per hour']],
      ['km', ['32 km per week', '7:00 /km', '6:30 to 7:30 /km', '800 m per hour']],
    ]
    for (const [units, texts] of expectations) {
      mockApi({
        ...drawerRoutes(units),
        'GET /api/research/params': () => ({ version: 'v', params }),
      })
      const user = userEvent.setup()
      const { unmount } = renderWithProviders(<Harness rules={['f3']} />)
      await user.click(screen.getByRole('button', { name: 'Why' }))
      const dialog = await screen.findByRole('dialog', { name: 'Why this?' })
      expect(await within(dialog).findByText('20% of the duration')).toBeInTheDocument()
      for (const text of texts) expect(within(dialog).getByText(text)).toBeInTheDocument()
      // The raw words of the registry never reach the page.
      expect(dialog.textContent).not.toMatch(/fraction of duration|sec\/km|km\/week/)
      if (units === 'mi') expect(dialog.textContent).not.toMatch(/\bkm\b|\d m\b/)
      expectCleanCopy(dialog)
      unmount()
    }
  })

  test('says so when a rule has no parameter', async () => {
    mockApi({ ...drawerRoutes(), 'GET /api/research/params': () => registry })
    const user = userEvent.setup()
    renderWithProviders(<Harness rules={['zz-9']} />)
    await user.click(screen.getByRole('button', { name: 'Why' }))
    expect(await screen.findByText(/No parameter is recorded for zz-9/)).toBeInTheDocument()
  })

  test('shows an error line when the registry cannot be loaded', async () => {
    mockApi({
      ...drawerRoutes(),
      'GET /api/research/params': () => ({
        status: 500,
        body: { error: { code: 'internal', message: 'Boom' } },
      }),
    })
    const user = userEvent.setup()
    renderWithProviders(<Harness rules={['K1']} />)
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

  test('the heading and the line under it pass the copy lint', () => {
    renderWithProviders(<ResearchPage />)
    const header = screen.getByRole('heading', { level: 1, name: 'Research' }).closest('header')
    expect(header).not.toBeNull()
    expectCleanCopy(header as HTMLElement)
    expect(header).toHaveTextContent('The papers and rules the plan rests on')
  })

  test('says that the research is decision support and not medical advice', () => {
    renderWithProviders(<ResearchPage />)
    expect(screen.getByText(/not medical advice/i)).toBeInTheDocument()
  })
})

describe('citations', () => {
  const base: CorpusPaper = {
    id: 'example-2021-paper',
    title: 'An example paper',
    authors: 'de Jager E, Holden S',
    year: 2021,
    journal: 'Example Journal',
    doi: null,
    pmid: null,
    url: 'https://example.com',
    design: 'cohort',
    population: 'runners',
    sampleSize: null,
    evidenceLevel: 'C',
    topics: [],
    findings: [],
    limitations: '',
    implications: [],
  }

  test('a short citation keeps a multi-word surname and drops the initials', () => {
    expect(shortCitation(base)).toBe('de Jager 2021')
    expect(shortCitation({ ...base, authors: 'Foster C' })).toBe('Foster 2021')
  })

  test('a single author has no "et al."', () => {
    renderWithProviders(
      <PaperCard paper={{ ...base, authors: 'Foster C' }} open={false} onToggle={() => {}} />,
    )
    expect(screen.getByText('Foster C (2021), Example Journal')).toBeInTheDocument()
  })

  test('a list of authors shows the first with "et al."', () => {
    renderWithProviders(<PaperCard paper={base} open={false} onToggle={() => {}} />)
    expect(screen.getByText('de Jager E et al. (2021), Example Journal')).toBeInTheDocument()
  })
})
