import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { briefText, briefWeekLabel, renderBrief } from '../../shared/copy/briefRender.ts'
import { BRIEF_TEMPLATES } from '../../shared/copy/briefTemplates.ts'
import { render } from '../../shared/copy/template.ts'
import { renderFact } from '../../shared/copy/templates.ts'
import { addDays, isIsoDate, mondayOf, todayIso } from '../../shared/dates.ts'
import type { InputFact } from '../../shared/engine/types.ts'
import type { BriefView, PlanRevisionView, Units } from '../../shared/types.ts'
import { useBrief, useMarkBriefSeen } from '../api/brief.ts'
import { ruleTarget, type WhyTarget } from '../api/explain.ts'
import { useSettings } from '../api/settings.ts'
import buttonStyles from '../components/Button.module.css'
import { Button } from '../components/Button.tsx'
import { InputFacts } from '../components/InputFacts.tsx'
import { PageHeader } from '../components/PageHeader.tsx'
import { RevisionDiff } from '../components/revisions/RevisionDiff.tsx'
import { TargetList } from '../components/today/SessionTargets.tsx'
import { WhyDrawer } from '../components/WhyDrawer.tsx'
import styles from './BriefPage.module.css'

/** The server's default for a new account, used until the settings arrive. */
const DEFAULT_UNITS: Units = 'mi'

const date = (iso: string) => ({ kind: 'date', iso, style: 'short' }) as const

/** The revisions of a brief the runner has not opened: the one it describes and those since. */
function unseenIds(brief: BriefView): string[] {
  return [brief.revision, ...brief.since].flatMap((revision) =>
    revision !== null && revision.seenAt === null ? [revision.id] : [],
  )
}

/** Why there is no brief: no plan, a week that has not begun, or a week before the first brief. */
function emptyText(weekStart: string | undefined, units: Units): string {
  if (weekStart === undefined || !isIsoDate(weekStart)) {
    return weekStart === undefined
      ? briefText('brief.no-plan', units)
      : BRIEF_TEMPLATES['brief.none'].fallback
  }
  const week = mondayOf(weekStart)
  const current = mondayOf(todayIso())
  if (week === current) return briefText('brief.no-plan', units)
  const id = week > current ? 'brief.not-yet' : 'brief.none'
  return render(BRIEF_TEMPLATES[id], { week: date(week) }, units)
}

function WhyButton({ fact, units, onOpen }: { fact: InputFact; units: Units; onOpen: () => void }) {
  return (
    <Button
      variant="quiet"
      className={styles.why}
      aria-label={`Why: ${renderFact(fact, units)}`}
      onClick={onOpen}
    >
      Why
    </Button>
  )
}

/** Earlier and later briefs, when there are any. */
function WeekLinks({ brief, units }: { brief: BriefView; units: Units }) {
  if (brief.prev === null && brief.next === null) return null
  const classes = `${buttonStyles.button} ${buttonStyles.secondary}`
  return (
    <nav aria-label={briefText('brief.title', units)} className={styles.weeks}>
      {brief.prev === null ? null : (
        <Link to={`/brief/${brief.prev}`} className={classes}>
          {briefText('brief.earlier', units)}
        </Link>
      )}
      {brief.next === null ? null : (
        <Link to={`/brief/${brief.next}`} className={classes}>
          {briefText('brief.later', units)}
        </Link>
      )}
    </nav>
  )
}

/**
 * One brief, section by section in the order of design 8.6: the week and the decision, what
 * changed and why (with the update's diff and its undo), what the plan noticed, the next key
 * session and what has changed since. The words are `renderBrief`'s, from the stored facts in the
 * runner's units. Opening stamps the revisions as seen; the ones that were unseen on arrival keep
 * their "New" marker until the page is left.
 */
