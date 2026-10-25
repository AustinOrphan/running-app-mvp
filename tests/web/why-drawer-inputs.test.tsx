import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, test, vi } from 'vitest'
import { EXPLAIN_MAX_SOURCES } from '../../shared/copy/limits.ts'
import { renderFact } from '../../shared/copy/templates.ts'
import { estimateState } from '../../shared/engine/athlete.ts'
import { explainInputs, type ExplainContext } from '../../shared/engine/explainInputs.ts'
import { readinessSnapshot } from '../../shared/engine/readiness.ts'
import { buildZones } from '../../shared/engine/zones.ts'
import type {
  ExplainView,
  InputFact,
  Param,
  Quantity,
  SourceRef,
} from '../../shared/engine/types.ts'
import type { ResearchParams, Units, UserSettings } from '../../shared/types.ts'
import { ExplainButton } from '../../web/components/ExplainButton.tsx'
import { sourceHref } from '../../web/components/InputFacts.tsx'
import { WhyDrawer } from '../../web/components/WhyDrawer.tsx'
import {
  expectCleanCopy,
  mockApi,
  renderWithProviders,
  type MockRequest,
  type MockRoutes,
} from './helpers.tsx'
import { at, h1, scenario, SPARSE } from '../unit/engine/history-fixtures.ts'

// The drawer's "From your numbers": the figures come from GET /api/explain, are worded by
// `renderFact` in the runner's units, and sit before the rule, its grade and its papers.

const lookback: Param<unknown> = {
  id: 'a3.lookbackDays',
  value: 30,
  grade: 'B',
  rule: 'A3',
  evidence: [],
  note: 'The window for the longest recent run.',
}
const csParam: Param<unknown> = {
  id: 'a6.minEfforts',
  value: 3,
  grade: 'C',
  rule: 'A6',
  evidence: [],
  note: 'Efforts needed to fit critical speed.',
}
const registry: ResearchParams = { version: 'v', params: [lookback, csParam] }

const settingsRoute = (units: Units) => ({
  'GET /api/settings': (): UserSettings => ({
    email: 'runner@example.com',
    displayName: null,
    units,
  }),
})

const q = {
  count: (n: number): Quantity => ({ kind: 'count', n }),
  distance: (m: number): Quantity => ({ kind: 'distance', m }),
  date: (iso: string): Quantity => ({ kind: 'date', iso }),
}

function run(id: string, date: string, distanceM: number): SourceRef {
  return { kind: 'activity', id, date, label: 'Run', distanceM }
}

function longestRun(over: Partial<InputFact> = {}): InputFact {
  return {
    id: 'a3.longest-distance',
    template: 'explain.longest-distance',
    slots: { days: q.count(30), distance: q.distance(21_097), date: q.date('2026-10-17') },
    rule: 'A3',
    sources: [run('a1', '2026-10-17', 21_097)],
    moreSources: 0,
    state: 'used',
    ...over,
  }
}

function criticalSpeedGap(): InputFact {
  return {
    id: 'a6.cs-gap',
    template: 'explain.cs-gap',
    slots: {
      need: q.count(3),
      from: q.distance(400),
      to: q.distance(5_000),
      days: q.count(90),
      found: q.count(2),
    },
    rule: 'A6',
    sources: [run('a2', '2026-10-01', 5_000), run('a3', '2026-09-20', 1_000)],
    moreSources: 0,
    state: 'insufficient',
  }
}

function view(over: Partial<ExplainView> = {}): ExplainView {
  return {
    subject: 'session',
    asOf: '2026-10-23',
    frozen: false,
    rules: ['A3'],
    groups: [{ rule: 'A3', facts: [longestRun()] }],
    rest: [],
    ...over,
  }
}

/** The routes the drawer needs; `explain` answers every figures request. */
function drawerRoutes(
  explain: (req: MockRequest) => unknown,
  units: Units = 'km',
  extra: MockRoutes = {},
): MockRoutes {
  return {
    ...settingsRoute(units),
    'GET /api/research/params': () => registry,
    'GET /api/explain': explain,
    ...extra,
  }
}

function explainCalls(calls: Array<{ method: string; url: string }>): string[] {
  return calls.filter((call) => call.url.startsWith('/api/explain')).map((call) => call.url)
}

function renderButton(
  explain: Parameters<typeof ExplainButton>[0]['explain'] = { subject: 'session', id: 's1' },
  rules = ['A3'],
) {
  const user = userEvent.setup()
  renderWithProviders(<ExplainButton subject="longest run" rules={rules} explain={explain} />)
  return { user, open: () => user.click(screen.getByRole('button', { name: 'Why: longest run' })) }
}

