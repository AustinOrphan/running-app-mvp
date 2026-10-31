import { useId, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { exerciseById } from '../../../shared/domain/strengthLibrary.ts'
import type { StrengthView, WeightUnit } from '../../../shared/types.ts'
import { useProfile } from '../../api/profile.ts'
import { useUpdateSettings } from '../../api/settings.ts'
import { Button } from '../Button.tsx'
import { Segmented } from '../Segmented.tsx'
import { useToast } from '../Toast.tsx'
import type { SetupPart } from './setupForm.ts'
import type { PageWords } from './strengthPageText.ts'
import styles from './StrengthSections.module.css'

export interface UnitsSectionProps {
  view: StrengthView
  words: PageWords
  weightUnit: WeightUnit
  /** An "Edit" button opens the setup sheet of its part. */
  onOpen: (part: SetupPart) => void
}

/** One row of the section: what it is, what is saved, and the button that changes it. */
function Row({
  term,
  children,
  action,
  button = true,
}: {
  term: string
  children: ReactNode
  action: ReactNode
  /** The action is a quiet button, whose padding the row takes back so its text lines up. */
  button?: boolean
}) {
  return (
    <div className={styles.fact}>
      <dt>{term}</dt>
      <dd>{children}</dd>
      <dd className={button ? styles.rowAction : undefined}>{action}</dd>
    </div>
  )
}

/**
 * Equipment and units (design 11.3, part 7; 6.5): the weight unit, which every load follows at once,
 * and a row for each part of the setup with what is saved and a button to change it, whenever the
 * setup changes (a gym membership that starts, a bar sold), and the injuries of the Profile, with a
 * link. The next workout follows a saved change on its next read.
 */
export function UnitsSection({ view, words, weightUnit, onOpen }: UnitsSectionProps) {
  const headingId = useId()
  const toast = useToast()
  const update = useUpdateSettings()
  const profile = useProfile()
  const { settings, anchors, setupSaved } = view
  // the choice shows at once and settles when the server has it; a refusal puts the saved one back
  const shown: WeightUnit = update.isPending
    ? (update.variables.weightUnit ?? weightUnit)
    : weightUnit

  const notSet = words.say('strength.page.not-set')
  const names = (ids: readonly string[]): string => ids.map((id) => words.name(id)).join(', ')
  const pinned = Object.values(settings.pinned).filter((id): id is string => id !== undefined)
  const pinnedNames = names(pinned)
  const injuries = profile.data?.injuries.map((injury) => injury.area).join(', ') ?? ''

  function chooseUnit(next: WeightUnit): void {
    if (next === shown) return
    update.mutateAsync({ weightUnit: next }).then(
      () => {
        toast.show(words.say('strength.page.unit-saved'))
      },
      () => {
        // the failure shows under the choice, which has gone back to the saved unit
      },
    )
  }

  return (
    <section aria-labelledby={headingId} className={styles.section}>
      <h2 id={headingId} className={styles.heading}>
        {words.say('strength.page.units-heading')}
      </h2>
      <Segmented<WeightUnit>
        label={words.say('strength.page.weight-units')}
        value={shown}
        hint={[words.say('strength.page.weight-units-hint')]}
        onChange={chooseUnit}
        options={[
          { value: 'lb', label: words.say('strength.page.unit-pounds') },
          { value: 'kg', label: words.say('strength.page.unit-kilograms') },
        ]}
      />
      {update.isError ? (
        <p role="alert" className={styles.error}>
          {words.say('strength.page.unit-error')}
        </p>
      ) : null}

      <dl className={styles.facts}>
        <Row
          term={words.say('strength.page.part-equipment')}
          action={
            <Button
              variant="quiet"
              onClick={() => {
                onOpen('equipment')
              }}
            >
              {words.say('strength.page.edit-equipment')}
            </Button>
          }
        >
          {settings.equipment.length === 0
            ? words.say('strength.page.equip-none')
            : settings.equipment.map((item) => words.kind(item.kind)).join(', ')}
        </Row>
        <Row
          term={words.say('strength.page.part-history')}
          action={
            <Button
              variant="quiet"
              onClick={() => {
                onOpen('history')
              }}
            >
              {words.say('strength.page.edit-history')}
            </Button>
          }
        >
          {setupSaved
            ? words.say('strength.page.history-value', {
                level: words.level(settings.level),
                now: words.say(
                  settings.currentlyLifting ? 'strength.page.yes' : 'strength.page.no',
                ),
              })
            : notSet}
        </Row>
        <Row
          term={words.say('strength.page.part-exercises')}
          action={
            <Button
              variant="quiet"
              onClick={() => {
                onOpen('exercises')
              }}
            >
              {words.say('strength.page.edit-exercises')}
            </Button>
          }
        >
          {settings.avoid.length === 0 && pinned.length === 0 ? (
            words.say('strength.page.exercises-none')
          ) : (
            <>
              {settings.avoid.length === 0
                ? null
                : words.say('strength.page.exercises-left', { names: names(settings.avoid) })}{' '}
              {pinned.length === 0
                ? null
                : words.say('strength.page.exercises-pinned', { names: pinnedNames })}
            </>
          )}
        </Row>
        <Row
          term={words.say('strength.page.part-anchors')}
          action={
            <Button
              variant="quiet"
              onClick={() => {
                onOpen('anchors')
              }}
            >
              {words.say('strength.page.edit-anchors')}
            </Button>
          }
        >
          {anchors.length === 0
            ? words.say('strength.page.anchors-none')
            : anchors
                .map((anchor) => exerciseById(anchor.exerciseId))
                .flatMap((exercise) => (exercise === undefined ? [] : [words.name(exercise.id)]))
                .join(', ')}
        </Row>
        <Row
          button={false}
          term={words.say('strength.page.injuries-heading')}
          action={
            <Link to="/profile" className={styles.link}>
              {words.say('strength.page.profile-link')}
            </Link>
          }
        >
          {profile.data === undefined
            ? null
            : injuries === ''
              ? words.say('strength.page.injuries-none')
              : words.say('strength.page.injuries-value', { areas: injuries })}
        </Row>
      </dl>
    </section>
  )
}
