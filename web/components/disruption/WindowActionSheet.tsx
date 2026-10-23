import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { offlineLine, stalePreviewLine } from '../../../shared/copy/windowView.ts'
import { addDays, isIsoDate } from '../../../shared/dates.ts'
import type { DisruptionResult, DisruptionView } from '../../../shared/types.ts'
import {
  useRemoveDisruption,
  useUpdateDisruption,
  type DisruptionPreviewAction,
} from '../../api/disruptions.ts'
import {
  commitFailure,
  planPreviewKey,
  useMarkRevisionsSeen,
  usePlanPreview,
} from '../../api/plan.ts'
import { useSettings } from '../../api/settings.ts'
import { Button } from '../Button.tsx'
import { Field, Input } from '../Field.tsx'
import { Sheet } from '../Sheet.tsx'
import { Skeleton } from '../Skeleton.tsx'
import { RevisionDiff } from '../revisions/RevisionDiff.tsx'
import { PreviewPanel } from './PreviewPanel.tsx'
import { dateBounds } from './windowDraft.ts'
import styles from './disruption.module.css'

/**
 * What the banner's three buttons ask for, and the same removal from an undo that was refused
 * because the window changed since.
 *
 * - `better`: the window ends yesterday, so today is the first day the plan counts as recovered and
 *   the return is sized from the days actually rested.
 * - `extend`: the window runs to a later last day, which the runner chooses.
 * - `remove`: the window is retracted; the days it already skipped stay skipped.
 *
 * `today` is the server's local day (`TodayView.date`).
 */
export type WindowAction =
  | { kind: 'better'; window: DisruptionView; today: string }
  | { kind: 'extend'; window: DisruptionView; today: string }
  | { kind: 'remove'; windowId: string }

export type WindowActionSheetProps = WindowAction & { onClose: () => void }

const TITLES = {
  better: "I'm better",
  extend: 'Extend this window',
  remove: 'Remove this window',
} as const

const INTRO = {
  better: 'The window ends yesterday. The return is sized from the days you rested.',
  extend: 'Choose the new last day.',
  remove:
    'The plan goes back to how it would be without this window. Days already skipped stay skipped.',
} as const

/**
 * A change to a window that is already in force, previewed before it is applied: the server builds
 * the preview from the code that commits it, "Apply to my plan" sends its hash, and a plan that
 * moved in between answers with a newer preview. The result is the revision it wrote, with its
 * undo.
 */
export function WindowActionSheet(props: WindowActionSheetProps) {
  const { onClose } = props
  const queryClient = useQueryClient()
  const settings = useSettings()
  const update = useUpdateDisruption()
  const remove = useRemoveDisruption()
  const markSeen = useMarkRevisionsSeen()
  const [endDate, setEndDate] = useState(
    props.kind === 'extend' ? addDays(props.window.endDate, 1) : '',
  )
  const [notice, setNotice] = useState<string | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const [done, setDone] = useState<DisruptionResult | null>(null)
  const units = settings.data?.units ?? 'km'

  const id = props.kind === 'remove' ? props.windowId : props.window.id
  let action: DisruptionPreviewAction | null
  if (props.kind === 'remove') action = { type: 'disruption-remove', id }
  else if (props.kind === 'better') {
    action = { type: 'disruption-update', id, endDate: addDays(props.today, -1) }
  } else action = isIsoDate(endDate) ? { type: 'disruption-update', id, endDate } : null

  const preview = usePlanPreview(action)
  const pending = update.isPending || remove.isPending
  const asked = commitFailure(preview.error)

  function apply() {
    if (action === null || preview.data === undefined || preview.data.blocked) return
    setFailure(null)
    const outcomeOf = {
      onSuccess: (result: DisruptionResult) => {
        setDone(result)
        markSeen([result.revision.id])
      },
      onError: (error: unknown) => {
        const outcome = commitFailure(error)
        if (outcome.kind === 'stale') {
          queryClient.setQueryData(planPreviewKey(action), outcome.preview)
          setNotice(stalePreviewLine(units))
        } else if (outcome.kind === 'offline') {
          setFailure(offlineLine(units))
        } else {
          setFailure(outcome.message)
        }
      },
    }
    if (action.type === 'disruption-remove') {
      remove.mutate({ id, expectHash: preview.data.hash }, outcomeOf)
    } else if (action.type === 'disruption-update' && action.endDate !== undefined) {
      update.mutate({ id, endDate: action.endDate, expectHash: preview.data.hash }, outcomeOf)
    }
  }

  let body
  let footer
  if (done !== null) {
    body = (
      <>
        <div role="status">
          <h3 className={styles.stepHeading}>
            {props.kind === 'remove' ? 'Window removed' : 'Window changed'}
          </h3>
        </div>
        <RevisionDiff revision={done.revision} units={units} isNew={false} />
      </>
    )
    footer = (
      <Button variant="primary" onClick={onClose}>
        Done
      </Button>
    )
  } else {
    const bounds =
      props.kind === 'extend' ? dateBounds(props.window.startDate, props.today, null) : null
    const fieldError =
      asked.kind === 'invalid' ? (asked.fields['endDate'] ?? asked.message) : undefined
    body = (
      <>
        <p className={styles.text}>{INTRO[props.kind]}</p>
        {props.kind === 'extend' && bounds !== null ? (
          <Field label="Until" hint="The last day it affects training." error={fieldError}>
            {(a) => (
              <Input
                {...a}
                type="date"
                value={endDate}
                min={addDays(props.window.endDate, 1)}
                max={bounds.endMax}
                onChange={(event) => {
                  setEndDate(event.target.value)
                  setNotice(null)
                  setFailure(null)
                }}
              />
            )}
          </Field>
        ) : null}
        {preview.data !== undefined ? (
          <PreviewPanel
            preview={preview.data}
            units={units}
            notice={notice}
            lead={[preview.data.summary]}
          />
        ) : preview.isError && asked.kind !== 'invalid' ? (
          <p role="alert" className={styles.errorText}>
            {asked.kind === 'offline'
              ? offlineLine(units)
              : 'The preview could not be loaded. Close this and try again.'}
          </p>
        ) : action !== null && !preview.isError ? (
          <div role="status">
            <p className={styles.text}>Checking what would change.</p>
            <Skeleton lines={2} />
          </div>
        ) : null}
        {failure !== null ? (
          <p role="alert" className={styles.errorText}>
            {failure}
          </p>
        ) : null}
      </>
    )
    footer = (
      <>
        <Button variant="quiet" disabled={pending} onClick={onClose}>
          Cancel
        </Button>
        <Button
          variant="primary"
          disabled={preview.data === undefined || preview.data.blocked}
          loading={pending}
          onClick={apply}
        >
          Apply to my plan
        </Button>
      </>
    )
  }

  return (
    <Sheet open onClose={onClose} title={TITLES[props.kind]} footer={footer}>
      <div className={styles.body}>{body}</div>
    </Sheet>
  )
}
