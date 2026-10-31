import { useId } from 'react'
import { GradeBadge } from './GradeBadge.tsx'
import styles from './PaperCard.module.css'
import { firstAuthor, type CorpusPaper } from './researchCorpus.ts'

export interface PaperCardProps {
  paper: CorpusPaper
  open: boolean
  onToggle: () => void
}

/**
 * The page a record points to, as a link labelled with its host name. Null for a URL that is not
 * http or https, and for the record's own DOI link when the DOI is shown on its own.
 */
function sourcePage(paper: CorpusPaper): { href: string; label: string } | null {
  let parsed: URL
  try {
    parsed = new URL(paper.url)
  } catch {
    return null
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null
  const host = parsed.host.replace(/^www\./, '')
  if (paper.doi !== null && (host === 'doi.org' || host === 'dx.doi.org')) return null
  return { href: paper.url, label: host }
}

/** A paper as a title that opens to its design, findings, limitations and links. */
export function PaperCard({ paper, open, onToggle }: PaperCardProps) {
  const panelId = useId()
  const doiUrl = paper.doi === null ? null : `https://doi.org/${paper.doi}`
  const page = sourcePage(paper)
  // A single author gets no "et al."; a list (even one ending "et al.") shows its first name.
  const authors = paper.authors.includes(',') ? `${firstAuthor(paper)} et al.` : paper.authors
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
          {authors} ({paper.year}), {paper.journal}
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
          {paper.edition === undefined ? null : (
            <p className={styles.line}>Edition: {paper.edition}</p>
          )}
          {paper.pagesRead === undefined ? null : (
            <p className={styles.line}>Pages read: {paper.pagesRead}</p>
          )}
          {paper.interests === undefined ? null : (
            <p className={styles.line}>Interests: {paper.interests}</p>
          )}
          {paper.vetting === undefined ? null : (
            <p className={styles.line}>Signed off: {paper.vetting.signedOff}</p>
          )}
          {doiUrl === null ? (
            <p className={styles.line}>No DOI is recorded for this paper.</p>
          ) : (
            <p className={styles.line}>
              <a href={doiUrl} target="_blank" rel="noopener noreferrer">
                {`doi.org/${paper.doi ?? ''}`}
              </a>
            </p>
          )}
          {page === null ? null : (
            <p className={styles.line}>
              <a href={page.href} target="_blank" rel="noopener noreferrer">
                {page.label}
              </a>
            </p>
          )}
        </div>
      ) : null}
    </div>
  )
}
