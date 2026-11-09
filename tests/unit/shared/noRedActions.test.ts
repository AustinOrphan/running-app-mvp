import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/*
 * Design rules, sections 11 and 19 (docs/superpowers/specs/2026-10-21-visual-design.md): a destructive
 * action is a secondary button with a trash glyph and a confirm sheet, never red, and a field error
 * is a `--warning` edge with a glyph and words. `--danger` stays in tokens.css; what is left of it
 * colours an error sentence only, so this scan fails on a button, a fill or an edge in that colour.
 */

const webRoot = fileURLToPath(new URL('../../../web/', import.meta.url))

function files(dir: string, suffix: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return files(path, suffix)
    return path.endsWith(suffix) ? [path] : []
  })
}

describe('no red on actions and edges', () => {
  it('has no button variant "danger"', () => {
    const offenders = files(webRoot, '.tsx').filter((path) =>
      /variant=["{'`]*danger/.test(readFileSync(path, 'utf8')),
    )
    expect(offenders).toEqual([])
    const button = readFileSync(join(webRoot, 'components/Button.tsx'), 'utf8')
    expect(button).not.toMatch(/danger/)
    const css = readFileSync(join(webRoot, 'components/Button.module.css'), 'utf8')
    expect(css).not.toMatch(/danger/)
  })

  it('uses --danger for the colour of a sentence only, never a fill, an edge or a button', () => {
    const offenders: string[] = []
    for (const path of files(webRoot, '.css')) {
      if (path.endsWith('tokens.css')) continue
      const css = readFileSync(path, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
      for (const rule of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        const selector = rule[1]!.trim()
        for (const declaration of rule[2]!.split(';')) {
          if (!declaration.includes('var(--danger)')) continue
          const property = declaration.split(':')[0]!.trim()
          if (property !== 'color' || /button|btn|delete|remove/i.test(selector)) {
            offenders.push(`${path.slice(webRoot.length)}: ${selector} { ${declaration.trim()} }`)
          }
        }
      }
    }
    expect(offenders).toEqual([])
  })

  it('fades no disabled control: no opacity in a disabled rule of Button, Field or Stepper', () => {
    // Busy (aria-busy) is the one fade left, and it is not a disabled look.
    const offenders: string[] = []
    for (const name of ['Button', 'Field', 'strength/Stepper']) {
      const css = readFileSync(join(webRoot, `components/${name}.module.css`), 'utf8').replace(
        /\/\*[\s\S]*?\*\//g,
        '',
      )
      for (const rule of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        const selector = rule[1]!.trim()
        if (!/disabled/.test(selector) || !/opacity:\s*0?\.\d/.test(rule[2]!)) continue
        // the busy fade of Button is the documented exception
        if (name === 'Button' && selector === ".button:disabled,\n.button[aria-disabled='true']")
          continue
        offenders.push(`${name}: ${selector}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('draws the invalid field edge in --warning', () => {
    const css = readFileSync(join(webRoot, 'components/Field.module.css'), 'utf8')
    const rule = /\.control\[aria-invalid='true'\]\s*\{([^}]*)\}/.exec(css)
    expect(rule?.[1]).toContain('var(--warning)')
  })
})
