import { Fragment, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { EmptyState } from '../components/EmptyState.tsx'
import { GradeBadge } from '../components/GradeBadge.tsx'
import { PageHeader } from '../components/PageHeader.tsx'
import { PaperCard } from '../components/PaperCard.tsx'
import { Segmented } from '../components/Segmented.tsx'
import { Skeleton } from '../components/Skeleton.tsx'
import {
  shortCitation,
  useCorpus,
  useToggleSet,
  type Corpus,
  type CorpusRule,
  type CorpusTopic,
} from '../components/researchCorpus.ts'
import styles from './ResearchPage.module.css'

type GradeFilter = 'all' | 'A' | 'B' | 'C' | 'D'

const gradeOptions: Array<{ value: GradeFilter; label: string }> = [
  { value: 'all', label: 'All grades' },
  { value: 'A', label: 'Grade A' },
  { value: 'B', label: 'Grade B' },
  { value: 'C', label: 'Grade C' },
  { value: 'D', label: 'Grade D' },
]

/** Sections of a topic file that the page shows from the structured data instead. */
const STRUCTURED_SECTIONS = new Set(['Rules', 'Papers'])

interface ListBlock {
  kind: 'ul' | 'ol'
  items: string[]
}

type Block = { kind: 'h2' | 'h3'; text: string } | { kind: 'p'; text: string } | ListBlock

/** The few markdown forms the topic files use: headings, lists and paragraphs. Tables are dropped. */
function parseTopic(text: string): Block[] {
  const blocks: Block[] = []
  const open: { skipping: boolean; list: ListBlock | null; paragraph: string[] } = {
    skipping: false,
    list: null,
    paragraph: [],
  }
  const flush = () => {
    if (open.list && !open.skipping) blocks.push(open.list)
    open.list = null
    if (open.paragraph.length > 0 && !open.skipping) {
      blocks.push({ kind: 'p', text: open.paragraph.join(' ') })
    }
    open.paragraph = []
  }
  for (const line of text.split('\n')) {
    const heading = /^(#{1,3}) (.+)$/.exec(line)
    const bullet = /^[-*] (.+)$/.exec(line)
    const numbered = /^\d+\. (.+)$/.exec(line)
    if (heading) {
      flush()
      const title = heading[2]?.trim() ?? ''
      if (heading[1] === '##') open.skipping = STRUCTURED_SECTIONS.has(title)
      if (heading[1] === '##' && !open.skipping) blocks.push({ kind: 'h2', text: title })
      if (heading[1] === '###' && !open.skipping) blocks.push({ kind: 'h3', text: title })
    } else if (bullet || numbered) {
      const kind = bullet ? 'ul' : 'ol'
      const item = (bullet ?? numbered)?.[1] ?? ''
      if (open.list?.kind !== kind) {
        flush()
        open.list = { kind, items: [] }
      }
      open.list.items.push(item)
    } else if (line.trim() === '') {
      flush()
    } else if (!line.startsWith('|')) {
      if (open.list && /^\s+/.test(line)) {
        open.list.items.push(`${open.list.items.pop() ?? ''} ${line.trim()}`)
      } else {
        flush()
        open.paragraph.push(line.trim())
      }
    }
  }
  flush()
  return blocks
}

const INLINE = /(\*\*[^*]+\*\*|`[^`]+`|\[[a-z0-9-]+(?:, ?[a-z0-9-]+)*\])/

interface CiteProps {
  corpus: Corpus
  onCite: (id: string) => void
}

function Citations({ ids, corpus, onCite }: CiteProps & { ids: string[] }) {
  return (
    <>
      {ids.map((id, index) => {
        const paper = corpus.papers.get(id)
        return (
          <Fragment key={id}>
            {index > 0 ? ', ' : null}
            {paper ? (
              <button
                type="button"
                className={styles.cite}
                onClick={() => {
                  onCite(id)
                }}
              >
                {shortCitation(paper)}
              </button>
            ) : (
              <span className={styles.unresolved}>{id}</span>
            )}
          </Fragment>
        )
      })}
    </>
  )
}

function Inline({ text, corpus, onCite }: CiteProps & { text: string }) {
  const parts = text.split(INLINE)
  return (
    <>
      {parts.map((part, index) => {
        if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
          return <strong key={index}>{part.slice(2, -2)}</strong>
        }
        if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
          return <code key={index}>{part.slice(1, -1)}</code>
        }
        if (part.startsWith('[') && part.endsWith(']')) {
          const ids = part.slice(1, -1).split(/, ?/)
          if (ids.every((id) => corpus.papers.has(id))) {
            return (
              <Fragment key={index}>
                (<Citations ids={ids} corpus={corpus} onCite={onCite} />)
              </Fragment>
            )
          }
        }
        return <Fragment key={index}>{part}</Fragment>
      })}
    </>
  )
}

function RuleCard({ rule, corpus, onCite }: CiteProps & { rule: CorpusRule }) {
  const value =
    rule.value === null ? null : `${String(rule.value)}${rule.unit ? ` ${rule.unit}` : ''}`
  return (
    <article className={styles.rule} aria-label={rule.id}>
      <div className={styles.ruleHead}>
        <span className={styles.ruleId}>{rule.id}</span>
        <GradeBadge grade={rule.grade} />
      </div>
      <p className={styles.statement}>{rule.statement}</p>
      <dl className={styles.facts}>
        {value === null ? null : (
          <div>
            <dt>Value</dt>
            <dd>{value}</dd>
          </div>
        )}
        <div>
          <dt>Applies to</dt>
          <dd>{rule.appliesTo}</dd>
        </div>
        <div>
          <dt>Confidence</dt>
          <dd>{rule.confidence}</dd>
        </div>
        <div>
          <dt>Papers</dt>
          <dd>
            <Citations ids={rule.evidence} corpus={corpus} onCite={onCite} />
          </dd>
        </div>
      </dl>
      {rule.grade === 'D' ? (
        <p className={styles.default}>A default chosen for caution, not a finding.</p>
      ) : null}
    </article>
  )
}

function TopicView({
  topic,
  corpus,
  filter,
}: {
  topic: CorpusTopic
  corpus: Corpus
  filter: GradeFilter
}) {
  const [openPapers, togglePaper, openPaper] = useToggleSet()
  const [scrollTo, setScrollTo] = useState<{ id: string } | null>(null)
  const blocks = useMemo(() => parseTopic(topic.text), [topic.text])
  const rules = topic.rules.filter((rule) => filter === 'all' || rule.grade === filter)

  // Papers of this topic, plus any other paper that its text or rules cite.
  const papers = useMemo(() => {
    const list = [...topic.papers]
    const have = new Set(list.map((paper) => paper.id))
    const cited = [
      ...[...topic.text.matchAll(/[a-z]+-\d{4}-[a-z0-9-]+/g)].map((match) => match[0]),
      ...topic.rules.flatMap((rule) => rule.evidence),
    ]
    for (const id of cited) {
      const paper = corpus.papers.get(id)
      if (paper && !have.has(id)) {
        have.add(id)
        list.push(paper)
      }
    }
    return list
  }, [topic, corpus])

  useEffect(() => {
    if (scrollTo === null) return
    const el = document.getElementById(`paper-${scrollTo.id}`)
    if (el && typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'center' })
  }, [scrollTo])

  function onCite(id: string) {
    openPaper(id)
    setScrollTo({ id })
  }

  return (
    <div className={styles.topic}>
      <h2 className={styles.topicTitle}>{topic.title}</h2>
      <section aria-labelledby="topic-summary" className={styles.prose}>
        <h3 id="topic-summary" className={styles.sectionTitle}>
          What the research says
        </h3>
        {blocks.map((block, index) => {
          switch (block.kind) {
            case 'h2':
              return <h3 key={index}>{block.text}</h3>
            case 'h3':
              return <h4 key={index}>{block.text}</h4>
            case 'p':
              return (
                <p key={index}>
                  <Inline text={block.text} corpus={corpus} onCite={onCite} />
                </p>
              )
            case 'ul':
            case 'ol': {
              const Tag = block.kind
              return (
                <Tag key={index}>
                  {block.items.map((item) => (
                    <li key={item}>
                      <Inline text={item} corpus={corpus} onCite={onCite} />
                    </li>
                  ))}
                </Tag>
              )
            }
          }
        })}
      </section>

      <section aria-labelledby="topic-rules">
        <h3 id="topic-rules" className={styles.sectionTitle}>
          Rules
        </h3>
        <p className={styles.count}>
          {rules.length === topic.rules.length
            ? `${topic.rules.length} rules`
            : `${rules.length} of ${topic.rules.length} rules`}
        </p>
        {rules.length === 0 ? (
          <EmptyState title="No rule of this topic has that grade." />
        ) : (
          rules.map((rule) => (
            <RuleCard key={rule.id} rule={rule} corpus={corpus} onCite={onCite} />
          ))
        )}
      </section>

      <section aria-labelledby="topic-papers">
        <h3 id="topic-papers" className={styles.sectionTitle}>
          Papers
        </h3>
        <p className={styles.count}>{papers.length} papers</p>
        {papers.map((paper) => (
          <PaperCard
            key={paper.id}
            paper={paper}
            open={openPapers.has(paper.id)}
            onToggle={() => {
              togglePaper(paper.id)
            }}
          />
        ))}
      </section>
    </div>
  )
}

function Legend() {
  return (
    <dl className={styles.legend}>
      <div>
        <dt>Grade A</dt>
        <dd>consistent meta-analyses or consensus statements</dd>
      </div>
      <div>
        <dt>Grade B</dt>
        <dd>randomised trials or large prospective cohorts</dd>
      </div>
      <div>
        <dt>Grade C</dt>
        <dd>small trials, observational data, or a reasonable extrapolation</dd>
      </div>
      <div>
        <dt>Grade D</dt>
        <dd>a default chosen for caution; no direct evidence</dd>
      </div>
    </dl>
  )
}

/** Topics, rules with grade badges, and papers with findings and DOI links. */
export function ResearchPage() {
  const corpus = useCorpus()
  const [params, setParams] = useSearchParams()
  const [filter, setFilter] = useState<GradeFilter>('all')
  const key = params.get('topic')
  const topic = corpus.data?.topics.find((t) => t.key === key) ?? null

  let body: ReactNode
  if (corpus.isPending) {
    body = <Skeleton />
  } else if (corpus.isError) {
    body = (
      <EmptyState
        title="The research base could not be loaded."
        body="Reload the page to try again."
      />
    )
  } else if (topic) {
    body = (
      <>
        <button
          type="button"
          className={styles.back}
          onClick={() => {
            setParams({})
          }}
        >
          All topics
        </button>
        <TopicView key={topic.key} topic={topic} corpus={corpus.data} filter={filter} />
      </>
    )
  } else {
    body = (
      <ul className={styles.topics}>
        {corpus.data.topics.map((t) => {
          const count = t.rules.filter((rule) => filter === 'all' || rule.grade === filter).length
          return (
            <li key={t.key}>
              <button
                type="button"
                className={styles.topicButton}
                onClick={() => {
                  setParams({ topic: t.key })
                }}
              >
                <span className={styles.topicName}>{t.title}</span>
                <span className={styles.topicMeta}>
                  {count} rules, {t.papers.length} papers
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    )
  }

  return (
    <>
      <PageHeader title="Research" context="The papers and rules behind the plan" />
      <p className={styles.intro}>
        Every rule in the plan comes from published research, and each carries a grade for how
        strong its support is. This is decision support for one runner, not medical advice.
      </p>
      <Legend />
      <div className={styles.filter}>
        <Segmented label="Rule grade" options={gradeOptions} value={filter} onChange={setFilter} />
      </div>
      {body}
    </>
  )
}
