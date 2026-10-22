import { useId } from 'react'
import { GradeBadge } from './GradeBadge.tsx'
import styles from './PaperCard.module.css'
import type { CorpusPaper } from './researchCorpus.ts'

export interface PaperCardProps {
  paper: CorpusPaper
  open: boolean
  onToggle: () => void
}

/** A paper as a title that opens to its design, findings, limitations and DOI link. */
export function PaperCard({ paper, open, onToggle }: PaperCardProps) {
  const panelId = useId()
  const doiUrl = paper.doi === null ? null : `https://doi.org/${paper.doi}`
  const authors = paper.authors.split(',')[0]?.trim() ?? paper.authors
  return (
    <div className={styles.card} id={`paper-${paper.id}`}>
      <button
        type="button"
        className={styles.toggle}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={onToggle}
      >
        <span className={styles.title}>{paper.title}</span>
        <span className={styles.meta}>
          {authors} et al. ({paper.year}), {paper.journal}
        </span>
      </button>
      {open ? (
        <div id={panelId} className={styles.panel}>
          <p className={styles.line}>
            <GradeBadge grade={paper.evidenceLevel} kind="level" /> <span>{paper.design}</span>
            {paper.sampleSize === null ? null : <span>, n = {paper.sampleSize}</span>}
          </p>
          <p className={styles.line}>{paper.population}</p>
          <p className={styles.label}>Findings</p>
          <ul className={styles.list}>
            {paper.findings.map((finding) => (
              <li key={finding}>{finding}</li>
            ))}
          </ul>
          <p className={styles.label}>Limitations</p>
          <p className={styles.line}>{paper.limitations}</p>
          {doiUrl === null ? (
            <p className={styles.line}>No DOI is recorded for this paper.</p>
          ) : (
            <p className={styles.line}>
              <a href={doiUrl} target="_blank" rel="noopener noreferrer">
                {`doi.org/${paper.doi ?? ''}`}
              </a>
            </p>
          )}
        </div>
      ) : null}
    </div>
  )
}
