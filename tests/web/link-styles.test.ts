import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'

// Links are drawn in the app's accent, by one rule in the global stylesheet. The rule is not a
// per-component habit: a link with no class of its own (the "Based on" links of the Why drawer, the
// links in a sentence of a page) needs it, and the stylesheets of the components do not repeat it.

const root = join(process.cwd(), 'web')

function stylesheets(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return stylesheets(path)
    return name.endsWith('.css') ? [path] : []
  })
}

/** A stylesheet without its comments, so a rule is told apart from a sentence about one. */
const read = (path: string) => readFileSync(path, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
const tokens = read(join(root, 'styles', 'tokens.css'))
const global = read(join(root, 'styles', 'global.css'))

/** The `--accent` of a block of the tokens, as `#rrggbb`. */
function accentIn(block: string): string {
  const found = /--accent:\s*(#[0-9a-f]{6});/i.exec(block)
  if (found === null) throw new Error('No --accent in the block')
  return found[1]!
}

/** The relative luminance of a colour, as WCAG 2.x works it out. */
function luminance(hex: string): number {
  const channel = (at: number) => {
    const value = Number.parseInt(hex.slice(at, at + 2), 16) / 255
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5)
}

function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (light! + 0.05) / (dark! + 0.05)
}

describe('links', () => {
  test('take the accent from one rule in the global stylesheet, with an underline offset', () => {
    expect(global).toMatch(/^a \{[^}]*color: var\(--accent\);[^}]*text-underline-offset: 0\.2em;/m)
  })

  test('have no a:visited rule, which would outrank the class of a link drawn as a button', () => {
    for (const path of stylesheets(root)) {
      expect(read(path), path).not.toMatch(/a:visited/)
    }
    // the global rule is the one `a` rule, and the browser's visited colour is below an author's
    expect(global.match(/^a\b[^{]*\{/gm)).toHaveLength(1)
  })

  test('are not given the accent again by a component rule that sets nothing else', () => {
    const repeats: string[] = []
    for (const path of stylesheets(join(root, 'components')).concat(
      stylesheets(join(root, 'pages')),
    )) {
      for (const rule of read(path).matchAll(/([^{}]*\ba)\s*\{\s*color: var\(--accent\);\s*\}/g)) {
        repeats.push(`${path}: ${rule[1]!.trim()}`)
      }
    }
    expect(repeats).toEqual([])
  })

  test('are legible in both schemes: the accent holds at least 7:1 on the page and the raised surface', () => {
    const lightBlock = tokens.slice(
      tokens.indexOf(':root {'),
      tokens.indexOf('@media (prefers-color-scheme: dark)'),
    )
    const darkBlock = tokens.slice(tokens.indexOf(':root[data-theme="dark"] {'))
    const surface = (block: string, name: string): string => {
      const found = new RegExp(`--${name}:\\s*(#[0-9a-f]{6});`, 'i').exec(block)
      if (found === null) throw new Error(`No --${name} in the block`)
      return found[1]!
    }
    const schemes = [
      ['light', lightBlock],
      ['dark', darkBlock],
    ] as const
    for (const [scheme, block] of schemes) {
      const accent = accentIn(block)
      expect(contrast(accent, surface(block, 'surface')), `${scheme} on the page`).toBeGreaterThan(
        7,
      )
      expect(
        contrast(accent, surface(block, 'surface-raised')),
        `${scheme} on the raised surface`,
      ).toBeGreaterThan(7)
    }
    // the media query and the manual override give the same dark accent
    const media = tokens.slice(
      tokens.indexOf('@media (prefers-color-scheme: dark)'),
      tokens.indexOf(':root[data-theme="dark"] {'),
    )
    expect(accentIn(media)).toBe(accentIn(darkBlock))
    expect(accentIn(lightBlock)).not.toBe(accentIn(darkBlock))
  })
})