describe('WhyDrawer, from your numbers', () => {
  test('asks nothing while closed and once when opened, with the subject in the request', async () => {
    const { calls } = mockApi(drawerRoutes(() => view()))
    renderWithProviders(
      <WhyDrawer
        explain={{ subject: 'session', id: 's1' }}
        rules={['A3']}
        open={false}
        onClose={vi.fn()}
      />,
    )
    expect(calls).toHaveLength(0)

    const { open } = renderButton()
    await open()
    await screen.findByRole('heading', { name: 'From your numbers' })
    expect(explainCalls(calls)).toEqual(['/api/explain?subject=session&id=s1'])
    expect(calls.filter((call) => call.url === '/api/research/params')).toHaveLength(1)
  })

  test('puts the figures before the rule, in the runner s units and with the date of the figures', async () => {
    mockApi(drawerRoutes(() => view()))
    const { open } = renderButton()
    await open()

    const dialog = await screen.findByRole('dialog', { name: 'Why this?' })
    const numbers = await within(dialog).findByRole('heading', { name: 'From your numbers' })
    const rule = within(dialog).getByRole('heading', { name: 'The rule and its evidence' })
    // "From your numbers" comes first in the document, then the rule section.
    expect(numbers.compareDocumentPosition(rule) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(
      within(dialog).getByText(
        'These are the figures the plan read, as of 23 Oct. It reads them again every Monday.',
      ),
    ).toBeInTheDocument()
    expect(
      within(dialog).getByText('Your longest run in the last 30 days was 21.1 km on 17 Oct.'),
    ).toBeInTheDocument()
    // The rule section still holds the parameter, its grade and the sentence about grades.
    const section = within(dialog).getByRole('region', { name: 'Longest recent run' })
    expect(within(section).getByText('The window for the longest recent run.')).toBeInTheDocument()
    expect(within(dialog).getByText(/Grade A is the strongest evidence/)).toBeInTheDocument()
    expectCleanCopy(dialog)
  })

  test('reads distances in miles for a runner who uses them', async () => {
    mockApi(drawerRoutes(() => view(), 'mi'))
    const { open } = renderButton()
    await open()

    const dialog = await screen.findByRole('dialog', { name: 'Why this?' })
    expect(
      await within(dialog).findByText(
        'Your longest run in the last 30 days was 13.1 mi on 17 Oct.',
      ),
    ).toBeInTheDocument()
    expect(
      within(dialog).getByRole('link', { name: 'Run, 13.1 mi, Sat 17 Oct' }),
    ).toBeInTheDocument()
  })

  test.each([
    { units: 'km' as const, label: 'Run, 21.1 km, Sat 17 Oct' },
    { units: 'mi' as const, label: 'Run, 13.1 mi, Sat 17 Oct' },
  ])(
    'lists the sources under the figure and links an activity by its id ($units)',
    async ({ units, label }) => {
      mockApi(drawerRoutes(() => view(), units))
      const { open } = renderButton()
      await open()

      const dialog = await screen.findByRole('dialog', { name: 'Why this?' })
      const sources = await within(dialog).findByRole('list', { name: 'Based on' })
      const link = within(sources).getByRole('link', { name: label })
      expect(link).toHaveAttribute('href', '/activities/a1')
      expectCleanCopy(dialog)
    },
  )

  test('shows at most five sources and counts the rest, the server s count included', async () => {
    const many = Array.from({ length: EXPLAIN_MAX_SOURCES + 2 }, (_, i) =>
      run(`a${String(i)}`, `2026-10-${String(10 + i)}`, 10_000 + i),
    )
    mockApi(
      drawerRoutes(() =>
        view({ groups: [{ rule: 'A3', facts: [longestRun({ sources: many, moreSources: 2 })] }] }),
      ),
    )
    const { open } = renderButton()
    await open()

    const sources = await screen.findByRole('list', { name: 'Based on' })
    expect(within(sources).getAllByRole('link')).toHaveLength(EXPLAIN_MAX_SOURCES)
    // Two the server left out and two the page left out.
    expect(within(sources).getByText('and 4 more')).toBeInTheDocument()
  })

  test('links a check-in and the profile, and shows a wellness day as plain text', async () => {
    const sources: SourceRef[] = [
      { kind: 'check-in', id: '2026-10-21', date: '2026-10-21', label: 'Check-in' },
      { kind: 'profile', id: 'profile', date: '2026-10-23', label: 'Profile' },
      { kind: 'wellness', id: '2026-10-22', date: '2026-10-22', label: 'Wellness' },
    ]
    mockApi(
      drawerRoutes(() => view({ groups: [{ rule: 'A3', facts: [longestRun({ sources })] }] })),
    )
    const { open } = renderButton()
    await open()

    const list = await screen.findByRole('list', { name: 'Based on' })
    expect(within(list).getByRole('link', { name: 'Check-in, Wed 21 Oct' })).toHaveAttribute(
      'href',
      '/',
    )
    expect(within(list).getByRole('link', { name: 'Profile, Fri 23 Oct' })).toHaveAttribute(
      'href',
      '/profile',
    )
    expect(within(list).getByText('Wellness, Thu 22 Oct')).toBeInTheDocument()
    expect(within(list).queryByRole('link', { name: /Wellness/ })).not.toBeInTheDocument()
  })

  test('following a source closes the drawer', async () => {
    mockApi(drawerRoutes(() => view()))
    const { user, open } = renderButton()
    await open()
    await user.click(await screen.findByRole('link', { name: /^Run, 21\.1 km/ }))
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
  })

  test('says what is missing behind "Not enough data yet:" and still lists what was counted', async () => {
    mockApi(
      drawerRoutes(() =>
        view({ rules: ['A6'], groups: [{ rule: 'A6', facts: [criticalSpeedGap()] }] }),
      ),
    )
    const { open } = renderButton({ subject: 'zone' }, ['A6'])
    await open()

    const group = await screen.findByRole('group', { name: 'Fitness' })
    expect(within(group).getByText('Not enough data yet:')).toBeInTheDocument()
    expect(
      within(group).getByText(
        /Critical speed needs 3 efforts between 400 m and 5 km in the last 90 days; 2 found\. Zones use heart rate and effort until then\./,
      ),
    ).toBeInTheDocument()
    expect(within(group).getAllByRole('link')).toHaveLength(2)
    expectCleanCopy(group)
  })

  test('a rule that uses none of the runner s data says it rests on the rule alone', async () => {
    mockApi(drawerRoutes(() => view({ rules: ['A3', 'A6'], rest: ['A6'] })))
    const { open } = renderButton(undefined, ['A3', 'A6'])
    await open()

    const group = await screen.findByRole('group', { name: 'Fitness' })
    expect(
      within(group).getByText('This rests on the rule alone. It does not use your data.'),
    ).toBeInTheDocument()
    expect(within(group).queryByRole('list')).not.toBeInTheDocument()
    // The rule section is still there for it.
    expect(screen.getByRole('region', { name: 'Fitness' })).toBeInTheDocument()
  })

  test('a stored view says it holds the figures from the day it was written', async () => {
    mockApi(drawerRoutes(() => view({ subject: 'activity', frozen: true, asOf: '2026-10-20' })))
    const { open } = renderButton({ subject: 'activity', id: 'a1' })
    await open()

    expect(
      await screen.findByText('These are the figures from 20 Oct, when this was written.'),
    ).toBeInTheDocument()
    expect(screen.queryByText(/It reads them again every Monday/)).not.toBeInTheDocument()
  })

  test('rules the subject does not list are still shown after its own', async () => {
    mockApi(drawerRoutes(() => view({ rules: ['A3'] })))
    const { open } = renderButton(undefined, ['a3', 'A6'])
    await open()

    const dialog = await screen.findByRole('dialog', { name: 'Why this?' })
    const titles = await within(dialog).findAllByRole('heading', { level: 4 })
    // The case of an id does not matter, so A3 is not listed twice.
    expect(titles.map((title) => title.textContent)).toEqual(['Longest recent run', 'Fitness'])
  })

  test('without a subject the drawer asks about the rule ids alone', async () => {
    const { calls } = mockApi(drawerRoutes(() => view({ subject: 'rules' })))
    renderWithProviders(<WhyDrawer rules={['A3', 'a3', 'A6']} open onClose={vi.fn()} />)
    await screen.findByRole('heading', { name: 'From your numbers' })
    expect(explainCalls(calls)).toEqual(['/api/explain?subject=rules&rules=A3%2CA6'])
  })

  test.each([
    {
      name: 'a week',
      ref: { subject: 'week' as const, weekStart: '2026-10-19' },
      url: '/api/explain?subject=week&weekStart=2026-10-19',
    },
    {
      name: 'a decision',
      ref: { subject: 'decision' as const, weekStart: '2026-10-12' },
      url: '/api/explain?subject=decision&weekStart=2026-10-12',
    },
    {
      name: 'readiness',
      ref: { subject: 'readiness' as const },
      url: '/api/explain?subject=readiness',
    },
    {
      name: 'a zone boundary',
      ref: { subject: 'zone' as const, boundary: 'cs' as const },
      url: '/api/explain?subject=zone&boundary=cs',
    },
    { name: 'the zones', ref: { subject: 'zone' as const }, url: '/api/explain?subject=zone' },
    {
      name: 'a prediction',
      ref: { subject: 'prediction' as const, goalId: 'g1' },
      url: '/api/explain?subject=prediction&goalId=g1',
    },
    {
      name: 'a brief',
      ref: { subject: 'brief' as const, weekStart: '2026-10-19' },
      url: '/api/explain?subject=brief&weekStart=2026-10-19',
    },
    {
      name: 'a run',
      ref: { subject: 'activity' as const, id: 'a1' },
      url: '/api/explain?subject=activity&id=a1',
    },
  ])('asks for $name by its own query', async ({ ref, url }) => {
    const { calls } = mockApi(drawerRoutes(() => view()))
    const { open } = renderButton(ref)
    await open()
    await screen.findByRole('heading', { name: 'From your numbers' })
    expect(explainCalls(calls)).toEqual([url])
  })

  test('keeps a subject apart from another and asks again on every opening', async () => {
    const { calls } = mockApi(
      drawerRoutes(({ query }) =>
        query.get('subject') === 'readiness'
          ? view({
              subject: 'readiness',
              rules: ['A6'],
              groups: [{ rule: 'A6', facts: [criticalSpeedGap()] }],
            })
          : view(),
      ),
    )
    const user = userEvent.setup()
    renderWithProviders(
      <>
        <ExplainButton
          subject="session"
          rules={['A3']}
          explain={{ subject: 'session', id: 's1' }}
        />
        <ExplainButton subject="readiness" rules={['A6']} explain={{ subject: 'readiness' }} />
      </>,
    )

    await user.click(screen.getByRole('button', { name: 'Why: session' }))
    expect(await screen.findByText(/Your longest run in the last 30 days/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Close' }))

    await user.click(screen.getByRole('button', { name: 'Why: readiness' }))
    expect(await screen.findByText(/Critical speed needs 3 efforts/)).toBeInTheDocument()
    // The first subject's figures do not leak into the second.
    expect(screen.queryByText(/Your longest run in the last 30 days/)).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Close' }))

    await user.click(screen.getByRole('button', { name: 'Why: session' }))
    await screen.findByText(/Your longest run in the last 30 days/)
    expect(explainCalls(calls)).toEqual([
      '/api/explain?subject=session&id=s1',
      '/api/explain?subject=readiness',
      '/api/explain?subject=session&id=s1',
    ])
  })

  test('the figures do not wait for the settings, which read in miles until they arrive', async () => {
    mockApi(drawerRoutes(() => view()))
    const answered = globalThis.fetch
    // The client always passes the path as a string.
    vi.stubGlobal('fetch', (input: string, init?: RequestInit) =>
      input.startsWith('/api/settings') ? new Promise<Response>(() => {}) : answered(input, init),
    )
    const { open } = renderButton()
    await open()

    const dialog = await screen.findByRole('dialog', { name: 'Why this?' })
    expect(
      await within(dialog).findByText(
        'Your longest run in the last 30 days was 13.1 mi on 17 Oct.',
      ),
    ).toBeInTheDocument()
    expect(within(dialog).queryByText('Loading the evidence.')).not.toBeInTheDocument()
  })

  test('keeps the rule section when the figures fail and retries on the next opening', async () => {
    let attempts = 0
    const { calls } = mockApi(
      drawerRoutes(() => {
        attempts += 1
        return attempts === 1
          ? { status: 500, body: { error: { code: 'internal', message: 'Something went wrong.' } } }
          : view()
      }),
    )
    const { user, open } = renderButton()
    await open()

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(
      'Your figures could not be loaded. The rule and papers below still apply. Close this panel and open it again to retry.',
    )
    const dialog = screen.getByRole('dialog', { name: 'Why this?' })
    expect(
      await within(dialog).findByRole('region', { name: 'Longest recent run' }),
    ).toBeInTheDocument()
    expect(within(dialog).getByText('The window for the longest recent run.')).toBeInTheDocument()
    expect(
      within(dialog).queryByRole('heading', { name: 'From your numbers' }),
    ).not.toBeInTheDocument()
    expectCleanCopy(dialog)

    await user.click(within(dialog).getByRole('button', { name: 'Close' }))
    await open()
    expect(
      await screen.findByText('Your longest run in the last 30 days was 21.1 km on 17 Oct.'),
    ).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(explainCalls(calls)).toHaveLength(2)
  })

  test('a subject the server does not know fails the same way, with the rule section intact', async () => {
    mockApi(
      drawerRoutes(() => ({
        status: 404,
        body: {
          error: { code: 'not_found', message: 'That session is not in your current plan.' },
        },
      })),
    )
    const { open } = renderButton()
    await open()
    expect(await screen.findByRole('alert')).toHaveTextContent('Your figures could not be loaded.')
    expect(await screen.findByRole('region', { name: 'Longest recent run' })).toBeInTheDocument()
  })

  test('names its parts and gives focus back to the button that opened it', async () => {
    mockApi(drawerRoutes(() => view({ rules: ['A3', 'A6'], rest: ['A6'] })))
    const { user, open } = renderButton(undefined, ['A3', 'A6'])
    const opener = screen.getByRole('button', { name: 'Why: longest run' })
    await open()

    const dialog = await screen.findByRole('dialog', { name: 'Why this?' })
    await within(dialog).findByRole('heading', { name: 'From your numbers' })
    expect(
      within(dialog).getByRole('heading', { name: 'The rule and its evidence' }),
    ).toBeInTheDocument()
    expect(within(dialog).getByRole('group', { name: 'Longest recent run' })).toBeInTheDocument()
    expect(within(dialog).getByRole('list', { name: 'Based on' })).toBeInTheDocument()

    await user.click(within(dialog).getByRole('button', { name: 'Close' }))
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
    expect(opener).toHaveFocus()
  })
})

describe('WhyDrawer, the history-informed rebuild [rules g-8]', () => {
  /** The figures of g-8 for a runner, as the server builds them from the snapshot. */
  function g8View(input: Parameters<typeof estimateState>[0]): ExplainView {
    const state = estimateState(input)
    const ctx: ExplainContext = {
      asOf: input.today,
      input,
      state,
      zones: buildZones(input.profile, state, input.today),
      readiness: readinessSnapshot(input, input.today),
      goal: null,
      prediction: null,
      hrModel: null,
      decision: null,
      race: null,
    }
    return explainInputs({ subject: 'rules', rules: ['g-8'] }, ctx)
  }

  test.each(['km', 'mi'] as const)(
    'shows the block, the zone, the setting and the limits under the rule s title (%s)',
    async (units) => {
      const figures = g8View(at(h1(), 'standard'))
      const facts = figures.groups[0]!.facts
      expect(facts.map((fact) => fact.id)).toEqual([
        'g-8.block',
        'g-8.zone',
        'g-8.setting',
        'g-8.limits',
      ])
      mockApi(drawerRoutes(() => figures, units))
      const { open } = renderButton({ subject: 'rules', rules: ['g-8'] }, ['g-8'])
      await open()

      const dialog = await screen.findByRole('dialog', { name: 'Why this?' })
      const group = await within(dialog).findByRole('group', { name: 'History-informed rebuild' })
      for (const fact of facts) {
        expect(within(group).getByText(renderFact(fact, units))).toBeInTheDocument()
      }
      // the block lists the runs it rests on, as any other figure does
      expect(within(group).getByRole('list', { name: 'Based on' })).toBeInTheDocument()
      expect(within(group).queryByText('Not enough data yet:')).not.toBeInTheDocument()
      expectCleanCopy(dialog)
    },
  )

  test('says what is missing for a runner with no block, behind the label of a gap', async () => {
    const figures = g8View(at(scenario(SPARSE), 'standard'))
    const gap = figures.groups[0]!.facts.find((fact) => fact.state === 'insufficient')!
    mockApi(drawerRoutes(() => figures))
    const { open } = renderButton({ subject: 'rules', rules: ['g-8'] }, ['g-8'])
    await open()

    const dialog = await screen.findByRole('dialog', { name: 'Why this?' })
    const group = await within(dialog).findByRole('group', { name: 'History-informed rebuild' })
    expect(within(group).getByText(renderFact(gap, 'km'))).toBeInTheDocument()
    expect(within(group).getByText('Not enough data yet:')).toBeInTheDocument()
    expectCleanCopy(dialog)
  })
})

describe('sourceHref', () => {
  test.each([
    ['activity', 'a 1', '/activities/a%201'],
    ['check-in', '2026-10-21', '/'],
    ['profile', 'profile', '/profile'],
    ['screening', 's1', '/profile'],
    ['session', 's1', '/plan'],
    ['review', 'r1', '/review'],
    ['wellness', '2026-10-21', null],
    ['disruption', 'd1', null],
  ] as const)('%s %s opens %s', (kind, id, href) => {
    expect(sourceHref({ kind, id })).toBe(href)
  })
})
