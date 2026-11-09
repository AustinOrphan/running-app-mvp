import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

/**
 * The app has no hand-drawn illustrations (visual design, section 18): a picture is drawn from the
 * runner's data or not at all, and an empty state is type. No drawing component, no Illustrations
 * switch and no `art` prop may come back.
 */

const ROOT = fileURLToPath(new URL('../../..', import.meta.url))

function sources(dir: string): string[] {
  return readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return sources(path)
    return /\.(tsx?|css)$/.test(entry.name) ? [path] : []
  })
}

describe('no hand-drawn illustrations', () => {
  test('the illustrations folder is gone', () => {
    expect(existsSync(join(ROOT, 'web/components/illustrations'))).toBe(false)
  })

  test.each([
    ['an Illustration component or hook', /\bIllustration\b|useIllustrations|ArtKey/],
    ['the Illustrations device key', /rl_illustrations/],
    ['a drawing marker on an svg', /data-art\b/],
    ['the Illustrations setting', />\s*Illustrations\s*</],
  ])('web/ holds no %s', (_name, pattern) => {
    const hits = sources('web').filter((file) =>
      pattern.test(readFileSync(join(ROOT, file), 'utf8')),
    )
    expect(hits).toEqual([])
  })
})
