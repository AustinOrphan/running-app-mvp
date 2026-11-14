import { render } from '../../shared/copy/template.ts'
import { TEMPLATES } from '../../shared/copy/templates.ts'
import { WARNING_LEVELS, WARNING_SIGNS } from '../../shared/copy/warningSigns.ts'
import { PageHeader } from '../components/PageHeader.tsx'
import { shortCitation, useCorpus } from '../components/researchCorpus.ts'
import styles from './WarningSignsPage.module.css'

/** The words hold no quantity, so the units do not matter. */
const text = (id: keyof typeof TEMPLATES): string => render(TEMPLATES[id], {}, 'km')

/**
 * The Warning signs page (engine-rules section n): the signs that mean stop and call emergency
 * services, then those that mean stop and see a clinician. The words are static copy bundled with
 * the page, so it reads offline; only the short citations wait for the bundled research chunk, and
 * a sign shows without them when that chunk is missing.
 */
export function WarningSignsPage() {
  const papers = useCorpus().data?.papers
  const citation = (id: string): string => {
    const paper = papers?.get(id)
    return paper === undefined ? id : shortCitation(paper)
  }
  return (
    <>
      <PageHeader title={text('warning-signs.name')} context={text('warning-signs.note')} />
      <p className={styles.intro}>{text('warning-signs.intro')}</p>
      {WARNING_LEVELS.map((level) => {
        const headingId = `warning-${level.id}`
        return (
          <section
            key={level.id}
            aria-labelledby={headingId}
            className={`${styles.level} ${level.id === 'emergency' ? styles.emergency : styles.clinician}`}
          >
            <h2 id={headingId} className={styles.heading}>
              {text(level.heading)}
            </h2>
            <p className={styles.lead}>{text(level.lead)}</p>
            <ul className={styles.signs}>
              {WARNING_SIGNS.filter((sign) => sign.level === level.id).map((sign) => (
                <li key={sign.id} className={styles.sign}>
                  <h3 className={styles.title}>{text(sign.title)}</h3>
                  <p className={styles.detail}>{text(sign.detail)}</p>
                  <p className={styles.sources}>
                    <span className={styles.sourcesLabel}>
                      {text('warning-signs.sources-label')}:
                    </span>{' '}
                    {sign.sources.map(citation).join('; ')}
                  </p>
                </li>
              ))}
            </ul>
          </section>
        )
      })}
      <p className={styles.closing}>{text('warning-signs.closing')}</p>
    </>
  )
}
