import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { assertCleanCopy } from '../../../shared/copy/lint.ts'
import { render } from '../../../shared/copy/template.ts'
import { TEMPLATES } from '../../../shared/copy/templates.ts'
import {
  WARNING_LEVELS,
  WARNING_SIGNS,
  WARNING_SIGNS_NAME,
  WARNING_SIGNS_PATH,
} from '../../../shared/copy/warningSigns.ts'

const root = process.cwd()

describe('the Warning signs list', () => {
  test('every sign names at least one source, and each source is a paper of the corpus', () => {
    for (const sign of WARNING_SIGNS) {
      expect(sign.sources.length, sign.id).toBeGreaterThan(0)
      for (const id of sign.sources) {
        expect(
          existsSync(join(root, 'research', 'papers', `${id}.json`)),
          `${sign.id}: ${id}`,
        ).toBe(true)
      }
    }
  })

  test('every sign sits in a level, and both levels have signs', () => {
    const levels = new Set(WARNING_LEVELS.map((level) => level.id))
    for (const sign of WARNING_SIGNS) expect(levels.has(sign.level), sign.id).toBe(true)
    for (const level of levels) {
      expect(
        WARNING_SIGNS.some((sign) => sign.level === level),
        level,
      ).toBe(true)
    }
  })

  test('ids are unique and every template it names is registered and clean', () => {
    expect(new Set(WARNING_SIGNS.map((sign) => sign.id)).size).toBe(WARNING_SIGNS.length)
    const ids = [
      ...WARNING_SIGNS.flatMap((sign) => [sign.title, sign.detail]),
      ...WARNING_LEVELS.flatMap((level) => [level.heading, level.lead]),
    ]
    for (const id of ids) {
      expect(TEMPLATES[id], id).toBeDefined()
      assertCleanCopy(render(TEMPLATES[id], {}, 'km'), id)
    }
  })

  test('the muscle and low-sodium signs say same day, and every sign says how sure it is', () => {
    const byId = new Map(WARNING_SIGNS.map((sign) => [sign.id, sign]))
    for (const id of ['muscle', 'sodium']) {
      const timing = byId.get(id)?.timing
      expect(timing, id).toBeDefined()
      expect(render(TEMPLATES[timing!], {}, 'km'), id).toBe('See a clinician the same day.')
    }
    for (const sign of WARNING_SIGNS) expect(TEMPLATES[sign.basis], sign.id).toBeDefined()
  })

  test('the low-sodium sign escalates to the first level, and its drinking advice is conditional', () => {
    const sodium = WARNING_SIGNS.find((sign) => sign.id === 'sodium')!
    const detail = render(TEMPLATES[sodium.detail], {}, 'km')
    expect(detail).toMatch(/After drinking a lot, do not drink more/)
    expect(render(TEMPLATES[sodium.escalation!], {}, 'km')).toMatch(/call emergency services/)
    const severe = WARNING_SIGNS.find((sign) => sign.id === 'severe-sodium')!
    expect(severe.level).toBe('emergency')
  })

  test('the in-race case is kept: the low-sodium and muscle signs read during or after, or late in', () => {
    for (const id of ['severe-sodium', 'sodium', 'muscle']) {
      const sign = WARNING_SIGNS.find((candidate) => candidate.id === id)!
      const words =
        render(TEMPLATES[sign.title], {}, 'km') + ' ' + render(TEMPLATES[sign.detail], {}, 'km')
      expect(words, id).toMatch(/during or after|late in/)
    }
    const severe = WARNING_SIGNS.find((sign) => sign.id === 'severe-sodium')!
    expect(render(TEMPLATES[severe.title], {}, 'km')).toMatch(/during or after a long effort/)
    expect(render(TEMPLATES[severe.detail], {}, 'km')).toMatch(/during or after a long effort/)
  })

  test('states no odds, no diagnosis and no blame', () => {
    for (const id of Object.keys(TEMPLATES).filter((key) => key.startsWith('warning-signs.'))) {
      const text = render(TEMPLATES[id as keyof typeof TEMPLATES], {}, 'km')
      expect(text, id).not.toMatch(/\d\s?%|chance|likel|probab|you have|diagnos(?:is|ed) as/i)
    }
  })
})

describe('the templates that point to the list', () => {
  const pointing = Object.entries(TEMPLATES).filter(([, template]) =>
    /warning signs/i.test(template.text),
  )

  test('seven pain templates point to it, each by its exact name', () => {
    const ids = pointing.map(([id]) => id).filter((id) => !id.startsWith('warning-signs.'))
    expect(ids.sort()).toEqual([
      'brief.noticed-pain',
      'brief.noticed-pain-bone',
      'execution.pain',
      'execution.pain-bone',
      'standout.pain',
      'standout.pain-bone',
      'standout.pain-checkin',
    ])
    for (const [id, template] of pointing) {
      expect(template.text, id).toContain(WARNING_SIGNS_NAME)
    }
  })

  test('no template or copy file still sends the reader to "the guidance"', () => {
    for (const [id, template] of Object.entries(TEMPLATES)) {
      expect(template.text, id).not.toMatch(/guidance on warning signs/i)
    }
    const dir = join(root, 'shared', 'copy')
    for (const name of readdirSync(dir).filter((file) => file.endsWith('.ts'))) {
      expect(readFileSync(join(dir, name), 'utf8'), name).not.toMatch(/guidance on warning signs/i)
    }
  })

  test('the surfaces that render them turn the name into a link', () => {
    const surfaces = [
      'web/components/StandoutCard.tsx',
      'web/components/InputFacts.tsx',
      'web/components/SessionSheet.tsx',
      'web/pages/ActivityDetailPage.tsx',
      'web/pages/ReviewPage.tsx',
    ]
    for (const file of surfaces) {
      expect(readFileSync(join(root, file), 'utf8'), file).toContain('<WarningSignsText')
    }
    expect(WARNING_SIGNS_PATH).toBe('/warning-signs')
  })
})
