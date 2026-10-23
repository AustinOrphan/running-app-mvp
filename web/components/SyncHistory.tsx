import { useState } from 'react'
import { render } from '../../shared/copy/template.ts'
import { TEMPLATES } from '../../shared/copy/templates.ts'
import type { SyncRunView } from '../../shared/types.ts'
import { useSyncRuns } from '../api/integrations.ts'
import { Button } from './Button.tsx'
import styles from './SyncHistory.module.css'
import { describeRun, failuresLabel, runHeading } from './syncText.ts'

type PlainId = 'sync.summary' | 'sync.loading' | 'sync.load-error' | 'sync.retry' | 'sync.empty'

function words(id: PlainId): string {
  return render(TEMPLATES[id], {}, 'km')
}

function Failures({ run }: { run: SyncRunView }) {
  return (
    <details className={styles.failures}>
      <summary className={styles.summary}>{failuresLabel(run.failed)}</summary>
      <ul className={styles.failureList}>
        {run.failures.map((failure, index) => (
          // A service's own words, shown as they came; the position keeps equal reasons apart.
          <li key={`${failure.ref}-${String(index)}`}>
            <code>{failure.ref}</code> {failure.reason}
          </li>
        ))}
      </ul>
      {run.failed > run.failures.length ? (
        <p className={styles.note}>
          {render(
            TEMPLATES['sync.failures.first'],
            { n: { kind: 'count', n: run.failures.length } },
            'km',
          )}
        </p>
      ) : null}
    </details>
  )
}

function Run({ run }: { run: SyncRunView }) {
  return (
    <li className={styles.run}>
      <p className={styles.when}>{runHeading(run)}</p>
      <p className={styles.what}>{describeRun(run)}</p>
      {run.failures.length > 0 ? <Failures run={run} /> : null}
    </li>
  )
}

/**
 * "Recent syncs" on a connected provider's card: its last runs, idle ones included, newest first.
 * The list is fetched the first time the disclosure is opened, not when the page loads.
 */
export function SyncHistory({ provider }: { provider: string }) {
  const [opened, setOpened] = useState(false)
  const runs = useSyncRuns(provider, opened)

  let body = null
  if (opened) {
    if (runs.isError) {
      body = (
        <div role="alert" className={styles.problem}>
          <p className={styles.note}>{words('sync.load-error')}</p>
          <Button
            variant="quiet"
            onClick={() => {
              void runs.refetch()
            }}
          >
            {words('sync.retry')}
          </Button>
        </div>
      )
    } else if (runs.isPending) {
      body = <p className={styles.note}>{words('sync.loading')}</p>
    } else if (runs.data.length === 0) {
      body = <p className={styles.note}>{words('sync.empty')}</p>
    } else {
      body = (
        <ul className={styles.runs}>
          {runs.data.map((run) => (
            <Run key={run.id} run={run} />
          ))}
        </ul>
      )
    }
  }

  return (
    <details
      className={styles.history}
      onToggle={(event) => {
        if (event.currentTarget.open) setOpened(true)
      }}
    >
      <summary className={styles.summary}>{words('sync.summary')}</summary>
      {body}
    </details>
  )
}
