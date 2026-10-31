import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, test, vi } from 'vitest'
import { EXPLAIN_MAX_SOURCES } from '../../shared/copy/limits.ts'
import { renderFact } from '../../shared/copy/templates.ts'
import { estimateState } from '../../shared/engine/athlete.ts'
import {
  explainInputs,
  explainNeeds,
  type ExplainContext,
} from '../../shared/engine/explainInputs.ts'
import { buildPlan } from '../../shared/engine/index.ts'
import { P } from '../../shared/engine/params/index.ts'
import { readinessSnapshot } from '../../shared/engine/readiness.ts'
import { buildZones } from '../../shared/engine/zones.ts'
import type {
  EngineInput,
  ExplainView,
  InputFact,
  Param,
  PresetId,
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
import { athletes } from '../unit/engine/matrix-fixtures.ts'

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
    weightUnit: 'lb',
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

describe('WhyDrawer, the plan shape [rules P1 to P4]', () => {
  const GRADE = 'A choice, not a better plan (grade D): no study compares these plans.'
  const shapeRegistry: ResearchParams = { version: 'v', params: [P.p2.runDays, P.p4.buildWeeks] }

  /** The plan the engine builds for a matrix athlete under a preset, in the shape of a stored plan. */
  function planOf(id: string, method?: PresetId): EngineInput {
    const athlete = athletes().find((a) => a.id === id)!
    const input: EngineInput = { ...athlete.input, options: method === undefined ? {} : { method } }
    const draft = buildPlan(input)
    return {
      ...input,
      existing: {
        weeks: draft.weeks,
        sessions: draft.sessions.map((s, i) => ({
          ...s,
          id: `s${String(i)}`,
          status: 'planned',
          activityId: null,
        })),
      },
    }
  }

  /** The figures of some rules for a plan, as the server builds them from the snapshot. */
  function shapeView(input: EngineInput, rules: string[]): ExplainView {
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
    return explainInputs({ subject: 'rules', rules }, ctx)
  }

  /** Opens the drawer on `rules` over the figures of `input`; the registry holds the two Params. */
  async function openOn(input: EngineInput, rules: string[]) {
    const figures = shapeView(input, rules)
    mockApi(drawerRoutes(() => figures, 'km', { 'GET /api/research/params': () => shapeRegistry }))
    const { user, open } = renderButton({ subject: 'rules', rules }, rules)
    await open()
    const dialog = await screen.findByRole('dialog', { name: 'Why this?' })
    await within(dialog).findByRole('heading', { name: 'From your numbers' })
    return { user, dialog, figures }
  }

  /** The worded sentences of a rule's facts, in the order the drawer lists them. */
  const sentencesOf = (figures: ExplainView, rule: string) =>
    (figures.groups.find((group) => group.rule === rule)?.facts ?? []).map((fact) =>
      renderFact(fact, 'km'),
    )

  test('P2 states the run days against the default, with both grades, and the grade of the choice', async () => {
    const { dialog, figures } = await openOn(planOf('half', 'three-run-days'), ['P2', 'F5'])
    const sentences = sentencesOf(figures, 'P2')
    expect(sentences).toEqual([
      'Plan shape chosen: Three run days a week.',
      "Run days: at most 3 a week (grade D), against 6 in the plan's own shape (grade D).",
      GRADE,
    ])
    const group = await within(dialog).findByRole('group', { name: 'Three run days' })
    for (const sentence of sentences) expect(within(group).getByText(sentence)).toBeInTheDocument()
    // the run-day fact of F5 names the shape that sets the cap
    const f5 = within(dialog).getByRole('group', { name: 'Run frequency and availability' })
    expect(
      within(f5).getByText('Your plan shape, Three run days a week, caps run days at 3 a week.'),
    ).toBeInTheDocument()
    expectCleanCopy(dialog)
  })

  test("the rule section holds the override's grade D and the records it rests on, each with its level", async () => {
    const { user, dialog } = await openOn(planOf('half', 'three-run-days'), ['P2'])
    const section = await within(dialog).findByRole('region', { name: 'Three run days' })
    expect(within(section).getByText('Evidence grade D')).toBeInTheDocument()
    expect(within(section).getByText('Default (no direct study)')).toBeInTheDocument()
    expect(within(section).getByText(/A choice, not a better plan/)).toBeInTheDocument()

    // a practice record is level D and a trial is level C: the grades are the records' own
    const furman = await within(section).findByRole('button', {
      name: /Services and Training Programs/,
    })
    await user.click(furman)
    expect(within(section).getByText('Evidence level D')).toBeInTheDocument()
    expect(within(section).getByText('book-or-guideline')).toBeInTheDocument()
    const pollock = JSON.parse(
      readFileSync(
        join(process.cwd(), 'research', 'papers', 'pollock-1977-frequency-duration-injury.json'),
        'utf8',
      ),
    ) as { title: string; evidenceLevel: string }
    expect(pollock.evidenceLevel).toBe('C')
    await user.click(
      within(section).getByRole('button', { name: new RegExp(pollock.title.slice(0, 30)) }),
    )
    expect(within(section).getByText('Evidence level C')).toBeInTheDocument()
  })

  test('P4 states the build against the default, the base taking the difference, and the kinds', async () => {
    const { dialog, figures } = await openOn(planOf('half', 'longer-base'), ['P4', 'E2'])
    const sentences = sentencesOf(figures, 'P4')
    expect(sentences).toEqual([
      'Plan shape chosen: A longer base.',
      "Build phase: at most 4 weeks (grade D), against 6 in the plan's own shape (grade D).",
      'The base takes the difference: up to 2 more weeks before the build.',
      'Quality runs: strides only in the base, then hills and threshold runs in the build (grade D).',
      GRADE,
    ])
    const group = await within(dialog).findByRole('group', { name: 'Longer base' })
    for (const sentence of sentences) expect(within(group).getByText(sentence)).toBeInTheDocument()
    expect(within(dialog).getByRole('region', { name: 'Longer base' })).toBeInTheDocument()
    expectCleanCopy(dialog)
  })

  test("P1 states the plan's own values with the grade of each, and says no shape was chosen", async () => {
    const { dialog, figures } = await openOn(planOf('half'), ['P1'])
    expect(sentencesOf(figures, 'P1')).toEqual([
      "This plan has the plan's own shape; no other shape was chosen.",
      "The plan's own shape caps run days at 6 (grade D).",
      "The plan's own shape builds for up to 6 weeks (grade D), after any base.",
      "The plan's own long run is about 35% of a week's running (grade D).",
      GRADE,
    ])
    const group = await within(dialog).findByRole('group', { name: 'Default method' })
    for (const sentence of sentencesOf(figures, 'P1')) {
      expect(within(group).getByText(sentence)).toBeInTheDocument()
    }
    expectCleanCopy(dialog)
  })

  test.each(['first-100-mile', 'trail-50k'])(
    'P1 and P3 state the ultra share of the week for an ultra plan (%s), as the plan places it',
    async (id) => {
      const input = planOf(id)
      expect(input.goal.isUltra).toBe(true)
      const { dialog, figures } = await openOn(input, ['P1', 'P3'])
      const ultra = `${String(Math.round(P.macroDesign.longRunShareOfWeekUltra.value * 100))}%`
      expect(ultra).toBe('45%')
      expect(sentencesOf(figures, 'P1')).toContain(
        `The plan's own long run is about 45% of a week's running (grade ${P.macroDesign.longRunShareOfWeekUltra.grade}).`,
      )
      expect(sentencesOf(figures, 'P3')).toEqual([
        "Every plan shape keeps the long run at about 45% of a week's running; a shorter share is not offered.",
      ])
      expect(within(dialog).queryByText(/about 35% of a week/)).not.toBeInTheDocument()
      expectCleanCopy(dialog)
    },
  )

  test('P3 states 35% for a half marathon plan, and the plan asks the server for the plan input', async () => {
    const { figures } = await openOn(planOf('half'), ['P3'])
    expect(sentencesOf(figures, 'P3')).toEqual([
      "Every plan shape keeps the long run at about 35% of a week's running; a shorter share is not offered.",
    ])
    expect(explainNeeds(['P3'])).toMatchObject({ planInput: true })
  })

  test('P1 claims no base for a plan that has none: the build is a limit, after any base', () => {
    const input = planOf('novice-5k')
    expect(input.existing!.weeks.some((week) => week.phase === 'base')).toBe(false)
    const sentences = sentencesOf(shapeView(input, ['P1']), 'P1')
    expect(sentences).toContain(
      "The plan's own shape builds for up to 6 weeks (grade D), after any base.",
    )
    expect(sentences.join(' ')).not.toMatch(/base comes before/)
  })

  test("a shape that reads as the plan's own gives the reason on P1 and on its own rule, and no override", async () => {
    const { dialog, figures } = await openOn(planOf('marathon', 'three-run-days'), ['P1', 'P2'])
    const read =
      "Plan shape chosen: Three run days a week, read as the plan's own shape: not for this goal."
    expect(sentencesOf(figures, 'P1')[0]).toBe(read)
    expect(sentencesOf(figures, 'P2')).toEqual([read, GRADE])
    const p2 = await within(dialog).findByRole('group', { name: 'Three run days' })
    expect(within(p2).getByText(read)).toBeInTheDocument()
    expect(within(p2).queryByText(/Run days: at most/)).not.toBeInTheDocument()
    expectCleanCopy(dialog)
  })

  test('a shape the plan did not choose says so and states none of its figures', async () => {
    const { figures } = await openOn(planOf('half', 'longer-base'), ['P2'])
    expect(sentencesOf(figures, 'P2')).toEqual([
      'Plan shape chosen: A longer base. This rule is about another shape.',
      GRADE,
    ])
  })

  test('P3 is not a shape: it says the long run keeps its share under every shape', async () => {
    const { dialog, figures } = await openOn(planOf('half', 'three-run-days'), ['P3'])
    expect(sentencesOf(figures, 'P3')).toEqual([
      "Every plan shape keeps the long run at about 35% of a week's running; a shorter share is not offered.",
    ])
    expect(
      await within(dialog).findByRole('group', { name: 'Shorter long run' }),
    ).toBeInTheDocument()
  })

  test('a runner with no plan reads a gap sentence on each rule', () => {
    const athlete = athletes().find((a) => a.id === 'half')!
    const figures = shapeView({ ...athlete.input, existing: null }, ['P1', 'P2', 'P3', 'P4'])
    for (const rule of ['P1', 'P2', 'P3', 'P4']) {
      const facts = figures.groups.find((group) => group.rule === rule)?.facts ?? []
      expect(
        facts.map((fact) => [fact.state, fact.template]),
        rule,
      ).toEqual([['insufficient', 'explain.plan-gap']])
    }
  })
})

describe('WhyDrawer, strength loads [rule F8]', () => {
  // 52 163 g is 115 lb, and 52.25 kg on the display grid (a quarter of a kilogram).
  const lastSession: InputFact = {
    id: 'f8.last',
    template: 'explain.f8-last',
    slots: {
      exercise: 'Back squat',
      date: q.date('2026-10-17'),
      sets: '3 sets',
      load: { kind: 'load', g: 52_163 },
      count: q.count(5),
    },
    rule: 'F8',
    sources: [],
    moreSources: 0,
    state: 'used',
  }
  const strengthView = view({
    subject: 'strength',
    rules: ['F8'],
    groups: [{ rule: 'F8', facts: [lastSession] }],
  })

  /** `GET /api/settings` with the weight unit, or without it: a payload kept before it existed. */
  const settingsWith = (weightUnit: UserSettings['weightUnit'] | undefined): MockRoutes => ({
    'GET /api/settings': () => ({
      email: 'runner@example.com',
      displayName: null,
      units: 'mi',
      ...(weightUnit === undefined ? {} : { weightUnit }),
    }),
  })

  test.each([
    { weightUnit: 'kg' as const, load: '52.25 kg' },
    { weightUnit: 'lb' as const, load: '115 lb' },
    { weightUnit: undefined, load: '115 lb' },
  ])(
    'reads a load in the weight unit of the settings ($weightUnit)',
    async ({ weightUnit, load }) => {
      mockApi(drawerRoutes(() => strengthView, 'mi', settingsWith(weightUnit)))
      const { open } = renderButton({ subject: 'strength', id: 'p1' }, ['F8'])
      await open()

      const dialog = await screen.findByRole('dialog', { name: 'Why this?' })
      const group = await within(dialog).findByRole('group', { name: 'Strength load progression' })
      expect(
        within(group).getByText(
          `The last session of Back squat was on 17 Oct: 3 sets, heaviest set ${load} x 5.`,
        ),
      ).toBeInTheDocument()
      expectCleanCopy(dialog)
    },
  )
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
