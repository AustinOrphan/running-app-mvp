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
//
// Crossref also lists notices against a work (`updated-by`: correction, erratum, expression of
// concern, retraction). After the summary line the run prints the notices that a paper's record
// does not mention. They are reported, not failures: the exit code does not depend on them.
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
  'updated-by'?: unknown
  relation?: unknown
}

function crossrefYears(work: CrossrefWork): number[] {
  return [work.issued, work['published-print'], work['published-online']]
    .map((part) => part?.['date-parts']?.[0]?.[0])
    .filter((year): year is number => typeof year === 'number')
}

/** One notice that Crossref lists against a work. */
export interface CorrectionNotice {
  /** The notice's own DOI; null when Crossref's entry carries none. */
  doi: string | null
  /** Crossref's update type (`correction`, `erratum`, `retraction`, ...); `unknown` when absent. */
  type: string
  /** `YYYY-MM-DD`, shorter when Crossref gives only a year or a month; null when absent. */
  date: string | null
}

function asObject(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null
}

/** The date of an `updated-by` entry: its `date-parts`, else the day of its `date-time`. */
function noticeDate(updated: unknown): string | null {
  const fields = asObject(updated)
  const parts: unknown = fields?.['date-parts']
  const first: unknown = Array.isArray(parts) ? (parts as unknown[])[0] : undefined
  if (Array.isArray(first)) {
    const numbers = (first as unknown[]).slice(0, 3)
    if (numbers.length > 0 && numbers.every((n) => Number.isInteger(n) && (n as number) > 0)) {
      return (numbers as number[])
        .map((n, index) => (index === 0 ? String(n) : String(n).padStart(2, '0')))
        .join('-')
    }
  }
  const day = /^\d{4}-\d{2}-\d{2}/.exec(nonEmptyString(fields?.['date-time']) ?? '')
  return day ? day[0] : null
}

/**
 * Every notice Crossref lists against a stored work message: the entries of `updated-by` (type,
 * date and DOI) and, as a fallback, the DOIs under `relation['is-updated-by']` (no type or date).
 * An entry in both is listed once, from `updated-by`. A missing or malformed field gives fewer
 * fields or fewer notices, never an exception. `update-to` is ignored: it names a work that the
 * message itself updates, not a notice about the message's work. Pure; no network.
 */
export function crossrefNotices(message: unknown): CorrectionNotice[] {
  const work = asObject(message)
  const notices: CorrectionNotice[] = []
  const seen = new Set<string>()
  const add = (notice: CorrectionNotice) => {
    if (notice.doi !== null) {
      const key = notice.doi.toLowerCase()
      if (seen.has(key)) return
      seen.add(key)
    }
    notices.push(notice)
  }

  const updatedBy: unknown = work?.['updated-by']
  for (const entry of Array.isArray(updatedBy) ? (updatedBy as unknown[]) : []) {
    const fields = asObject(entry)
    const doi = nonEmptyString(fields?.DOI)
    const type = nonEmptyString(fields?.type)
    // An entry with neither a DOI nor a type says nothing about a notice.
    if (fields && (doi || type)) {
      add({ doi, type: type ?? 'unknown', date: noticeDate(fields.updated) })
    }
  }

  const relation = asObject(work?.relation)
  const isUpdatedBy: unknown = relation?.['is-updated-by']
  for (const entry of Array.isArray(isUpdatedBy) ? (isUpdatedBy as unknown[]) : []) {
    const fields = asObject(entry)
    const doi = nonEmptyString(fields?.id)
    const idType = fields?.['id-type']
    if (doi && (idType === undefined || idType === 'doi')) add({ doi, type: 'unknown', date: null })
  }
  return notices
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * The notices Crossref lists against a work that its record does not mention. A record mentions a
 * notice when the notice's DOI appears anywhere in the record's text (`limitations`,
 * `verification.notes`, any field), compared without regard to case and not as part of a longer
 * DOI. The schema has no field for corrections, so the DOI text is the only signal; a record that
 * says "corrected" without the DOI does not count. A notice with no DOI cannot be matched and is
 * always reported. Pure; no network.
 */
export function correctionNotices(record: Paper, message: unknown): CorrectionNotice[] {
  const text = JSON.stringify(record)
  return crossrefNotices(message).filter((notice) => {
    if (notice.doi === null) return true
    const doi = escapeRegExp(notice.doi)
    return !new RegExp(`(?<![A-Za-z0-9])${doi}(?![A-Za-z0-9_-])(?!\\.[A-Za-z0-9])`, 'i').test(text)
  })
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

export interface PaperCheck {
  /** The mismatch to print, or null when the paper passes. */
  problem: string | null
  /** Notices Crossref lists against the work, all of them. */
  notices: CorrectionNotice[]
  /** The part of `notices` that the paper's record does not mention. */
  unmentioned: CorrectionNotice[]
}

export async function verifyPaper(paper: Paper): Promise<PaperCheck> {
  if (!paper.doi) return { problem: null, notices: [], unmentioned: [] }
  const { status, work } = await fetchWork(paper.doi)
  if (!work) {
    const problem = `${paper.id}: DOI ${paper.doi} did not resolve (HTTP ${String(status)})`
    return { problem, notices: [], unmentioned: [] }
  }
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
  return {
    problem: problems.length > 0 ? `${paper.id}: ${problems.join('; ')}` : null,
    notices: crossrefNotices(work),
    unmentioned: correctionNotices(paper, work),
  }
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
  const unmentioned: string[] = []
  let noticeCount = 0
  let checked = 0
  for (const paper of papers) {
    if (!paper.doi) {
      console.log(`${paper.id}: no DOI, skipped (${join('research/papers', `${paper.id}.json`)})`)
      continue
    }
    const { problem, notices, unmentioned: missing } = await verifyPaper(paper)
    checked += 1
    if (problem) {
      mismatches.push(problem)
      console.error(problem)
    }
    noticeCount += notices.length
    for (const notice of missing) {
      const doi = notice.doi ?? 'no DOI'
      unmentioned.push(
        `${paper.id}: ${notice.type} ${doi} (${notice.date ?? 'no date'}) is not mentioned in the record`,
      )
    }
    await sleep(PAUSE_MS)
  }
  console.log(
    `research:verify checked ${String(checked)} DOIs, ${String(mismatches.length)} mismatch(es)`,
  )
  console.log(
    `corrections: Crossref lists ${String(noticeCount)} notice(s); ${String(unmentioned.length)} not mentioned in the record`,
  )
  for (const line of unmentioned) console.log(line)
  if (mismatches.length > 0) process.exit(1)
}

if (process.argv[1]?.endsWith('research-verify.ts')) {
  main().catch((error: unknown) => {
    console.error(error)
    process.exit(1)
  })
}
