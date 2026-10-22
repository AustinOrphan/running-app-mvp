import { useQuery } from '@tanstack/react-query'
import { useCallback, useState } from 'react'

/** One verified paper of `research/papers/*.json` (the schema is checked by `npm run research:check`). */
export interface CorpusPaper {
  id: string
  title: string
  authors: string
  year: number
  journal: string
  doi: string | null
  pmid: string | null
  url: string
  design: string
  population: string
  sampleSize: number | null
  evidenceLevel: 'A' | 'B' | 'C' | 'D'
  topics: string[]
  findings: string[]
  limitations: string
  implications: string[]
}

/** One rule of `research/rules/<topic>.json`. */
export interface CorpusRule {
  id: string
  statement: string
  parameter: string | null
  value: string | number | null
  unit: string | null
  appliesTo: string
  grade: 'A' | 'B' | 'C' | 'D'
  confidence: string
  evidence: string[]
}

export interface CorpusTopic {
  key: string
  title: string
  /** The synthesis markdown. */
  text: string
  rules: CorpusRule[]
  papers: CorpusPaper[]
}

export interface Corpus {
  topics: CorpusTopic[]
  papers: Map<string, CorpusPaper>
}

/** First `# ` heading of a topic file, or the key when there is none. */
function topicTitle(key: string, text: string): string {
  const heading = /^# (.+)$/m.exec(text)
  return heading?.[1]?.trim() ?? key
}

/** Loads and indexes the bundled research base. The chunk is fetched on first call only. */
export async function loadCorpus(): Promise<Corpus> {
  const { papers, rulesByTopic, topicTexts } = await import('./researchBundle.ts')
  const byId = new Map(papers.map((paper) => [paper.id, paper]))
  const topics = Object.entries(topicTexts)
    .map(([key, text]) => ({
      key,
      title: topicTitle(key, text),
      text,
      rules: rulesByTopic[key] ?? [],
      papers: papers
        .filter((paper) => paper.topics.includes(key))
        .sort((a, b) => b.year - a.year || a.title.localeCompare(b.title)),
    }))
    .sort((a, b) => a.title.localeCompare(b.title))
  return { topics, papers: byId }
}

/** The bundled corpus, loaded once per page load. */
export function useCorpus() {
  return useQuery({
    queryKey: ['research-corpus'],
    queryFn: loadCorpus,
    staleTime: Infinity,
    gcTime: Infinity,
  })
}

/** A set of ids with a toggle, for lists of papers that open one by one. */
export function useToggleSet(): [Set<string>, (id: string) => void, (id: string) => void] {
  const [ids, setIds] = useState<Set<string>>(() => new Set())
  const toggle = useCallback((id: string) => {
    setIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])
  const add = useCallback((id: string) => {
    setIds((prev) => new Set(prev).add(id))
  }, [])
  return [ids, toggle, add]
}

/** The first author of a Vancouver-style list: "de Jager E, Holden S" gives "de Jager E". */
export function firstAuthor(paper: CorpusPaper): string {
  return paper.authors.split(',')[0]?.trim() ?? paper.authors
}

/** "Bosquet 2007", "de Jager 2021": first author's surname (initials dropped) and year. */
export function shortCitation(paper: CorpusPaper): string {
  const surname = firstAuthor(paper).replace(/\s+[A-Z]{1,4}$/, '') || paper.id
  return `${surname} ${paper.year}`
}
