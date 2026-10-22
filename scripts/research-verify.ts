// Online check of every DOI in research/papers against Crossref (`npm run research:verify`).
// Not part of CI: it makes one request per paper, one at a time.
//
//   npm run research:verify                 check all papers
//   npm run research:verify -- <id> [<id>]  check only these paper ids
//
// A paper passes when the DOI resolves, at least 60% of the shorter title's words appear in the
// other title, and the Crossref year is within one year of the stored year. Mismatches are
// printed; the exit code is 1 when any paper fails. Fix a mismatch by correcting the paper
// file (or removing the paper and every citation of it), then rerun.
import { join } from 'node:path'
import { loadPaperFiles, paperSchema, RESEARCH_DIR, type Paper } from './research-check.ts'

const API = 'https://api.crossref.org/works/'
const MIN_OVERLAP = 0.6
const MAX_YEAR_DIFF = 1
const PAUSE_MS = 250

export function titleTokens(title: string): Set<string> {
  const text = title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
  return new Set(text.split(' ').filter((word) => word.length > 2))
}

/** Share of the shorter title's tokens that the other title also has. */
export function titleOverlap(a: string, b: string): number {
  const left = titleTokens(a)
  const right = titleTokens(b)
  const smaller = left.size <= right.size ? left : right
  const larger = smaller === left ? right : left
  if (smaller.size === 0) return 0
  let shared = 0
  for (const token of smaller) if (larger.has(token)) shared += 1
  return shared / smaller.size
}

interface CrossrefWork {
  title?: string[]
  issued?: { 'date-parts'?: number[][] }
  'published-print'?: { 'date-parts'?: number[][] }
  'published-online'?: { 'date-parts'?: number[][] }
}

function crossrefYears(work: CrossrefWork): number[] {
  return [work.issued, work['published-print'], work['published-online']]
    .map((part) => part?.['date-parts']?.[0]?.[0])
    .filter((year): year is number => typeof year === 'number')
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

async function fetchWork(doi: string): Promise<{ status: number; work: CrossrefWork | null }> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await fetch(`${API}${encodeURIComponent(doi).replace(/%2F/g, '/')}`, {
      headers: { 'User-Agent': 'running-log research:verify (self-hosted training log)' },
    })
    if (response.status === 429 || response.status >= 500) {
      await sleep(2000 * (attempt + 1))
      continue
    }
    if (!response.ok) return { status: response.status, work: null }
    const body = (await response.json()) as { message?: CrossrefWork }
    return { status: response.status, work: body.message ?? null }
  }
  return { status: 0, work: null }
}

export async function verifyPaper(paper: Paper): Promise<string | null> {
  if (!paper.doi) return null
  const { status, work } = await fetchWork(paper.doi)
  if (!work) return `${paper.id}: DOI ${paper.doi} did not resolve (HTTP ${String(status)})`
  const title = work.title?.[0] ?? ''
  const overlap = titleOverlap(paper.title, title)
  const years = crossrefYears(work)
  const problems: string[] = []
  if (overlap < MIN_OVERLAP) {
    problems.push(
      `title overlap ${overlap.toFixed(2)} below ${String(MIN_OVERLAP)} (Crossref: "${title}")`,
    )
  }
  if (years.length > 0 && !years.some((year) => Math.abs(year - paper.year) <= MAX_YEAR_DIFF)) {
    problems.push(`year ${String(paper.year)} against Crossref ${years.join('/')}`)
  }
  return problems.length > 0 ? `${paper.id}: ${problems.join('; ')}` : null
}

async function main(): Promise<void> {
  const only = new Set(process.argv.slice(2))
  const papers = loadPaperFiles(RESEARCH_DIR).flatMap(({ file, data }) => {
    const parsed = paperSchema.safeParse(data)
    if (!parsed.success) {
      console.error(`papers/${file}: fails the schema; run npm run research:check first`)
      process.exit(1)
    }
    return only.size === 0 || only.has(parsed.data.id) ? [parsed.data] : []
  })

  const mismatches: string[] = []
  let checked = 0
  for (const paper of papers) {
    if (!paper.doi) {
      console.log(`${paper.id}: no DOI, skipped (${join('research/papers', `${paper.id}.json`)})`)
      continue
    }
    const problem = await verifyPaper(paper)
    checked += 1
    if (problem) {
      mismatches.push(problem)
      console.error(problem)
    }
    await sleep(PAUSE_MS)
  }
  console.log(
    `research:verify checked ${String(checked)} DOIs, ${String(mismatches.length)} mismatch(es)`,
  )
  if (mismatches.length > 0) process.exit(1)
}

if (process.argv[1]?.endsWith('research-verify.ts')) {
  main().catch((error: unknown) => {
    console.error(error)
    process.exit(1)
  })
}
