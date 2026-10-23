// The sentences of the sync history on the Integrations page (spec 5.7). `describeRun` in
// `web/components/syncText.ts` picks and joins them; every one is rendered by the copy-lint test.
//
// Text a service returned (an intervals.icu error, a Garmin message) is a text slot: it is shown
// verbatim inside the app's own sentence and is outside the lint (spec 4.5).
import { tpl, type Template } from './template.ts'

export const SYNC_TEMPLATES = {
  // The heading of a run: "22 Oct, 06:00 · Scheduled".
  'sync.when': tpl(
    '{day}, {time} · {how}',
    { day: 'date', time: 'text', how: 'text' },
    { shape: 'label' },
  ),
  'sync.how.schedule': tpl('Scheduled', {}, { shape: 'label' }),
  'sync.how.manual': tpl('Manual', {}, { shape: 'label' }),
  'sync.how.push': tpl('Push', {}, { shape: 'label' }),
  'sync.how.catchup': tpl('Catch-up', {}, { shape: 'label' }),
  'sync.how.folder': tpl('Folder scan', {}, { shape: 'label' }),
  'sync.how.publish': tpl('Sent to calendar', {}, { shape: 'label' }),

  // What a run stored.
  'sync.stored.one': tpl('Stored 1 new activity.'),
  'sync.stored.many': tpl('Stored {n} new activities.', { n: 'count' }),
  'sync.stored-skipped.one': tpl('Stored 1 new activity, skipped {skipped} already stored.', {
    skipped: 'count',
  }),
  'sync.stored-skipped.many': tpl('Stored {n} new activities, skipped {skipped} already stored.', {
    n: 'count',
    skipped: 'count',
  }),
  'sync.skipped': tpl('Skipped {n} already stored.', { n: 'count' }),
  'sync.failed': tpl('{n} could not be imported.', { n: 'count' }),
  'sync.nothing-new': tpl('Nothing new.'),

  // A run that stopped to respect the service's limits, or did not finish.
  'sync.paused': tpl("Paused to stay within the service's limits."),
  'sync.error': tpl(
    'Did not finish: {message}',
    { message: 'text' },
    { shape: 'label', fallback: 'Did not finish.' },
  ),
  'sync.error.plain': tpl('Did not finish.'),

  // Wellness.
  'sync.wellness.one': tpl('Read 1 wellness day.'),
  'sync.wellness.many': tpl('Read {n} wellness days.', { n: 'count' }),
  'sync.wellness.truncated': tpl(
    'Read {read} of {total} wellness days; the rest follow on the next run.',
    {
      read: 'count',
      total: 'count',
    },
  ),
  'sync.wellness.none-yet': tpl('No wellness days read yet; they follow on the next run.'),
  'sync.wellness.waiting': tpl('Wellness waits until the activity backfill finishes.'),
  'sync.wellness.error': tpl('Wellness could not be read.'),
  'sync.wellness.error-detail': tpl(
    'Wellness could not be read: {message}',
    { message: 'text' },
    { shape: 'label', fallback: 'Wellness could not be read.' },
  ),

  // Sessions sent to a calendar (the publish channel).
  'sync.sent.one': tpl('Sent 1 session, {unchanged} unchanged.', { unchanged: 'count' }),
  'sync.sent.many': tpl('Sent {sent} sessions, {unchanged} unchanged.', {
    sent: 'count',
    unchanged: 'count',
  }),
  'sync.not-sent': tpl('{n} could not be sent.', { n: 'count' }),

  // What the app itself writes as the message of a run (and as `Integration.lastError`); the server
  // renders them through `syncMessage`, so the lint covers them. What a service said stays a text
  // slot.
  'sync.msg.secret-changed': tpl('Reconnect: the session secret changed.'),
  'sync.msg.sync-unfinished': tpl('A sync did not finish.'),
  'sync.msg.push-unreadable': tpl('The pushed data could not be read.'),
  'sync.msg.push-none-stored': tpl(
    'None of the pushed activities could be stored: {reason}',
    { reason: 'text' },
    { shape: 'label', fallback: 'None of the pushed activities could be stored.' },
  ),
  'sync.msg.folder-none': tpl('No folder is configured.'),
  'sync.msg.folder-unreadable': tpl(
    'The watched folder is not a readable directory: {path}',
    { path: 'text' },
    { shape: 'label', fallback: 'The watched folder is not a readable directory.' },
  ),
  'sync.msg.files.one': tpl(
    '1 file could not be imported: {reason}',
    { reason: 'text' },
    { shape: 'label', fallback: '1 file could not be imported.' },
  ),
  'sync.msg.files.many': tpl(
    '{n} files could not be imported; the first: {reason}',
    { n: 'count', reason: 'text' },
    { shape: 'label', fallback: 'Some files could not be imported.' },
  ),
  'sync.msg.file-unreadable': tpl('The file could not be read.'),

  // The disclosure and its states.
  'sync.summary': tpl('Recent syncs', {}, { shape: 'label' }),
  'sync.loading': tpl('Loading recent syncs.'),
  'sync.load-error': tpl('Recent syncs did not load.'),
  'sync.retry': tpl('Try again', {}, { shape: 'label' }),
  'sync.empty': tpl('No syncs recorded yet.'),
  'sync.failures.one': tpl('Show the one that could not be imported', {}, { shape: 'label' }),
  'sync.failures.first': tpl('Showing the first {n}.', { n: 'count' }),
  'sync.failures.many': tpl(
    'Show the {n} that could not be imported',
    { n: 'count' },
    { shape: 'label' },
  ),
} satisfies Record<string, Template>
