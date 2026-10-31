import { describe, expect, it } from 'vitest'
import { paperSchema, type Paper } from '../../../scripts/research-check.ts'
import { correctionNotices, crossrefNotices } from '../../../scripts/research-verify.ts'

// Stored Crossref work messages (the `message` of GET /works/<doi>), synthetic and modelled on the
// real API: a work lists the notices against it under `updated-by`, each with the notice's DOI,
// its type, a label and an `updated` date; `relation` is usually empty; a notice itself carries
// `update-to`, naming the work it updates. No test here touches the network.

const DOI = '10.1234/example.2020.001'

const record: Paper = {
  id: 'example-2020-topic',
  title: 'An example trial of a synthetic intervention',
  authors: 'Example A, Sample B',
  year: 2020,
  journal: 'Journal of Examples',
  doi: DOI,
  pmid: null,
  url: `https://doi.org/${DOI}`,
  design: 'meta-analysis',
  population: 'Synthetic runners',
  sampleSize: null,
  evidenceLevel: 'A',
  topics: ['example'],
  findings: ['A synthetic finding.'],
  limitations: 'A synthetic limitation.',
  implications: ['A synthetic implication.'],
  verification: {
    doiResolved: true,
    metadataMatches: true,
    abstractSource: 'europepmc',
    findingsSupported: true,
    notes: 'Synthetic record.',
    checkedAt: '2026-10-31',
  },
}

function withNotes(notes: string): Paper {
  return { ...record, verification: { ...record.verification, notes } }
}

function entry(doi: string, type: string, date: [number, number, number]) {
  const [year, month, day] = date
  const when = Date.UTC(year, month - 1, day)
  return {
    DOI: doi,
    type,
    label: type.charAt(0).toUpperCase() + type.slice(1).replace(/_/g, ' '),
    source: 'publisher',
    updated: {
      'date-parts': [date],
      'date-time': new Date(when).toISOString(),
      timestamp: when,
    },
  }
}

function message(extra: Record<string, unknown> = {}) {
  return {
    DOI,
    type: 'journal-article',
    title: [record.title],
    issued: { 'date-parts': [[2020, 5]] },
    relation: {},
    'update-policy': 'https://doi.org/10.1234/crossmark-policy',
    ...extra,
  }
}

const CORRECTION = entry('10.1234/example.2020.001c', 'correction', [2021, 3, 9])
const RETRACTION = entry('10.1234/example.2020.001r', 'retraction', [2022, 6, 1])
const CONCERN = entry('10.1234/example.2020.001e', 'expression_of_concern', [2023, 1, 15])

const NOTICE_C = { doi: '10.1234/example.2020.001c', type: 'correction', date: '2021-03-09' }
const NOTICE_R = { doi: '10.1234/example.2020.001r', type: 'retraction', date: '2022-06-01' }

describe('the fixture record', () => {
  it('passes the paper schema', () => {
    expect(paperSchema.safeParse(record).success).toBe(true)
  })
})

describe('crossrefNotices', () => {
  it('lists every notice with its DOI, type and date, mentioned or not', () => {
    expect(crossrefNotices(message({ 'updated-by': [CORRECTION, RETRACTION] }))).toEqual([
      NOTICE_C,
      NOTICE_R,
    ])
  })

  it('reads a partial date, and falls back to the day of date-time', () => {
    const notices = crossrefNotices({
      'updated-by': [
        { DOI: '10.1234/a', type: 'erratum', updated: { 'date-parts': [[2021]] } },
        { DOI: '10.1234/b', type: 'erratum', updated: { 'date-parts': [[2021, 3]] } },
        { DOI: '10.1234/c', type: 'erratum', updated: { 'date-time': '2021-03-09T10:20:30Z' } },
        { DOI: '10.1234/d', type: 'erratum', updated: { 'date-parts': [[null]] } },
      ],
    })
    expect(notices.map((notice) => notice.date)).toEqual(['2021', '2021-03', '2021-03-09', null])
  })

  it('adds the DOIs under relation is-updated-by, once each', () => {
    const relation = {
      'is-updated-by': [
        { 'id-type': 'doi', id: '10.1234/example.2020.001C', 'asserted-by': 'subject' },
        { 'id-type': 'doi', id: '10.1234/example.2020.001x', 'asserted-by': 'subject' },
        { 'id-type': 'uri', id: 'https://example.com/notice', 'asserted-by': 'subject' },
      ],
    }
    expect(crossrefNotices(message({ relation, 'updated-by': [CORRECTION] }))).toEqual([
      NOTICE_C,
      { doi: '10.1234/example.2020.001x', type: 'unknown', date: null },
    ])
  })

  it('ignores update-to: the message is itself a notice, not one about its own work', () => {
    const notice = message({
      DOI: '10.1234/example.2020.001c',
      type: 'correction',
      'update-to': [entry(DOI, 'correction', [2021, 3, 9])],
    })
    expect(crossrefNotices(notice)).toEqual([])
  })
})

