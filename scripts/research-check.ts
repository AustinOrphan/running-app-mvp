// Offline check of the research corpus (`npm run research:check`, part of `npm run check`).
//
// - every research/papers/*.json validates against the paper schema and its file name is its id;
// - every topic key used by a paper has a research/topics/<key>.md;
// - every paper id cited by research/rules/*.json, research/topics/*.md, research/engine-rules.md
//   and the parameter registry (shared/engine/params) exists as a paper.
//
// The tests in tests/unit/research import the functions below.
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { z } from 'zod'
import { allParams } from '../shared/engine/params/index.ts'

export const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url))
export const RESEARCH_DIR = join(REPO_ROOT, 'research')

const nullableString = z.string().min(1).nullable()

/** One research/papers/<id>.json. Strict: an unknown field is an error. */
export const paperSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'kebab-case ascii id'),
    title: z.string().min(1),
    authors: z.string().min(1),
    year: z.number().int().min(1900).max(2100),
    journal: z.string().min(1),
    doi: z
      .string()
      .regex(/^10\.\d{4,9}\/\S+$/, 'bare DOI')
      .nullable(),
    pmid: nullableString,
    url: z.string().url(),
    design: z.string().min(1),
    population: z.string().min(1),
    sampleSize: z.number().int().nonnegative().nullable(),
    evidenceLevel: z.enum(['A', 'B', 'C', 'D']),
    topics: z.array(z.string().min(1)).min(1),
    findings: z.array(z.string().min(1)).min(1),
    limitations: z.string().min(1),
    implications: z.array(z.string().min(1)).min(1),
    verification: z
      .object({
        doiResolved: z.boolean(),
        metadataMatches: z.boolean(),
        abstractSource: z.enum([
          'europepmc',
          'pubmed',
          'crossref',
          'publisher',
          'semanticscholar',
          'none',
        ]),
        findingsSupported: z.boolean(),
        notes: z.string(),
        checkedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      })
      .strict(),
  })
  .strict()

export type Paper = z.infer<typeof paperSchema>

/** A rule of research/rules/<topic>.json; only the fields the checks read are listed. */
export const topicRuleSchema = z
  .object({
    id: z.string().min(1),
    statement: z.string().min(1),
    grade: z.enum(['A', 'B', 'C', 'D']),
    evidence: z.array(z.string().min(1)),
  })
  .passthrough()

/**
 * A paper id looks like `author-year-keyword`: lowercase words joined by hyphens with a
 * four-digit year (19xx or 20xx) as a word of its own.
 */
const PAPER_ID = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*-(?:19|20)\d\d(?:-[a-z0-9]+)*$/

/**
 * Ids that topic syntheses cite but that are not papers: the id was renamed when duplicates were
 * merged while the corpus was written, and the synthesis text was not rewritten. They are
 * tolerated here, only in topics/, with the paper each most likely meant. A listed id that
 * starts to resolve, or is cited outside topics/, is an error, so the list cannot go stale.
 */
export const KNOWN_UNRESOLVED: Record<string, string> = {
  'blythe-2016-runner-performance-prediction':
    'topics/ai-coaching.md; renamed blythe-2016-individual-prediction in the merge',
  'emig-2020-running-big-data': 'topics/ai-coaching.md; renamed emig-2020-big-data in the merge',
}

export function loadPaperFiles(root = RESEARCH_DIR): Array<{ file: string; data: unknown }> {
  const dir = join(root, 'papers')
  return readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((file) => ({ file, data: JSON.parse(readFileSync(join(dir, file), 'utf8')) as unknown }))
}

export function topicKeys(root = RESEARCH_DIR): string[] {
  return readdirSync(join(root, 'topics'))
    .filter((name) => name.endsWith('.md'))
    .map((name) => name.replace(/\.md$/, ''))
    .sort()
}

