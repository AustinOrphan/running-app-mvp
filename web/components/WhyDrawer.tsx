import type { Param } from '../../shared/engine/types.ts'
import { useResearchParams } from '../api/research.ts'
import { GradeBadge } from './GradeBadge.tsx'
import { PaperCard } from './PaperCard.tsx'
import { Sheet } from './Sheet.tsx'
import { RATING_WHY_NOTE } from './engineText.ts'
import { ruleTitle } from './ruleTitles.ts'
import styles from './WhyDrawer.module.css'
import { useCorpus, useToggleSet } from './researchCorpus.ts'

export interface WhyDrawerProps {
  /** Rule ids such as `g-1`, resolved to parameters, grades and papers. */
  rules: string[]
  open: boolean
  onClose: () => void
}

/** Same matching as `explain()`: case and hyphens do not matter. */
function ruleKey(id: string): string {
  return id.toLowerCase().replace(/-/g, '')
}

function formatScalar(value: unknown): string {
  if (Array.isArray(value)) return value.map(formatScalar).join(', ')
  if (typeof value === 'object' && value !== null) return JSON.stringify(value)
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return ''
}

/** The parameter's value with its unit, and its range when it has one. */
function describeParam(param: Param<unknown>): Array<{ label: string; text: string }> {
  const unit = param.unit === undefined ? '' : ` ${param.unit}`
  const rows = [{ label: 'Value', text: `${formatScalar(param.value)}${unit}` }]
  if (param.range) {
    rows.push({
      label: 'Range',
      text: `${formatScalar(param.range[0])} to ${formatScalar(param.range[1])}${unit}`,
    })
  }
  return rows
}

/** "k1.weeklyMultipliers" as "Weekly multipliers", for a parameter that has no note. */
function paramLabel(id: string): string {
  const last = id.split('.').pop() ?? id
  const words = last.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

function ParamRow({ param }: { param: Param<unknown> }) {
  return (
    <div className={styles.param}>
      <p className={styles.sentence}>{param.note ?? paramLabel(param.id)}</p>
      <dl className={styles.facts}>
        {describeParam(param).map((row) => (
          <div key={row.label} className={styles.fact}>
            <dt>{row.label}</dt>
            <dd>{row.text}</dd>
          </div>
        ))}
      </dl>
      <div className={styles.paramHead}>
        <GradeBadge grade={param.grade} />
        {param.grade === 'D' ? (
          <span className={styles.defaultTag}>Default (no direct study)</span>
        ) : null}
      </div>
    </div>
  )
}

function DrawerBody({ rules }: { rules: string[] }) {
  const registry = useResearchParams()
  const corpus = useCorpus()
  const [openPapers, togglePaper] = useToggleSet()

  if (registry.isPending) return <p className={styles.status}>Loading the evidence.</p>
  if (registry.isError) {
    return (
      <p role="alert" className={styles.status}>
        The parameter registry could not be loaded. Close this panel and open it again to retry.
      </p>
    )
  }

  const params = registry.data.params
  const seen = new Set<string>()
  const uniqueRules = rules.filter((rule) => {
    const key = ruleKey(rule)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  return (
    <>
      <p className={styles.intro}>
        Every number in the plan has a rule behind it. Grade A is the strongest evidence; grade D is
        a conservative default.
      </p>
      {uniqueRules.map((rule) => {
        const matched = params.filter((p) => ruleKey(p.rule) === ruleKey(rule))
        const paperIds = [...new Set(matched.flatMap((p) => p.evidence))].sort()
        const title = ruleTitle(rule)
        return (
          <section key={rule} className={styles.rule} aria-label={title ?? `Rule ${rule}`}>
            <h3 className={styles.ruleTitle}>{title ?? `Rule ${rule}`}</h3>
            {matched.some((param) => param.id.startsWith('effort.')) ? (
              <p className={styles.note}>{RATING_WHY_NOTE}</p>
            ) : null}
            {matched.length === 0 ? (
              <p className={styles.note}>No parameter is recorded for {title ?? rule}.</p>
            ) : (
              matched.map((param) => <ParamRow key={param.id} param={param} />)
            )}
            {paperIds.length > 0 ? (
              <div className={styles.papers}>
                <p className={styles.paperHeading}>Papers</p>
                {corpus.isPending ? <p className={styles.note}>Loading papers.</p> : null}
                {corpus.isError ? (
                  <p role="alert" className={styles.note}>
                    The research base could not be loaded. Papers: {paperIds.join(', ')}.
                  </p>
                ) : null}
                {corpus.data
                  ? paperIds.map((id) => {
                      const paper = corpus.data.papers.get(id)
                      return paper ? (
                        <PaperCard
                          key={id}
                          paper={paper}
                          open={openPapers.has(id)}
                          onToggle={() => {
                            togglePaper(id)
                          }}
                        />
                      ) : (
                        <p key={id} className={styles.note}>
                          {id} is not in the bundled research base.
                        </p>
                      )
                    })
                  : null}
              </div>
            ) : null}
          </section>
        )
      })}
      <p className={styles.footnote}>
        Decision support for one runner, not medical advice. Stop and see a clinician for pain that
        persists or worsens.
      </p>
    </>
  )
}

/**
 * The "why" drawer: each rule with its parameters, grades, default notes and papers. The registry
 * is requested only while the drawer is open.
 */
export function WhyDrawer({ rules, open, onClose }: WhyDrawerProps) {
  return (
    <Sheet open={open} onClose={onClose} title="Why this?">
      <DrawerBody rules={rules} />
    </Sheet>
  )
}
