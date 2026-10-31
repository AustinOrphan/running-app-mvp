import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import {
  BOOK_DESIGN,
  BOOK_FIELDS,
  checkCorpus,
  isValidIsbn,
  loadPaperFiles,
  paperSchema,
  PREDATES_RUBRIC,
  REPO_ROOT,
  vettingProblems,
  type Paper,
} from '../../../scripts/research-check.ts'

// Synthetic records. The optional fields of a book (edition, isbn, pagesRead, interests) and the
// `vetting` object are checked here without the corpus; the corpus-wide rule is checked on the
// stored records at the end. No test touches the network.

const passed = { result: 'pass', note: 'Read in the session.' } as const
const vetting = {
  r1: passed,
  r2: passed,
  r3: { result: 'hold', note: 'Only the 2nd edition was read.' },
  r4: { result: 'pass', note: 'A graded corpus paper agrees.' },
  r5: { result: 'n/a', note: 'No population claim is used.' },
  r6: passed,
  signedOff: 'owner, 2026-11-02',
} as const

const journal: Paper = {
  id: 'example-2020-topic',
  title: 'An example trial of a synthetic intervention',
  authors: 'Example A, Sample B',
  year: 2020,
  journal: 'Journal of Examples',
  doi: '10.1234/example.2020.001',
  pmid: null,
  url: 'https://doi.org/10.1234/example.2020.001',
  design: 'rct',
  population: 'Synthetic runners',
  sampleSize: null,
  evidenceLevel: 'B',
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

const book: Paper = {
  ...journal,
  id: 'sample-2022-example-book',
  title: 'An example coaching book',
  authors: 'Sample C',
  year: 2022,
  journal: 'Example Press',
  doi: null,
  url: 'https://example.com/books/example',
  design: BOOK_DESIGN,
  evidenceLevel: 'D',
  verification: { ...journal.verification, doiResolved: false, abstractSource: 'none' },
  edition: '4th edition',
  isbn: '978-0-306-40615-7',
  pagesRead: 'pp. 12-20, table 3.1',
  interests: 'The author sells training plans.',
  vetting,
}

function issues(data: unknown): string[] {
  const parsed = paperSchema.safeParse(data)
  return parsed.success ? [] : parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`)
}

/** A book record whose R1 and R2 results are the given ones. */
function withGates(id: string, r1: string, r2: string): Paper {
  const gates = { ...vetting, r1: { result: r1, note: 'x' }, r2: { result: r2, note: 'x' } }
  return { ...book, id, vetting: gates } as Paper
}

/** A book record with no `vetting`. */
function unvetted(id: string): Paper {
  const { vetting: gates, ...rest } = book
  expect(gates).toBeDefined()
  return { ...rest, id }
}

describe('book fields in paperSchema', () => {
  it('accepts a book record with every optional field', () => {
    expect(issues(book)).toEqual([])
  })

  it('accepts a book record and a journal record with none of them', () => {
    expect(issues(unvetted('sample-2022-bare'))).toEqual([])
    const { edition, isbn, pagesRead, interests, ...bare } = unvetted('sample-2022-bare')
    expect([edition, isbn, pagesRead, interests]).toHaveLength(4)
    expect(issues(bare)).toEqual([])
    expect(issues(journal)).toEqual([])
  })

  it('accepts vetting on a journal record', () => {
    expect(issues({ ...journal, vetting })).toEqual([])
  })

  it.each(BOOK_FIELDS)('rejects %s on a journal record', (field) => {
    const value = book[field]
    expect(value).toBeDefined()
    const found = issues({ ...journal, [field]: value })
    expect(found).toHaveLength(1)
    expect(found[0]).toContain(`${field}:`)
    expect(found[0]).toContain(BOOK_DESIGN)
  })

  it.each(BOOK_FIELDS)('rejects an empty %s on a book record', (field) => {
    expect(issues({ ...book, [field]: '' })).not.toEqual([])
  })

  it('rejects a field that is not one of the book fields', () => {
    expect(issues({ ...book, publisher: 'Example Press' })).not.toEqual([])
  })

  it('checks the ISBN: ten or thirteen digits, hyphens allowed, check digit right', () => {
    expect(isValidIsbn('978-0-306-40615-7')).toBe(true)
    expect(isValidIsbn('9780306406157')).toBe(true)
    expect(isValidIsbn('0-306-40615-2')).toBe(true)
    expect(isValidIsbn('080442957X')).toBe(true)
    expect(isValidIsbn('978-0-306-40615-6')).toBe(false)
    expect(isValidIsbn('0306406153')).toBe(false)
    expect(isValidIsbn('978030640615')).toBe(false)
    expect(isValidIsbn('isbn 9780306406157')).toBe(false)
    expect(issues({ ...book, isbn: '9780306406156' })).toHaveLength(1)
  })
})

describe('vetting in paperSchema', () => {
  it.each(['r1', 'r2', 'r3', 'r4', 'r5', 'r6'] as const)('requires %s', (gate) => {
    const { [gate]: removed, ...rest } = vetting
    expect(removed).toBeDefined()
    expect(issues({ ...book, vetting: rest })).not.toEqual([])
  })

  it('accepts pass, fail, hold and n/a, and nothing else', () => {
    for (const result of ['pass', 'fail', 'hold', 'n/a']) {
      expect(issues({ ...book, vetting: { ...vetting, r3: { result, note: 'x' } } })).toEqual([])
    }
    for (const result of ['yes', 'PASS', 'passed', '']) {
      expect(issues({ ...book, vetting: { ...vetting, r3: { result, note: 'x' } } })).not.toEqual(
        [],
      )
    }
  })

  it('requires a note for every gate', () => {
    expect(issues({ ...book, vetting: { ...vetting, r4: { result: 'pass' } } })).not.toEqual([])
    expect(
      issues({ ...book, vetting: { ...vetting, r4: { result: 'pass', note: '' } } }),
    ).not.toEqual([])
  })

  it('requires a sign-off that says who and names a date', () => {
    const { signedOff, ...unsigned } = vetting
    expect(signedOff).toBeDefined()
    expect(issues({ ...book, vetting: unsigned })).not.toEqual([])
    expect(issues({ ...book, vetting: { ...vetting, signedOff: '' } })).not.toEqual([])
    expect(issues({ ...book, vetting: { ...vetting, signedOff: 'owner' } })).not.toEqual([])
    expect(
      issues({ ...book, vetting: { ...vetting, signedOff: 'two reading passes, 2026-11-02' } }),
    ).toEqual([])
  })

  it('rejects an unknown key in vetting or in a gate', () => {
    expect(issues({ ...book, vetting: { ...vetting, r7: passed } })).not.toEqual([])
    expect(
      issues({ ...book, vetting: { ...vetting, r3: { ...passed, source: 'x' } } }),
    ).not.toEqual([])
  })
})

describe('the hard gates', () => {
  it('passes a book record with R1 and R2 pass, and a journal record without vetting', () => {
    expect(vettingProblems([book, journal], new Set())).toEqual([])
  })

  it('fails a book record with no vetting', () => {
    const problems = vettingProblems([unvetted('sample-2022-bare')], new Set())
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('sample-2022-bare')
    expect(problems[0]).toContain('R1 and R2')
  })

  it.each([
    ['fail', 'pass'],
    ['hold', 'pass'],
    ['n/a', 'pass'],
    ['pass', 'fail'],
    ['pass', 'hold'],
    ['pass', 'n/a'],
    ['fail', 'fail'],
  ])('fails a book record with R1 %s and R2 %s', (r1, r2) => {
    expect(vettingProblems([withGates('sample-2022-gates', r1, r2)], new Set())).toHaveLength(1)
  })

  it('does not ask a journal record for vetting, and reads only R1 and R2 of a book', () => {
    expect(vettingProblems([journal], new Set())).toEqual([])
    const lenient = { ...book, vetting: { ...vetting, r3: { result: 'fail', note: 'x' } } }
    expect(vettingProblems([lenient as Paper], new Set())).toEqual([])
  })

  it('exempts a listed record without passing gates, and keeps the list from going stale', () => {
    const listed = new Set(['sample-2022-bare'])
    expect(vettingProblems([unvetted('sample-2022-bare')], listed)).toEqual([])
    expect(vettingProblems([withGates('sample-2022-bare', 'fail', 'pass')], listed)).toEqual([])
    // R1 and R2 pass: the entry must go.
    expect(vettingProblems([{ ...book, id: 'sample-2022-bare' }], listed)).toHaveLength(1)
    // A listed id that is not a book record, or not a record at all, must go too.
    expect(vettingProblems([{ ...journal, id: 'sample-2022-bare' }], listed)).toHaveLength(1)
    expect(vettingProblems([], listed)).toHaveLength(1)
  })
})

describe('checkCorpus on a scratch tree', () => {
  const dir = mkdtempSync(join(tmpdir(), 'check-corpus-'))
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true })
  })
  for (const sub of ['papers', 'rules', 'topics']) mkdirSync(join(dir, sub))
  writeFileSync(join(dir, 'topics', 'example.md'), '# Example\n')
  writeFileSync(join(dir, 'rules', 'example.json'), '[]\n')
  writeFileSync(join(dir, 'engine-rules.md'), '')
  const write = (record: Paper) =>
    writeFileSync(join(dir, 'papers', `${record.id}.json`), JSON.stringify(record, null, 2))

  // The parameter registry is read from the repository, so a scratch tree reports its citations
  // as unresolved; only the errors about the papers are asserted.
  const paperErrors = () => checkCorpus(dir).errors.filter((e) => e.startsWith('papers/'))

  it('reports a book record without the hard gates, a book field on a journal record', () => {
    write(book)
    write(journal)
    expect(paperErrors()).toEqual([])
    write(unvetted('sample-2022-bare'))
    write({ ...journal, id: 'example-2021-other', doi: null, isbn: '9780306406157' })
    expect(paperErrors()).toEqual([
      expect.stringContaining('example-2021-other.json: isbn is only allowed on book-or-guideline'),
      expect.stringContaining('sample-2022-bare.json: a book-or-guideline record needs vetting'),
    ])
  })
})

describe('the stored corpus', () => {
  const papers = loadPaperFiles().map(({ data }) => paperSchema.parse(data))

  it('has no problem with the book fields or the hard gates', () => {
    expect(checkCorpus().errors).toEqual([])
    expect(vettingProblems(papers)).toEqual([])
  })

  it('lists exactly the book records that do not pass R1 and R2 yet', () => {
    const open = papers
      .filter((p) => p.design === BOOK_DESIGN)
      .filter((p) => p.vetting?.r1.result !== 'pass' || p.vetting.r2.result !== 'pass')
      .map((p) => p.id)
      .sort()
    expect([...PREDATES_RUBRIC].sort()).toEqual(open)
  })

  it('carries no book field outside a book record', () => {
    for (const paper of papers.filter((p) => p.design !== BOOK_DESIGN)) {
      for (const field of BOOK_FIELDS) expect(paper[field], paper.id).toBeUndefined()
    }
  })
})

describe('write-corpus.mjs', () => {
  const dir = mkdtempSync(join(tmpdir(), 'write-corpus-'))
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  // The writer finds its research/ directory from its own location, so the test runs a copy of it
  // inside a scratch tree.
  const tools = join(dir, 'research', 'tools')
  mkdirSync(tools, { recursive: true })
  mkdirSync(join(dir, 'research', 'papers'), { recursive: true })
  copyFileSync(join(REPO_ROOT, 'research/tools/write-corpus.mjs'), join(tools, 'write-corpus.mjs'))

  const run = (result: unknown): void => {
    const resultPath = join(dir, 'result.json')
    writeFileSync(resultPath, JSON.stringify(result))
    execFileSync(process.execPath, [join(tools, 'write-corpus.mjs'), resultPath], {
      cwd: dir,
      stdio: 'pipe',
    })
  }
  const paperPath = (id: string) => join(dir, 'research', 'papers', `${id}.json`)
  const asFile = (record: Paper) => JSON.stringify(record, null, 2) + '\n'

  it('rewrites stored records without dropping or adding a field', () => {
    for (const record of [book, journal]) writeFileSync(paperPath(record.id), asFile(record))
    run({ topics: [], missing: [], engineRules: '' })
    for (const record of [book, journal]) {
      expect(readFileSync(paperPath(record.id), 'utf8')).toBe(asFile(record))
    }
  })

  it('writes the optional fields of a new record from a workflow result', () => {
    const { id, topics, ...rest } = { ...book, id: 'sample-2023-new-book' }
    expect(topics).toEqual(['example'])
    const topic = { key: 'example', title: 'Example', synthesis: 'Text.', rules: [], gaps: [] }
    run({
      topics: [{ ...topic, papers: [{ id, ...rest }] }],
      missing: [],
      engineRules: '',
    })
    const written = JSON.parse(readFileSync(paperPath(id), 'utf8')) as Paper
    expect(paperSchema.safeParse(written).success).toBe(true)
    expect(written.edition).toBe(book.edition)
    expect(written.isbn).toBe(book.isbn)
    expect(written.pagesRead).toBe(book.pagesRead)
    expect(written.interests).toBe(book.interests)
    expect(written.vetting).toEqual(book.vetting)
  })
})
