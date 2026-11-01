import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  checkCorpus,
  idsInMarkdown,
  KNOWN_UNRESOLVED,
  loadPaperFiles,
  paperSchema,
  RESEARCH_DIR,
  topicKeys,
} from '../../../scripts/research-check.ts'
import { titleOverlap } from '../../../scripts/research-verify.ts'

const files = loadPaperFiles()

describe('research corpus', () => {
  it('holds the 424 verified papers and the 22 topics', () => {
    expect(files).toHaveLength(424)
    expect(topicKeys()).toHaveLength(22)
  })

  it.each(files.map(({ file, data }) => [file, data] as const))('%s validates', (file, data) => {
    const parsed = paperSchema.safeParse(data)
    expect(parsed.success ? [] : parsed.error.issues).toEqual([])
    if (parsed.success) expect(`${parsed.data.id}.json`).toBe(file)
  })

  it('has no problem: schema, topics, unique DOIs and every cited id resolves', () => {
    expect(checkCorpus().errors).toEqual([])
  })

  it('cites every id of research/rules and engine-rules.md', () => {
    const known = new Set(files.map(({ file }) => file.replace(/\.json$/, '')))
    const engine = idsInMarkdown(readFileSync(join(RESEARCH_DIR, 'engine-rules.md'), 'utf8'))
    expect(engine.length).toBeGreaterThan(200)
    expect(engine.filter((id) => !known.has(id))).toEqual([])
  })

  it('lists known unresolved ids only with a reason, and none of them is a paper', () => {
    const known = new Set(files.map(({ file }) => file.replace(/\.json$/, '')))
    for (const [id, reason] of Object.entries(KNOWN_UNRESOLVED)) {
      expect(reason.length).toBeGreaterThan(10)
      expect(known.has(id)).toBe(false)
    }
  })

  it('rejects a paper with an unknown field, a bad level or a malformed DOI', () => {
    const first = files[0]
    expect(first).toBeDefined()
    const base = first?.data as Record<string, unknown>
    expect(paperSchema.safeParse({ ...base, extra: 1 }).success).toBe(false)
    expect(paperSchema.safeParse({ ...base, evidenceLevel: 'E' }).success).toBe(false)
    expect(paperSchema.safeParse({ ...base, doi: 'https://doi.org/10.1/x' }).success).toBe(false)
    expect(paperSchema.safeParse({ ...base, findings: [] }).success).toBe(false)
  })
})

describe('idsInMarkdown', () => {
  it('reads bracketed lists and table cells, and ignores other brackets', () => {
    const text = [
      'A rule [foo-2020-bar, baz-1999-qux] and [not an id], see [x].',
      '| Parameter | ids |',
      '| a | hecksteden-2015-individual-response, mann-2014-high-low-responders |',
      '| b | frandsen-2025-session-spike (by analogy) |',
    ].join('\n')
    expect(idsInMarkdown(text)).toEqual([
      'baz-1999-qux',
      'foo-2020-bar',
      'frandsen-2025-session-spike',
      'hecksteden-2015-individual-response',
      'mann-2014-high-low-responders',
    ])
  })
})

describe('Crossref title check', () => {
  it('scores equal titles 1 and unrelated titles near 0', () => {
    expect(
      titleOverlap('Session spikes and running injury', 'Session Spikes and Running Injury'),
    ).toBe(1)
    expect(
      titleOverlap('Session spikes and running injury', 'Tapering for endurance performance'),
    ).toBeLessThan(0.3)
  })

  it('tolerates a subtitle that the other title lacks', () => {
    expect(
      titleOverlap(
        'Training intensity distribution in runners',
        'Training intensity distribution in runners: a systematic review and meta-analysis',
      ),
    ).toBeGreaterThanOrEqual(0.6)
  })
})
