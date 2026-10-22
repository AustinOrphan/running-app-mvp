import type { Param } from '../../shared/engine/types.ts'
import { useResearchParams } from '../api/research.ts'
import { GradeBadge } from './GradeBadge.tsx'
import { PaperCard } from './PaperCard.tsx'
import { Sheet } from './Sheet.tsx'
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

function ParamRow({ param }: { param: Param<unknown> }) {
  return (
    <div className={styles.param}>
      <div className={styles.paramHead}>
        <span className={styles.paramId}>{param.id}</span>
        <GradeBadge grade={param.grade} />
      </div>
      <dl className={styles.facts}>
        {describeParam(param).map((row) => (
          <div key={row.label} className={styles.fact}>
            <dt>{row.label}</dt>
            <dd>{row.text}</dd>
          </div>
        ))}
      </dl>
      {param.grade === 'D' ? (
        <p className={styles.note}>
          <strong>Default, not evidence.</strong> A cautious value chosen by the plan builder.
        </p>
      ) : null}
      {param.note !== undefined ? <p className={styles.note}>{param.note}</p> : null}
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
        return (
          <section key={rule} className={styles.rule} aria-label={`Rule ${rule}`}>
            <h3 className={styles.ruleTitle}>Rule {rule}</h3>
            {matched.length === 0 ? (
              <p className={styles.note}>No parameter is recorded for {rule}.</p>
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