/** Paper ids in a Markdown text: `[a, b]` brackets, and the cells of table rows. */
export function idsInMarkdown(text: string): string[] {
  const found = new Set<string>()
  for (const match of text.matchAll(/\[([^\]\n]+)\]/g)) {
    for (const token of (match[1] ?? '').split(/,\s*/)) {
      if (PAPER_ID.test(token.trim())) found.add(token.trim())
    }
  }
  for (const line of text.split('\n')) {
    if (!line.startsWith('|')) continue
    for (const cell of line.split('|')) {
      for (const token of cell.split(/,\s*/)) {
        const id = token.trim().replace(/\s*\(.*$/, '')
        if (PAPER_ID.test(id)) found.add(id)
      }
    }
  }
  return [...found].sort()
}

/** Where each paper id is cited: cited id -> list of places. */
export function citations(root = RESEARCH_DIR): Map<string, string[]> {
  const cited = new Map<string, string[]>()
  const add = (id: string, where: string) => {
    const list = cited.get(id) ?? []
    list.push(where)
    cited.set(id, list)
  }

  const rulesDir = join(root, 'rules')
  for (const file of readdirSync(rulesDir).filter((name) => name.endsWith('.json'))) {
    const rules = z
      .array(topicRuleSchema)
      .parse(JSON.parse(readFileSync(join(rulesDir, file), 'utf8')))
    for (const rule of rules) for (const id of rule.evidence) add(id, `rules/${file} ${rule.id}`)
  }
  for (const key of topicKeys(root)) {
    const text = readFileSync(join(root, 'topics', `${key}.md`), 'utf8')
    for (const id of idsInMarkdown(text)) add(id, `topics/${key}.md`)
  }
  for (const id of idsInMarkdown(readFileSync(join(root, 'engine-rules.md'), 'utf8'))) {
    add(id, 'engine-rules.md')
  }
  for (const p of allParams()) for (const id of p.evidence) add(id, `params ${p.id}`)
  return cited
}

export interface CorpusReport {
  papers: number
  citedIds: number
  errors: string[]
}

export function checkCorpus(root = RESEARCH_DIR): CorpusReport {
  const errors: string[] = []
  const known = new Set<string>()
  const doiOwner = new Map<string, string>()
  const topics = new Set(topicKeys(root))
  const files = loadPaperFiles(root)

  for (const { file, data } of files) {
    const parsed = paperSchema.safeParse(data)
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        errors.push(`papers/${file}: ${issue.path.join('.') || '(root)'} ${issue.message}`)
      }
      continue
    }
    const paper = parsed.data
    if (`${paper.id}.json` !== file)
      errors.push(`papers/${file}: id "${paper.id}" differs from the file name`)
    known.add(paper.id)
    for (const topic of paper.topics) {
      if (!topics.has(topic)) errors.push(`papers/${file}: unknown topic "${topic}"`)
    }
    if (paper.doi) {
      const owner = doiOwner.get(paper.doi)
      if (owner) errors.push(`papers/${file}: DOI ${paper.doi} is also the DOI of ${owner}`)
      else doiOwner.set(paper.doi, paper.id)
    }
  }

  const cited = citations(root)
  for (const [id, where] of cited) {
    if (known.has(id)) continue
    if (id in KNOWN_UNRESOLVED && where.every((place) => place.startsWith('topics/'))) continue
    errors.push(`cited id "${id}" is not in research/papers (${where.slice(0, 3).join('; ')})`)
  }
  for (const id of Object.keys(KNOWN_UNRESOLVED)) {
    if (known.has(id))
      errors.push(`KNOWN_UNRESOLVED lists "${id}", which is now a paper; remove it`)
    else if (!cited.has(id))
      errors.push(`KNOWN_UNRESOLVED lists "${id}", which nothing cites; remove it`)
  }
  return { papers: files.length, citedIds: cited.size, errors }
}

function main(): void {
  const report = checkCorpus()
  if (report.errors.length > 0) {
    for (const message of report.errors) console.error(message)
    console.error(`research:check failed with ${String(report.errors.length)} problem(s)`)
    process.exit(1)
  }
  console.log(
    `research:check ok: ${String(report.papers)} papers, ${String(report.citedIds)} cited ids all resolve`,
  )
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()