function BriefBody({ brief, units }: { brief: BriefView; units: Units }) {
  const markSeen = useMarkBriefSeen()
  const [why, setWhy] = useState<WhyTarget | null>(null)
  const [fresh, setFresh] = useState<ReadonlySet<string>>(() => new Set(unseenIds(brief)))
  const unseen = unseenIds(brief)
  if (unseen.some((id) => !fresh.has(id))) setFresh(new Set([...fresh, ...unseen]))
  const waiting = unseen.length > 0
  const { weekStart } = brief
  useEffect(() => {
    if (waiting) markSeen(weekStart)
  }, [waiting, weekStart, markSeen])

  const rendered = renderBrief(brief, units)
  const lead = [...rendered.headline, ...rendered.context]
  const decided = brief.facts.lastWeek?.weekStart ?? addDays(weekStart, -7)

  function whyUpdate(revision: PlanRevisionView, rules: string[]): WhyTarget {
    // The update the weekly decision made is explained from that decision's figures.
    return revision.id === brief.revision?.id && revision.decision !== null
      ? { rules, explain: { subject: 'decision', weekStart: decided } }
      : ruleTarget(rules)
  }

  const showDiff = brief.revision !== null && brief.revision.diff?.empty !== true
  const session = rendered.key.session
  return (
    <div className={styles.page}>
      {lead.length === 0 ? null : (
        <div className={styles.lead}>
          {lead.map((sentence) => (
            <p key={sentence}>{sentence}</p>
          ))}
        </div>
      )}
      <div className={styles.grid}>
        <section aria-labelledby="brief-changed" className={styles.section}>
          <h2 id="brief-changed">{rendered.changes.heading}</h2>
          <p className={styles.text}>{rendered.changes.text}</p>
          {brief.revision === null && rendered.changes.causes.length > 0 ? (
            <ul className={styles.causes}>
              {rendered.changes.causes.map((cause) => (
                <li key={cause}>{cause}</li>
              ))}
            </ul>
          ) : null}
          {showDiff && brief.revision !== null ? (
            <RevisionDiff
              revision={brief.revision}
              units={units}
              summary={false}
              onWhy={(rules) => {
                if (brief.revision !== null) setWhy(whyUpdate(brief.revision, rules))
              }}
              isNew={fresh.has(brief.revision.id)}
            />
          ) : null}
        </section>

        <div className={styles.side}>
          <section aria-labelledby="brief-noticed" className={styles.section}>
            <h2 id="brief-noticed">{rendered.noticed.heading}</h2>
            {rendered.noticed.empty !== null ? (
              <p className={styles.text}>{rendered.noticed.empty}</p>
            ) : (
              <InputFacts
                facts={brief.facts.noticed}
                units={units}
                onNavigate={() => {}}
                action={(fact) => (
                  <WhyButton
                    fact={fact}
                    units={units}
                    onOpen={() => {
                      setWhy({
                        rules: [fact.rule],
                        explain: { subject: 'brief', weekStart },
                      })
                    }}
                  />
                )}
              />
            )}
          </section>

          <section aria-labelledby="brief-key" className={styles.section}>
            <h2 id="brief-key">{rendered.key.heading}</h2>
            {session === null ? (
              <p className={styles.text}>{rendered.key.none}</p>
            ) : (
              <>
                <p className={styles.text}>{session.line}</p>
                <TargetList rows={session.targets} />
                <p className={styles.muted}>{session.readiness}</p>
              </>
            )}
          </section>

          <section aria-labelledby="brief-since" className={styles.section}>
            <h2 id="brief-since">{briefText('brief.heading-since', units)}</h2>
            {brief.since.length === 0 ? (
              <p className={styles.text}>{briefText('brief.since-none', units)}</p>
            ) : (
              <ol className={styles.revisions}>
                {brief.since.map((revision) => (
                  <li key={revision.id}>
                    <RevisionDiff
                      revision={revision}
                      units={units}
                      onWhy={(rules) => {
                        setWhy(whyUpdate(revision, rules))
                      }}
                      isNew={fresh.has(revision.id)}
                    />
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>
      </div>
      <WhyDrawer
        explain={why?.explain}
        rules={why?.rules ?? []}
        open={why !== null}
        onClose={() => {
          setWhy(null)
        }}
      />
    </div>
  )
}

/**
 * `/brief` and `/brief/:weekStart` (design 8.6): the Monday brief of the current week or of an
 * earlier one, reached from More and from Today's brief line. It is read from the server each time
 * and never cached offline.
 */
export function BriefPage() {
  const { weekStart } = useParams()
  const settings = useSettings()
  const readable = weekStart === undefined || isIsoDate(weekStart)
  const brief = useBrief(readable ? weekStart : undefined, { enabled: readable })
  const units = settings.data?.units ?? DEFAULT_UNITS
  const title = briefText('brief.title', units)

  if (!readable) {
    return (
      <>
        <PageHeader title={title} />
        <p className={styles.text}>{emptyText(weekStart, units)}</p>
      </>
    )
  }
  if (brief.isError || settings.isError) {
    return (
      <>
        <PageHeader title={title} />
        <p role="alert" className={styles.error}>
          {briefText('brief.error', units)}
        </p>
      </>
    )
  }
  if (brief.isPending || settings.isPending) {
    return (
      <>
        <PageHeader title={title} />
        <p role="status" className={styles.text}>
          {briefText('brief.loading', units)}
        </p>
      </>
    )
  }
  if (brief.data === null) {
    return (
      <>
        <PageHeader title={title} />
        <p className={styles.text}>{emptyText(weekStart, units)}</p>
      </>
    )
  }
  return (
    <>
      <PageHeader
        title={title}
        context={briefWeekLabel(brief.data.weekStart, units)}
        actions={<WeekLinks brief={brief.data} units={units} />}
      />
      <BriefBody key={brief.data.weekStart} brief={brief.data} units={units} />
    </>
  )
}
