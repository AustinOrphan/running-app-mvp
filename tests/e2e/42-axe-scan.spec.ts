import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { addDays } from '../../shared/dates.ts'
import { SHAPES } from '../fixtures/routeShapes.ts'
import {
  planWithRunToday,
  relativeDates,
  saveStrengthSetup,
  seedRunWithTrack,
  signedInApi,
} from './helpers.ts'

// An accessibility scan (axe-core, WCAG 2.1 A and AA) of the main pages at a phone and a desktop
// width (owner decision D9, 2026-11-14). axe finds only the part of the problems a machine can
// decide (names, roles, ids, contrast); it does not replace a keyboard or screen-reader pass.
//
// A finding that changes no pixels is fixed in the code. A finding that changes how a page looks
// (contrast, sizes, layout) is a visual change and lands in its own PR, so it is listed in
// KNOWN_VIOLATIONS with the reason; the spec then fails only on a violation not in that list, and
// also on an entry that no longer occurs, so the list shrinks as the visual PRs land.

const VIEWPORTS = [
  { name: 'phone', width: 390, height: 844 },
  { name: 'desktop', width: 1280, height: 800 },
] as const

interface Target {
  name: string
  /** Path to open; `:run` stands for the seeded run's id. */
  path: string
  /** Heading level 1 the page shows once its main content has rendered. */
  heading: string | RegExp
}

const TARGETS: readonly Target[] = [
  { name: 'Today', path: '/', heading: /./ },
  { name: 'Log', path: '/activities', heading: /./ },
  { name: 'Activity', path: '/activities/:run', heading: /./ },
  { name: 'Plan', path: '/plan', heading: /./ },
  { name: 'Race', path: '/race', heading: /./ },
  { name: 'Strength', path: '/strength', heading: /./ },
  { name: 'Trends', path: '/trends', heading: /./ },
  { name: 'Profile', path: '/profile', heading: /./ },
  { name: 'Settings', path: '/settings', heading: /./ },
  { name: 'More', path: '/more', heading: /./ },
  { name: 'Warning signs', path: '/warning-signs', heading: 'Warning signs' },
  { name: 'What the plan can see', path: '/plan-inputs', heading: /./ },
]

interface KnownViolation {
  /** axe rule id. */
  rule: string
  /** `Target.name` of the page. */
  page: string
  /** Substring of the selector axe reports for the node (a stable description of it). */
  selector: string
  /** Why it is not fixed here, and the visual PR that fixes it. */
  why: string
}

/** Violations that need a visual change. Each is removed by the PR named in `why`. */
const KNOWN_VIOLATIONS: readonly KnownViolation[] = [
  {
    rule: 'color-contrast',
    page: 'Trends',
    selector: '._head > span',
    why:
      'The column headings of the empty Hours preview (EmptyPreview in EmptyState) read 3.24:1 ' +
      '(#898892 on #f6f6f9; 4.5:1 needed) because .preview sets opacity 0.7 over --text-muted. ' +
      'The preview is aria-hidden and meant to be faint, so this is a visual decision: ' +
      'a contrast PR either raises the preview colour or keeps it as a decorative placeholder.',
  },
]

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']

let page: Page
let runId: string
/** Known violations seen on at least one page load, as `page|rule|selector`. */
const seen = new Set<string>()

test.beforeAll(async ({ browser, baseURL }) => {
  const origin = baseURL ?? ''
  const context = await browser.newContext({
    baseURL,
    viewport: { width: 390, height: 844 },
    // Chart animations would make colour readings depend on timing.
    reducedMotion: 'reduce',
  })
  page = await context.newPage()
  const api = await signedInApi(page, origin)
  // A plan with a run today (this also empties the data), then the rest of what the pages show.
  await planWithRunToday(api, page, origin, 'Axe scan marathon')
  const { lastWednesday, raceDate } = relativeDates()
  runId = await seedRunWithTrack(
    api,
    { date: addDays(lastWednesday, -1), minutes: 40, distanceM: 7000 },
    SHAPES.loop(),
  )
  await saveStrengthSetup(api)
  // The race plan page shows its content for an ultra goal.
  const goals = (await api.get('/goals')) as Array<{ id: string }>
  const goal = goals[0]
  if (goal === undefined) throw new Error('The seeded goal is missing.')
  await api.put(`/goals/${goal.id}`, {
    distanceM: 160_934,
    gainM: 5000,
    lossM: 5000,
    surface: 'trail',
    goalType: 'finish',
    startTime: '06:00',
    supportLevel: 'aided',
    targetDate: raceDate,
  })
})

test.afterAll(async () => {
  await page.context().close()
})

for (const viewport of VIEWPORTS) {
  for (const target of TARGETS) {
    test(`${target.name} at ${viewport.name} width has no new accessibility violations`, async () => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height })
      await page.goto(target.path.replace(':run', runId))
      await expect(
        page.getByRole('heading', { level: 1, name: target.heading }).first(),
      ).toBeVisible()
      await page.waitForLoadState('networkidle')

      const results = await new AxeBuilder({ page }).withTags(TAGS).analyze()
      const found = results.violations.flatMap((violation) =>
        violation.nodes.map((node) => ({
          rule: violation.id,
          // CSS-module class names carry a build hash (`_row_1s5t7_89`); the hash is dropped.
          selector: node.target.join(' ').replace(/_(\w+?)_[a-z0-9]{5,}_\d+/g, '_$1'),
          summary: node.failureSummary ?? '',
        })),
      )
      const known = KNOWN_VIOLATIONS.filter((k) => k.page === target.name)
      const matches = (f: (typeof found)[number], k: KnownViolation) =>
        k.rule === f.rule && f.selector.includes(k.selector)
      for (const k of known) {
        if (found.some((f) => matches(f, k))) seen.add(`${k.page}|${k.rule}|${k.selector}`)
      }
      const unknown = found.filter((f) => !known.some((k) => matches(f, k)))
      expect(
        unknown.map((f) => `${f.rule} ${f.selector}\n${f.summary}`),
        `New violations on ${target.name} at ${viewport.name} width`,
      ).toEqual([])
    })
  }
}

test('every known violation still occurs', () => {
  const stale = KNOWN_VIOLATIONS.filter((k) => !seen.has(`${k.page}|${k.rule}|${k.selector}`))
  expect(stale.map((k) => `${k.page}: ${k.rule} ${k.selector}`)).toEqual([])
})
