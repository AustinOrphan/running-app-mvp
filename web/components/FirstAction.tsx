import { Link } from 'react-router-dom'
import type { FirstAction } from '../../shared/engine/firstAction.ts'
import { render } from '../../shared/copy/template.ts'
import { TEMPLATES, type TemplateId } from '../../shared/copy/templates.ts'
import type { Units } from '../../shared/types.ts'
import buttonStyles from './Button.module.css'
import { EmptyState } from './EmptyState.tsx'
import styles from './FirstAction.module.css'

const say = (id: TemplateId, units: Units): string => render(TEMPLATES[id], {}, units)

/**
 * The reason the server derived (`firstActionFor`) as words: the sentence that says what the plan
 * needs, or null when the runs are enough. Nothing here decides the reason.
 */
export function firstActionNeed(firstAction: FirstAction | undefined, units: Units): string | null {
  if (firstAction?.reason !== 'runs') return null
  return render(
    TEMPLATES['today.first.runs-need'],
    {
      level: { kind: 'minutes', min: firstAction.levelMin },
      floor: { kind: 'minutes', min: firstAction.floorMin },
    },
    units,
  )
}

/** The empty-state sentence for the reason, shared by Today and the Plan page. */
export function firstActionTitle(firstAction: FirstAction | undefined, units: Units): string {
  return say(
    firstAction?.reason === 'runs' ? 'today.first.runs-title' : 'today.first.goal-title',
    units,
  )
}

/**
 * Today with no plan: one sentence, the reason as facts and one primary action. The other way
 * forward, when the runs are what is missing, is a plain link beside it (visual design 17).
 */
export function FirstActionState({
  firstAction,
  hasGoal,
  units,
}: {
  firstAction: FirstAction | undefined
  hasGoal: boolean
  units: Units
}) {
  const need = firstActionNeed(firstAction, units)
  const choose = hasGoal
    ? { to: '/plan', label: say('today.first.generate', units) }
    : { to: '/goals', label: say('today.first.choose-goal', units) }
  const primary =
    need === null ? choose : { to: '/integrations', label: say('today.first.bring-runs', units) }
  return (
    <EmptyState
      title={firstActionTitle(firstAction, units)}
      body={need ?? undefined}
      action={
        <div className={styles.actions}>
          <Link to={primary.to} className={`${buttonStyles.button} ${buttonStyles.primary}`}>
            {primary.label}
          </Link>
          {need === null ? null : (
            <Link to={choose.to} className={`${buttonStyles.button} ${buttonStyles.quiet}`}>
              {choose.label}
            </Link>
          )}
        </div>
      }
    />
  )
}

/**
 * The Generate form's line: the same sentence as Today's when the same check fails, with the same
 * link. The form's own Generate button stays the one primary button of the page.
 */
export function FirstActionLine({
  firstAction,
  units,
}: {
  firstAction: FirstAction | undefined
  units: Units
}) {
  const need = firstActionNeed(firstAction, units)
  if (need === null) return null
  return (
    <div className={styles.line}>
      <p className={styles.need}>{need}</p>
      <Link to="/integrations" className={`${buttonStyles.button} ${buttonStyles.quiet}`}>
        {say('today.first.bring-runs', units)}
      </Link>
    </div>
  )
}
