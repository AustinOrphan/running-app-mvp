// The words of the sync history (spec 5.7). Pure: a run in, sentences out. Every sentence is a
// template in `shared/copy/sync.ts`, so the shared G5 lint covers it; what a service said is a text
// slot, shown verbatim inside the app's own sentence.
import { render } from '../../shared/copy/template.ts'
import { TEMPLATES } from '../../shared/copy/templates.ts'
import type { SyncRunView } from '../../shared/types.ts'

// No sync sentence holds a distance or a pace, so the unit system cannot change a word of it.
const UNITS = 'km'

function count(n: number) {
  return { kind: 'count' as const, n }
}

/** "22 Oct, 06:00 · Scheduled": when the run started in the reader's time zone, and how it began. */
export function runHeading(run: Pick<SyncRunView, 'startedAt' | 'channel' | 'trigger'>): string {
  const started = new Date(run.startedAt)
  const pad = (n: number): string => String(n).padStart(2, '0')
  const iso = `${String(started.getFullYear())}-${pad(started.getMonth() + 1)}-${pad(started.getDate())}`
  const how =
    run.channel === 'publish'
      ? render(TEMPLATES['sync.how.publish'], {}, UNITS)
      : run.channel === 'folder'
        ? render(TEMPLATES['sync.how.folder'], {}, UNITS)
        : render(TEMPLATES[`sync.how.${run.trigger}`], {}, UNITS)
  return render(
    TEMPLATES['sync.when'],
    {
      day: { kind: 'date', iso },
      time: `${pad(started.getHours())}:${pad(started.getMinutes())}`,
      how,
    },
    UNITS,
  )
}

/** What the run stored, skipped and could not import; empty when there is nothing to say. */
function activitySentences(run: SyncRunView): string[] {
  const sentences: string[] = []
  if (run.accepted > 0 && run.duplicate > 0) {
    sentences.push(
      run.accepted === 1
        ? render(TEMPLATES['sync.stored-skipped.one'], { skipped: count(run.duplicate) }, UNITS)
        : render(
            TEMPLATES['sync.stored-skipped.many'],
            { n: count(run.accepted), skipped: count(run.duplicate) },
            UNITS,
          ),
    )
  } else if (run.accepted > 0) {
    sentences.push(
      run.accepted === 1
        ? render(TEMPLATES['sync.stored.one'], {}, UNITS)
        : render(TEMPLATES['sync.stored.many'], { n: count(run.accepted) }, UNITS),
    )
  } else if (run.duplicate > 0) {
    sentences.push(render(TEMPLATES['sync.skipped'], { n: count(run.duplicate) }, UNITS))
  }
  if (run.failed > 0)
    sentences.push(render(TEMPLATES['sync.failed'], { n: count(run.failed) }, UNITS))
  return sentences
}

function wellnessSentence(run: SyncRunView): string | null {
  switch (run.wellnessStatus) {
    case 'none':
      return null
    case 'read':
      if (run.wellnessDays === null || run.wellnessDays <= 0) return null
      return run.wellnessDays === 1
        ? render(TEMPLATES['sync.wellness.one'], {}, UNITS)
        : render(TEMPLATES['sync.wellness.many'], { n: count(run.wellnessDays) }, UNITS)
    case 'truncated':
      return run.wellnessDays !== null && run.wellnessDays > 0 && run.wellnessTotal !== null
        ? render(
            TEMPLATES['sync.wellness.truncated'],
            { read: count(run.wellnessDays), total: count(run.wellnessTotal) },
            UNITS,
          )
        : render(TEMPLATES['sync.wellness.none-yet'], {}, UNITS)
    case 'waiting':
      return render(TEMPLATES['sync.wellness.waiting'], {}, UNITS)
    case 'error':
      return run.message
        ? render(TEMPLATES['sync.wellness.error-detail'], { message: run.message }, UNITS)
        : render(TEMPLATES['sync.wellness.error'], {}, UNITS)
  }
}

/** The calendar channel counts sessions: `accepted` were sent, `duplicate` were already there. */
function sentSentences(run: SyncRunView): string[] {
  const sentences: string[] = []
  sentences.push(
    run.accepted === 1
      ? render(TEMPLATES['sync.sent.one'], { unchanged: count(run.duplicate) }, UNITS)
      : render(
          TEMPLATES['sync.sent.many'],
          { sent: count(run.accepted), unchanged: count(run.duplicate) },
          UNITS,
        ),
  )
  if (run.failed > 0)
    sentences.push(render(TEMPLATES['sync.not-sent'], { n: count(run.failed) }, UNITS))
  return sentences
}

/**
 * One line for a run, from its counts and statuses: "Stored 3 new activities, skipped 1 already
 * stored. Read 7 wellness days.", "Nothing new.", "Paused to stay within the service's limits. Read
 * 12 of 30 wellness days; the rest follow on the next run.", "Did not finish: <service text>".
 * A run that stopped early is never described as complete.
 */
export function describeRun(run: SyncRunView): string {
  if (run.channel === 'publish') {
    const sent = sentSentences(run)
    return run.status === 'error' ? [...sent, errorSentence(run)].join(' ') : sent.join(' ')
  }
  const sentences = activitySentences(run)
  if (run.status === 'paused') sentences.push(render(TEMPLATES['sync.paused'], {}, UNITS))
  const wellness = wellnessSentence(run)
  if (wellness !== null) sentences.push(wellness)
  if (run.status === 'error') sentences.push(errorSentence(run))
  if (sentences.length === 0) sentences.push(render(TEMPLATES['sync.nothing-new'], {}, UNITS))
  return sentences.join(' ')
}

function errorSentence(run: SyncRunView): string {
  return run.message
    ? render(TEMPLATES['sync.error'], { message: run.message }, UNITS)
    : render(TEMPLATES['sync.error.plain'], {}, UNITS)
}

/** "Show the 3 that could not be imported"; the label of the nested disclosure. */
export function failuresLabel(failed: number): string {
  return failed === 1
    ? render(TEMPLATES['sync.failures.one'], {}, UNITS)
    : render(TEMPLATES['sync.failures.many'], { n: count(failed) }, UNITS)
}
