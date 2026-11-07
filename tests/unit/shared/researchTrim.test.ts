// The build keeps each paper record to what the Research page and the why drawer render
// (`web/researchTrim.ts`); the full record stays in `research/papers` for `npm run research:check`.
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { trimPaper } from '../../../web/researchTrim.ts'

const PAPERS = join(process.cwd(), 'research', 'papers')

/** Every field `CorpusPaper` (web/components/researchCorpus.ts) can carry. */
const CORPUS_FIELDS = new Set([
  'id',
  'title',
  'authors',
  'year',
  'journal',
  'doi',
  'pmid',
  'url',
  'design',
  'population',
  'sampleSize',
  'evidenceLevel',
  'topics',
  'findings',
  'limitations',
  'edition',
  'isbn',
  'pagesRead',
  'interests',
  'vetting',
])

describe('trimPaper', () => {
  test('drops the vetting evidence and the implications, and keeps who signed off', () => {
    const trimmed = trimPaper({
      id: 'doe-2020-example',
      findings: ['A synthetic finding.'],
      implications: ['A synthetic implication.'],
      verification: { r1: { result: 'pass', note: 'long note' } },
      vetting: { signedOff: 'Reviewer, 2026-10-31', r1: { result: 'pass', note: 'long note' } },
    })
    expect(trimmed).toEqual({
      id: 'doe-2020-example',
      findings: ['A synthetic finding.'],
      vetting: { signedOff: 'Reviewer, 2026-10-31' },
    })
  })

  test('leaves a record with no sign-off without a vetting field', () => {
    expect(trimPaper({ id: 'a', vetting: { r1: {} } })).toEqual({ id: 'a' })
  })

  test('leaves every real record with only the fields the corpus type names', () => {
    for (const file of readdirSync(PAPERS).filter((name) => name.endsWith('.json'))) {
      const record = JSON.parse(readFileSync(join(PAPERS, file), 'utf8')) as Record<string, unknown>
      for (const key of Object.keys(trimPaper(record))) {
        expect(CORPUS_FIELDS.has(key), `${file}: ${key}`).toBe(true)
      }
    }
  })
})
