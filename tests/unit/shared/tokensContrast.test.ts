import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/*
 * Design rules, section 15 (docs/superpowers/specs/2026-10-21-visual-design.md): the colour pairs the
 * rules name, asserted from `web/styles/tokens.css` in both themes. Ratios are WCAG 2.x.
 */

const css = readFileSync(new URL('../../../web/styles/tokens.css', import.meta.url), 'utf8')

type Vars = Record<string, string>

/** The declarations of the first rule whose selector text is `selector`. */
function declarations(selector: string): Vars {
  const start = css.indexOf(selector)
  if (start < 0) throw new Error(`selector not found: ${selector}`)
  const open = css.indexOf('{', start)
  const close = css.indexOf('}', open)
  const vars: Vars = {}
  for (const m of css.slice(open + 1, close).matchAll(/(--[\w-]+):\s*([^;]+);/g)) {
    vars[m[1]!] = m[2]!.trim()
  }
  return vars
}

const lightVars = declarations(':root {')
const darkVars: Vars = { ...lightVars, ...declarations(':root[data-theme="dark"] {') }
const darkMedia: Vars = {
  ...lightVars,
  ...declarations(':root:not([data-theme="light"]) {'),
}

function resolve(vars: Vars, name: string): string {
  let value = vars[name]
  if (value === undefined) throw new Error(`token not found: ${name}`)
  const ref = /^var\((--[\w-]+)\)$/.exec(value)
  if (ref) value = resolve(vars, ref[1]!)
  return value
}

function luminance(hex: string): number {
  const m = /^#([0-9a-f]{6})$/i.exec(hex)
  if (!m) throw new Error(`not a 6-digit hex colour: ${hex}`)
  const n = parseInt(m[1]!, 16)
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }) as [number, number, number]
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function ratio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number]
  return (hi + 0.05) / (lo + 0.05)
}

interface Pair {
  fg: string
  bg: string
  min: number
  why: string
}

const SURFACES = ['--surface', '--surface-raised']
const ALL_SURFACES = [...SURFACES, '--surface-sunken']

const pairs: Pair[] = [
  // Text, 4.5:1 on every surface it sits on; body text 12:1; muted 6:1 on surface and raised.
  ...ALL_SURFACES.map((bg) => ({ fg: '--text', bg, min: 12, why: 'body text' })),
  ...SURFACES.map((bg) => ({ fg: '--text-muted', bg, min: 6, why: 'muted text' })),
  { fg: '--text-muted', bg: '--surface-sunken', min: 4.5, why: 'muted text on sunken' },
  // The accent as text (links, selected labels) and as a mark (focus ring, actual data).
  ...ALL_SURFACES.map((bg) => ({ fg: '--accent', bg, min: 4.5, why: 'accent text' })),
  { fg: '--accent', bg: '--accent-soft', min: 4.5, why: 'accent label on the selected fill' },
  { fg: '--text', bg: '--accent-soft', min: 4.5, why: 'text on the selected fill' },
  // Today's column of the week bars: the planned outline and the open marks are drawn in the muted
  // text colour there, because the control edge is under 3:1 on the selected fill.
  { fg: '--text-muted', bg: '--accent-soft', min: 4.5, why: "planned outline in today's column" },
  { fg: '--accent-text', bg: '--accent', min: 4.5, why: 'label on an accent fill' },
  // Status colours are text colours here.
  ...SURFACES.flatMap((bg) =>
    ['--success', '--warning', '--danger'].map((fg) => ({ fg, bg, min: 4.5, why: 'status text' })),
  ),
  // Non-text marks, 3:1: control edges, planned series, categorical series, the Meter near-band edge.
  ...SURFACES.map((bg) => ({ fg: '--border-strong', bg, min: 3, why: 'control edge' })),
  { fg: '--border-strong', bg: '--surface-sunken', min: 3, why: 'near-band edge on the track' },
  ...SURFACES.flatMap((bg) =>
    ['--chart-1', '--chart-2', '--chart-3', '--chart-4', '--chart-planned'].map((fg) => ({
      fg,
      bg,
      min: 3,
      why: 'chart series',
    })),
  ),
]

describe.each([
  ['light', lightVars],
  ['dark', darkVars],
] as const)('token contrast, %s', (_theme, vars) => {
  it.each(pairs)('$fg on $bg is at least $min:1 ($why)', ({ fg, bg, min }) => {
    expect(ratio(resolve(vars, fg), resolve(vars, bg))).toBeGreaterThanOrEqual(min)
  })
})

describe('dark theme', () => {
  it('has the same values under the media query and the manual override', () => {
    expect(darkMedia).toEqual(darkVars)
  })
})
