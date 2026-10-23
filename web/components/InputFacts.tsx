import { useId } from 'react'
import { Link } from 'react-router-dom'
import { EXPLAIN_MAX_SOURCES } from '../../shared/copy/limits.ts'
import { render } from '../../shared/copy/template.ts'
import { renderFact, TEMPLATES } from '../../shared/copy/templates.ts'
import type { InputFact, SourceRef } from '../../shared/engine/types.ts'
import type { Units } from '../../shared/types.ts'
import styles from './InputFacts.module.css'

export interface InputFactsProps {
  facts: InputFact[]
  units: Units
  /** A source link was followed: the drawer closes, because the page behind it changes. */
  onNavigate: () => void
}

/**
 * Where a source lives in the app, or null when no page shows it. An activity opens its own page.
 * The other records are shown where the runner keeps them: check-ins on Today (a past day has no
 * page of its own), the profile and its screening on Profile, a planned session on the plan and a
 * weekly review on Review. A day's wellness values and a rest window have no page.
 */
export function sourceHref(source: Pick<SourceRef, 'kind' | 'id'>): string | null {
  switch (source.kind) {
    case 'activity':
      return `/activities/${encodeURIComponent(source.id)}`
    case 'check-in':
      return '/'
    case 'profile':
    case 'screening':
      return '/profile'
    case 'session':
      return '/plan'
    case 'review':
      return '/review'
    case 'wellness':
    case 'disruption':
      return null
  }
}

/** "Run, 12.9 km, Mon 19 Oct": the record, its distance when it has one, and its day. */
function sourceText(source: SourceRef, units: Units): string {
  const date = { kind: 'date', iso: source.date, style: 'weekday' } as const
  if (source.kind === 'activity' && source.distanceM !== undefined) {
    const distance = { kind: 'distance', m: source.distanceM } as const
    return render(TEMPLATES['why.source-activity'], { label: source.label, distance, date }, units)
  }
  return render(TEMPLATES['why.source-dated'], { label: source.label, date }, units)
}

function Sources({
  fact,
  units,
  onNavigate,
}: {
  fact: InputFact
  units: Units
  onNavigate: () => void
}) {
  const labelId = useId()
  // The server lists at most EXPLAIN_MAX_SOURCES; the page holds the cap too, and counts what it
  // leaves out with what the server did.
  const shown = fact.sources.slice(0, EXPLAIN_MAX_SOURCES)
  const more = fact.moreSources + (fact.sources.length - shown.length)
  if (shown.length === 0) return null
  return (
    <div className={styles.based}>
      <p id={labelId} className={styles.basedLabel}>
        {render(TEMPLATES['why.based-on'], {}, units)}
      </p>
      <ul aria-labelledby={labelId} className={styles.sources}>
        {shown.map((source) => {
          const href = sourceHref(source)
          const text = sourceText(source, units)
          return (
            <li key={`${source.kind}:${source.id}`}>
              {href === null ? (
                text
              ) : (
                <Link to={href} onClick={onNavigate}>
                  {text}
                </Link>
              )}
            </li>
          )
        })}
        {more > 0 ? (
          <li className={styles.more}>
            {render(TEMPLATES['why.more-sources'], { n: { kind: 'count', n: more } }, units)}
          </li>
        ) : null}
      </ul>
    </div>
  )
}

/**
 * The figures one rule read, as sentences in the runner's units (`renderFact`), each with the
 * records it rests on. A figure the rule could not compute says what is missing, behind a
 * "Not enough data yet:" label.
 */
export function InputFacts({ facts, units, onNavigate }: InputFactsProps) {
  return (
    <ul className={styles.list}>
      {facts.map((fact) => (
        <li key={fact.id} className={styles.fact}>
          <p className={styles.sentence}>
            {fact.state === 'insufficient' ? (
              <>
                <span className={styles.gapLabel}>
                  {render(TEMPLATES['why.not-enough'], {}, units)}
                </span>{' '}
              </>
            ) : null}
            {renderFact(fact, units)}
          </p>
          <Sources fact={fact} units={units} onNavigate={onNavigate} />
        </li>
      ))}
    </ul>
  )
}
