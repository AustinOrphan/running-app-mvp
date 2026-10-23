import { describeParamRange, describeParamValue } from '../../shared/copy/paramUnits.ts'
import { render } from '../../shared/copy/template.ts'
import { TEMPLATES } from '../../shared/copy/templates.ts'
import type { Param } from '../../shared/engine/types.ts'
import type { Units } from '../../shared/types.ts'
import { useResearchParams } from '../api/research.ts'
import { useSettings } from '../api/settings.ts'
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

/**
 * Case does not matter, hyphens do (as in `paramsForRule`): `g-3` is the tightened profiles and
 * `G3` the third global principle.
 */
function ruleKey(id: string): string {
  return id.toLowerCase()
}

interface FactRow {
  label: string
  text: string
  /** A row of its own line, for a long value. */
  wide?: boolean
}

const LADDER_PARAM_ID = 'noviceLadder.rungs'

/** Rungs of sessions of alternating run and walk minutes, the shape of `noviceLadder.rungs`. */
function isLadder(value: unknown): value is number[][][] {
  return (
    Array.isArray(value) &&
    value.every(
      (rung) =>
        Array.isArray(rung) &&
        rung.every(
          (session) => Array.isArray(session) && session.every((v) => typeof v === 'number'),
        ),
    )
  )
}

/** "3 run, 1.5 walk, 5 run": a session's minutes, starting with a run and then alternating. */
function describeSession(session: number[]): string {
  return session
    .map((minutes, i) => `${String(minutes)} ${i % 2 === 0 ? 'run' : 'walk'}`)
    .join(', ')
}

/** One row per rung and session, so the ladder keeps its structure. */
function ladderRows(rungs: number[][][], unit: string | undefined): FactRow[] {
  const rows = rungs.flatMap((sessions, r) =>
    sessions.map((session, s) => ({
      label: sessions.length === 1 ? `Rung ${r + 1}` : `Rung ${r + 1}, session ${s + 1}`,
      text: describeSession(session),
      wide: true,
    })),
  )
  return unit === undefined ? rows : [...rows, { label: 'Unit', text: unit, wide: true }]
}

/** The parameter's value in plain words and the runner's units, and its range when it has one. */
function describeParam(param: Param<unknown>, units: Units): FactRow[] {
  if (param.id === LADDER_PARAM_ID && isLadder(param.value)) {
    return ladderRows(param.value, param.unit)
  }
  const rows: FactRow[] = [{ label: 'Value', text: describeParamValue(param, units) }]
  const range = describeParamRange(param, units)
  if (range !== null) rows.push({ label: 'Range', text: range })
  return rows
}

/** "k1.weeklyMultipliers" as "Weekly multipliers", for a parameter that has no note. */
function paramLabel(id: string): string {
  const last = id.split('.').pop() ?? id
  const words = last.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

function ParamRow({ param, units }: { param: Param<unknown>; units: Units }) {
  return (
    <div className={styles.param}>
      <p className={styles.sentence}>{param.note ?? paramLabel(param.id)}</p>
      <dl className={styles.facts}>
        {describeParam(param, units).map((row) => (
          <div
            key={row.label}
            className={row.wide === true ? `${styles.fact} ${styles.factWide}` : styles.fact}
          >
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
  const settings = useSettings()
  const corpus = useCorpus()
  const [openPapers, togglePaper] = useToggleSet()
  // Parameter values read in the runner's units; the server's default stands in if the setting
  // cannot be read.
  const units: Units = settings.data?.units ?? 'mi'

  if (registry.isPending || settings.isPending) {
    return <p className={styles.status}>{render(TEMPLATES['why.loading'], {}, units)}</p>
  }
  if (registry.isError) {
    return (
      <p role="alert" className={styles.status}>
        {render(TEMPLATES['why.registry-error'], {}, units)}
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
      <p className={styles.intro}>{render(TEMPLATES['why.intro'], {}, units)}</p>
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
              <p className={styles.note}>
                {render(TEMPLATES['why.no-parameter'], { rule: title ?? rule }, units)}
              </p>
            ) : (
              matched.map((param) => <ParamRow key={param.id} param={param} units={units} />)
            )}
            {paperIds.length > 0 ? (
              <div className={styles.papers}>
                <p className={styles.paperHeading}>Papers</p>
                {corpus.isPending ? (
                  <p className={styles.note}>
                    {render(TEMPLATES['why.papers-loading'], {}, units)}
                  </p>
                ) : null}
                {corpus.isError ? (
                  <p role="alert" className={styles.note}>
                    {render(TEMPLATES['why.papers-error'], { ids: paperIds.join(', ') }, units)}
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
                          {render(TEMPLATES['why.paper-missing'], { id }, units)}
                        </p>
                      )
                    })
                  : null}
              </div>
            ) : null}
          </section>
        )
      })}
      <p className={styles.footnote}>{render(TEMPLATES['why.footnote'], {}, units)}</p>
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
