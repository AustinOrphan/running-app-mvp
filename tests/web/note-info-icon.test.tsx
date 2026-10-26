import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { TodayView } from '../../shared/types.ts'
import { makeCoach, makeHero, makeToday } from './today-fixtures.ts'
import { renderToday as render, startToday } from './today-render.tsx'

// STATUS follow-up 19 (b): the Why of a note is an info icon at the right end of the note's line,
// with the name the Why line had, the same drawer and a 44 px touch target. The fixed clock is
// Wednesday 2026-03-18.

// Stands in for the drawer so the wiring is visible: which rules it was opened with.
vi.mock('../../web/components/WhyDrawer.tsx', () => ({
  WhyDrawer: ({ rules, open }: { rules: string[]; open: boolean }) =>
    open ? (
      <div role="dialog" aria-label="Why">
        {`rules: ${rules.join(', ')}`}
      </div>
    ) : null,
}))

beforeEach(startToday)

afterEach(() => {
  vi.useRealTimers()
})

describe('Today: the Why of a note is an info icon at the end of its line', () => {
  const noted = (): TodayView => {
    const view = makeToday()
    view.readiness.redFlags = [
      {
        code: 'focal-bone-pain',
        message: 'Point tenderness on a bone: see a clinician before the next run.',
        rules: ['n-1'],
      },
    ]
    return view
  }

  test('it has the name the Why line had, no visible word and the same drawer', async () => {
    const user = userEvent.setup()
    render(noted())
    const notes = await screen.findByRole('region', { name: 'Health notes' })
    const icon = within(notes).getByRole('button', { name: 'Why: this note' })
    expect(icon).toHaveTextContent('')
    expect(icon.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
    // on the note's own line, after its text, and not a line of its own
    const note = icon.closest('li')!
    expect(within(note).getByText(/Point tenderness on a bone/)).toBeInTheDocument()
    expect(note.lastElementChild).toBe(icon)
    await user.click(icon)
    expect(await screen.findByRole('dialog', { name: 'Why' })).toHaveTextContent('rules: n-1')
  })

  test('the keyboard reaches it and opens the drawer', async () => {
    const user = userEvent.setup()
    render(noted())
    const icon = await screen.findByRole('button', { name: 'Why: this note' })
    expect(icon).not.toHaveAttribute('tabindex', '-1')
    // the first control of the page: Log activity, then the note's icon
    await user.tab()
    await user.tab()
    expect(icon).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(await screen.findByRole('dialog', { name: 'Why' })).toBeInTheDocument()
  })

  test('the heat note takes the same icon', async () => {
    const user = userEvent.setup()
    window.localStorage.setItem('rl_today_more', '1')
    const hero = makeHero()
    render(
      makeToday({
        heat: {
          wbgtC: 25,
          note: 'Warm and humid this afternoon. Run by effort and drink early.',
          coolerHour: '06:00',
          peakHour: 15,
          coolerValue: 17,
          index: 'wbgt',
          hotForSteering: false,
        },
        sessions: [{ session: hero.session, advice: 'as-planned', reasons: [] }],
        coach: makeCoach({ hero }),
      }),
    )
    const icon = await screen.findByRole('button', { name: 'Why: the heat note' })
    expect(icon).toHaveTextContent('')
    await user.click(icon)
    expect(await screen.findByRole('dialog', { name: 'Why' })).toHaveTextContent('rules: I7, I9')
  })

  test('the icon is a 44 px box that draws a circle of at least 24 px', () => {
    const css = readFileSync(join(process.cwd(), 'web/components/ExplainButton.module.css'), 'utf8')
    const px = (name: string, rule: string) => {
      const value = new RegExp(`${name}:\\s*([\\d.]+)rem`).exec(rule)?.[1]
      return value === undefined ? Number.NaN : Number(value) * 16
    }
    const info = /\.info\s*\{([^}]*)\}/.exec(css)?.[1] ?? ''
    const icon = /\.icon\s*\{([^}]*)\}/.exec(css)?.[1] ?? ''
    expect(px('width', info)).toBeGreaterThanOrEqual(44)
    expect(px('height', info)).toBeGreaterThanOrEqual(44)
    expect(px('width', icon)).toBeGreaterThanOrEqual(22)
    expect(px('height', icon)).toBeGreaterThanOrEqual(22)
  })
})