describe('correctionNotices', () => {
  it('finds nothing in a message with no relation and no updated-by', () => {
    const bare = { DOI, title: [record.title], issued: { 'date-parts': [[2020]] } }
    expect(correctionNotices(record, bare)).toEqual([])
    expect(correctionNotices(record, message())).toEqual([])
    expect(correctionNotices(record, message({ 'updated-by': [] }))).toEqual([])
  })

  it('reports a correction that the record does not mention', () => {
    expect(correctionNotices(record, message({ 'updated-by': [CORRECTION] }))).toEqual([NOTICE_C])
  })

  it('does not report a correction whose DOI the record mentions, in any field', () => {
    const stored = message({ 'updated-by': [CORRECTION] })
    const inNotes = withNotes('Crossref lists a correction (10.1234/example.2020.001c); no effect.')
    const inLimitations = { ...record, limitations: 'See doi:10.1234/example.2020.001c.' }
    const inFinding = {
      ...record,
      findings: ['Corrected: https://doi.org/10.1234/example.2020.001c'],
    }
    expect(correctionNotices(inNotes, stored)).toEqual([])
    expect(correctionNotices(inLimitations, stored)).toEqual([])
    expect(correctionNotices(inFinding, stored)).toEqual([])
  })

  it('compares DOIs without regard to case, and accepts punctuation after one', () => {
    const stored = message({ 'updated-by': [CORRECTION] })
    expect(correctionNotices(withNotes('Erratum 10.1234/EXAMPLE.2020.001C.'), stored)).toEqual([])
    expect(correctionNotices(withNotes('(10.1234/example.2020.001c), checked.'), stored)).toEqual(
      [],
    )
  })

  it('does not take a longer DOI, or the record own DOI, for the notice', () => {
    const stored = message({ 'updated-by': [CORRECTION] })
    for (const text of [
      'See 10.1234/example.2020.001c2.',
      'See 10.1234/example.2020.001c-2.',
      'See 10.1234/example.2020.001c.2.',
      'See x10.1234/example.2020.001c.',
      // The record's own DOI is a prefix of the notice DOI and says nothing of the notice.
      `Own DOI ${DOI}.`,
    ]) {
      expect(correctionNotices(withNotes(text), stored)).toEqual([NOTICE_C])
    }
  })

  it('does not take the word correction for a mention of the notice', () => {
    const stored = message({ 'updated-by': [CORRECTION] })
    expect(correctionNotices(withNotes('A correction was published in 2021.'), stored)).toEqual([
      NOTICE_C,
    ])
  })

  it('reports a retraction and an expression of concern with their types', () => {
    expect(correctionNotices(record, message({ 'updated-by': [RETRACTION, CONCERN] }))).toEqual([
      NOTICE_R,
      { doi: '10.1234/example.2020.001e', type: 'expression_of_concern', date: '2023-01-15' },
    ])
  })

  it('reports only the unmentioned one of two notices', () => {
    const stored = message({ 'updated-by': [CORRECTION, RETRACTION] })
    const one = withNotes('Correction 10.1234/example.2020.001c reviewed; results unaffected.')
    expect(correctionNotices(one, stored)).toEqual([NOTICE_R])
    const both = withNotes('Read 10.1234/example.2020.001c and 10.1234/example.2020.001r.')
    expect(correctionNotices(both, stored)).toEqual([])
  })

  it('always reports a notice that carries no DOI', () => {
    const stored = { 'updated-by': [{ type: 'retraction', updated: { 'date-parts': [[2022]] } }] }
    expect(correctionNotices(withNotes('Retraction noted.'), stored)).toEqual([
      { doi: null, type: 'retraction', date: '2022' },
    ])
  })

  it('changes neither the message nor the record', () => {
    const stored = message({ 'updated-by': [CORRECTION] })
    const before = JSON.stringify([record, stored])
    correctionNotices(record, stored)
    expect(JSON.stringify([record, stored])).toBe(before)
  })

  describe('with a malformed or incomplete message', () => {
    it.each([
      ['null', null],
      ['undefined', undefined],
      ['a string', 'not a message'],
      ['a number', 42],
      ['an array', [CORRECTION]],
      ['an empty object', {}],
      ['updated-by as a string', { 'updated-by': 'correction' }],
      ['updated-by as an object', { 'updated-by': CORRECTION }],
      ['updated-by with junk entries', { 'updated-by': [null, 5, 'x', [], {}] }],
      ['relation as a number', { relation: 5 }],
      ['relation is-updated-by as a string', { relation: { 'is-updated-by': 'x' } }],
      [
        'relation is-updated-by with junk',
        { relation: { 'is-updated-by': [null, 5, {}, { id: 7 }] } },
      ],
    ])('returns no notice for %s, and does not throw', (_label, stored) => {
      expect(() => correctionNotices(record, stored)).not.toThrow()
      expect(correctionNotices(record, stored)).toEqual([])
      expect(crossrefNotices(stored)).toEqual([])
    })

    it('keeps the usable fields of an entry whose other fields are malformed', () => {
      const stored = {
        'updated-by': [
          { DOI: 42, type: 'correction', updated: { 'date-parts': [[2021, 3, 9]] } },
          { DOI: '10.1234/x', type: ['correction'], updated: 'yesterday' },
          { DOI: '10.1234/y', type: 'erratum', updated: { 'date-parts': 'soon', 'date-time': 5 } },
          { DOI: '  ', type: '', updated: { 'date-parts': [[2021, 3, 9]] } },
        ],
      }
      expect(correctionNotices(record, stored)).toEqual([
        { doi: null, type: 'correction', date: '2021-03-09' },
        { doi: '10.1234/x', type: 'unknown', date: null },
        { doi: '10.1234/y', type: 'erratum', date: null },
      ])
    })
  })
})
