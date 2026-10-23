import { useId } from 'react'
import { describeParamRange, describeParamValue } from '../../shared/copy/paramUnits.ts'
import { render } from '../../shared/copy/template.ts'
import { TEMPLATES } from '../../shared/copy/templates.ts'
import type { ExplainView, Param } from '../../shared/engine/types.ts'
import type { Units } from '../../shared/types.ts'
import { rulesRef, useExplain, type ExplainRef } from '../api/explain.ts'
import { useResearchParams } from '../api/research.ts'
import { useSettings } from '../api/settings.ts'
import { GradeBadge } from './GradeBadge.tsx'
import { InputFacts } from './InputFacts.tsx'
import { PaperCard } from './PaperCard.tsx'
import { Sheet } from './Sheet.tsx'
import { localiseParamNote, RATING_WHY_NOTE } from './engineText.ts'
import { ruleTitle } from './ruleTitles.ts'
import styles from './WhyDrawer.module.css'
import { useCorpus, useToggleSet } from './researchCorpus.ts'

export interface WhyDrawerProps {
  /**
   * What the figures are about: a session, a week, readiness, a prediction and so on. The drawer
   * asks `GET /api/explain` for it while it is open. Without it the drawer reads the rule ids
   * alone (`rulesRef`).
   */
  explain?: ExplainRef
  /**
   * Rule ids such as `g-1`, resolved to parameters, grades and papers. They are the rule section
   * when the figures cannot be loaded, and any the subject does not list are shown after its own.
   */
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

/** The server's default for a new account, used until the settings arrive. */
const DEFAULT_UNITS: Units = 'mi'

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
      <p className={styles.sentence}>
        {param.note === undefined ? paramLabel(param.id) : localiseParamNote(param.note, units)}
      </p>
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

/** Rule ids without repeats (any case), in the order given. */
function uniqueRules(rules: readonly string[]): string[] {
  const seen = new Set<string>()
  return rules.filter((rule) => {
    const key = ruleKey(rule)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/** The name a rule goes by: its title, or its id when it has none. */
function ruleName(rule: string): string {
  return ruleTitle(rule) ?? `Rule ${rule}`
}

/**
 * "From your numbers": for each rule of the subject, the figures the engine read in the runner's
 * units with the records they rest on, or the plain statement that the rule uses none of the
 * runner's data. The rule, its grade and its papers come after (`RuleSections`).
 */
function NumbersSection({
  view,
  units,
  onNavigate,
}: {
  view: ExplainView
  units: Units
  onNavigate: () => void
}) {
  const headingId = useId()
  const labelId = useId()
  const date = { kind: 'date', iso: view.asOf } as const
  const intro = view.frozen
    ? render(TEMPLATES['why.numbers-frozen'], { date }, units)
    : render(TEMPLATES['why.numbers-live'], { date }, units)
  return (
    <section aria-labelledby={headingId} className={styles.numbers}>
      <h3 id={headingId} className={styles.sectionTitle}>
        {render(TEMPLATES['why.numbers-heading'], {}, units)}
      </h3>
      <p className={styles.intro}>{intro}</p>
      {view.rules.map((rule) => {
        const group = view.groups.find((candidate) => ruleKey(candidate.rule) === ruleKey(rule))
        const alone = view.rest.some((candidate) => ruleKey(candidate) === ruleKey(rule))
        if (group === undefined && !alone) return null
        return (
          <div
            key={rule}
            role="group"
            aria-labelledby={`${labelId}-${ruleKey(rule)}`}
            className={styles.numbersRule}
          >
            <p id={`${labelId}-${ruleKey(rule)}`} className={styles.ruleLabel}>
              {ruleName(rule)}
            </p>
            {group === undefined ? (
              <p className={styles.note}>{render(TEMPLATES['why.rule-alone'], {}, units)}</p>
            ) : (
              <InputFacts facts={group.facts} units={units} onNavigate={onNavigate} />
            )}
          </div>
        )
      })}
    </section>
  )
}

/** Each rule with its parameters, grades, default notes and papers. */
function RuleSections({ rules, units }: { rules: string[]; units: Units }) {
  const registry = useResearchParams()
  const corpus = useCorpus()
  const [openPapers, togglePaper] = useToggleSet()

  if (registry.isError) {
    return (
      <p role="alert" className={styles.status}>
        {render(TEMPLATES['why.registry-error'], {}, units)}
      </p>
    )
  }
  if (registry.isPending) {
    return <p className={styles.status}>{render(TEMPLATES['why.loading'], {}, units)}</p>
  }

  const params = registry.data.params
  return (
    <>
      {rules.map((rule) => {
        const matched = params.filter((p) => ruleKey(p.rule) === ruleKey(rule))
        const paperIds = [...new Set(matched.flatMap((p) => p.evidence))].sort()
        const title = ruleTitle(rule)
        return (
          <section key={rule} className={styles.rule} aria-label={title ?? `Rule ${rule}`}>
            <h4 className={styles.ruleTitle}>{title ?? `Rule ${rule}`}</h4>
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
    </>
  )
}

function DrawerBody({
  explain,
  rules,
  onClose,
}: {
  explain: ExplainRef
  rules: string[]
  onClose: () => void
}) {
  const view = useExplain(explain, { enabled: true })
  const settings = useSettings()
  const rulesHeadingId = useId()
  // Parameter values and figures read in the runner's units. The setting is not waited for: the
  // drawer shows the server's default until it arrives, as the pages do, so a slow or failing
  // settings request never holds the figures back.
  const units: Units = settings.data?.units ?? DEFAULT_UNITS
  // The registry and the papers do not depend on the figures, so they are asked for now and the
  // three requests overlap. `RuleSections` reads the same queries once the figures are in.
  useResearchParams()
  useCorpus()

  // Wait for the figures, so the rule section does not gain rules after it has been read.
  if (view.isPending) {
    return <p className={styles.status}>{render(TEMPLATES['why.loading'], {}, units)}</p>
  }

  const shown = uniqueRules([...(view.data?.rules ?? []), ...rules])
  return (
    <>
      {view.data === undefined ? (
        <section className={styles.numbers}>
          <p role="alert" className={styles.status}>
            {render(TEMPLATES['why.explain-error'], {}, units)}
          </p>
        </section>
      ) : (
        <NumbersSection view={view.data} units={units} onNavigate={onClose} />
      )}
      <section aria-labelledby={rulesHeadingId} className={styles.rules}>
        <h3 id={rulesHeadingId} className={styles.sectionTitle}>
          {render(TEMPLATES['why.rules-heading'], {}, units)}
        </h3>
        <p className={styles.intro}>{render(TEMPLATES['why.intro'], {}, units)}</p>
        <RuleSections rules={shown} units={units} />
      </section>
      <p className={styles.footnote}>{render(TEMPLATES['why.footnote'], {}, units)}</p>
    </>
  )
}

/**
 * The "why" drawer: "From your numbers" (the figures the engine read, with their sources) and then
 * each rule with its parameters, grades, default notes and papers. The figures, the parameter
 * registry and the papers are requested only while the drawer is open.
 */
export function WhyDrawer({ explain, rules, open, onClose }: WhyDrawerProps) {
  return (
    <Sheet open={open} onClose={onClose} title="Why this?">
      <DrawerBody explain={explain ?? rulesRef(rules)} rules={rules} onClose={onClose} />
    </Sheet>
  )
}
