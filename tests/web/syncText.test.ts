import { describe, expect, test } from 'vitest'
import { lintText } from '../../shared/copy/lint.ts'
import type { SyncRunView, SyncStatus, SyncTrigger, WellnessStatus } from '../../shared/types.ts'
import { describeRun, failuresLabel, runHeading } from '../../web/components/syncText.ts'

function run(over: Partial<SyncRunView> = {}): SyncRunView {
  return {
    id: 'r1',
    provider: 'intervals',
    channel: 'pull',
    trigger: 'schedule',
    startedAt: new Date(2026, 9, 22, 6, 0).toISOString(),
    finishedAt: new Date(2026, 9, 22, 6, 1).toISOString(),
    status: 'ok',
    accepted: 0,
    duplicate: 0,
    failed: 0,
    wellnessStatus: 'none',
    wellnessDays: null,
    wellnessTotal: null,
    message: null,
    failures: [],
    importBatchId: null,
    ...over,
  }
}

describe('describeRun', () => {
  test.each([
    [
      'stored, skipped and read',
      { accepted: 3, duplicate: 1, wellnessStatus: 'read', wellnessDays: 7 },
      'Stored 3 new activities, skipped 1 already stored. Read 7 wellness days.',
    ],
    ['nothing at all', {}, 'Nothing new.'],
    [
      'nothing stored but wellness read',
      { wellnessStatus: 'read', wellnessDays: 4 },
      'Read 4 wellness days.',
    ],
    ['a wellness read of no days', { wellnessStatus: 'read', wellnessDays: 0 }, 'Nothing new.'],
    ['one activity', { accepted: 1 }, 'Stored 1 new activity.'],
    [
      'one activity and some skipped',
      { accepted: 1, duplicate: 2 },
      'Stored 1 new activity, skipped 2 already stored.',
    ],
    ['only duplicates', { duplicate: 3 }, 'Skipped 3 already stored.'],
    [
      'some could not be imported',
      { status: 'partial', accepted: 5, failed: 2 },
      'Stored 5 new activities. 2 could not be imported.',
    ],
    ['one wellness day', { wellnessStatus: 'read', wellnessDays: 1 }, 'Read 1 wellness day.'],
    [
      'wellness cut short by the service s limits',
      { status: 'paused', wellnessStatus: 'truncated', wellnessDays: 12, wellnessTotal: 30 },
      "Paused to stay within the service's limits. Read 12 of 30 wellness days; the rest follow on the next run.",
    ],
    [
      'wellness cut short before a single day',
      { status: 'paused', wellnessStatus: 'truncated', wellnessDays: 0, wellnessTotal: 30 },
      "Paused to stay within the service's limits. No wellness days read yet; they follow on the next run.",
    ],
    [
      'wellness waiting for the backfill',
      { status: 'paused', accepted: 40, wellnessStatus: 'waiting' },
      "Stored 40 new activities. Paused to stay within the service's limits. Wellness waits until the activity backfill finishes.",
    ],
    [
      'a run that did not finish',
      { status: 'error', message: 'The service answered HTTP 503.' },
      'Did not finish: The service answered HTTP 503.',
    ],
    [
      'a run that did not finish, with a message missing',
      { status: 'error', message: null },
      'Did not finish.',
    ],
    [
      'an error after some activities were stored',
      { status: 'error', accepted: 2, message: 'The service stopped answering.' },
      'Stored 2 new activities. Did not finish: The service stopped answering.',
    ],
    [
      'a wellness read that could not be read',
      {
        status: 'partial',
        accepted: 1,
        wellnessStatus: 'error',
        message: 'Wellness endpoint unavailable.',
      },
      'Stored 1 new activity. Wellness could not be read: Wellness endpoint unavailable.',
    ],
    [
      'a paused run whose wellness could not be read',
      { status: 'paused', wellnessStatus: 'error', message: null },
      "Paused to stay within the service's limits. Wellness could not be read.",
    ],
    [
      'sessions sent to the calendar',
      { channel: 'publish', accepted: 4, duplicate: 2 },
      'Sent 4 sessions, 2 unchanged.',
    ],
    [
      'one session sent to the calendar',
      { channel: 'publish', accepted: 1, duplicate: 0 },
      'Sent 1 session, 0 unchanged.',
    ],
    [
      'sessions that could not be sent',
      { channel: 'publish', status: 'partial', accepted: 3, duplicate: 1, failed: 2 },
      'Sent 3 sessions, 1 unchanged. 2 could not be sent.',
    ],
  ] satisfies Array<[string, Partial<SyncRunView>, string]>)('%s', (_label, over, expected) => {
    expect(describeRun(run(over))).toBe(expected)
  })

  test('every combination of status, wellness and counts reads clean, finished and never complete when it is not', () => {
    const statuses: SyncStatus[] = ['ok', 'partial', 'paused', 'error']
    const wellness: WellnessStatus[] = ['none', 'read', 'truncated', 'waiting', 'error']
    const triggers: SyncTrigger[] = ['schedule', 'manual', 'push', 'catchup']
    const counts = [0, 1, 2, 1284]
    let checked = 0
    for (const status of statuses) {
      for (const wellnessStatus of wellness) {
        for (const accepted of counts) {
          for (const duplicate of [0, 1, 5]) {
            for (const failed of [0, 1, 9]) {
              for (const channel of ['pull', 'push', 'folder', 'publish'] as const) {
                const view = run({
                  status,
                  wellnessStatus,
                  channel,
                  trigger: triggers[checked % triggers.length] ?? 'schedule',
                  accepted,
                  duplicate,
                  failed,
                  wellnessDays:
                    wellnessStatus === 'none' || wellnessStatus === 'waiting' ? null : 12,
                  wellnessTotal: wellnessStatus === 'truncated' ? 30 : null,
                  message: status === 'ok' ? null : 'The service asked the app to wait.',
                })
                const sentence = describeRun(view)
                expect(sentence.length, sentence).toBeGreaterThan(0)
                expect(lintText(sentence), sentence).toEqual([])
                expect(sentence, sentence).not.toMatch(/undefined|NaN|\{|\}|null/)
                expect(sentence, sentence).toMatch(/[.?]$|: The service asked the app to wait\.$/)
                if (status === 'paused' && channel !== 'publish') {
                  expect(sentence, sentence).toContain('Paused')
                }
                if (status === 'error') expect(sentence, sentence).toContain('Did not finish')
                checked += 1
              }
            }
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(1000)
  })

  test('a truncated run never reads as a complete one', () => {
    const sentence = describeRun(
      run({ status: 'paused', wellnessStatus: 'truncated', wellnessDays: 12, wellnessTotal: 30 }),
    )
    expect(sentence).toContain('12 of 30')
    expect(sentence).toContain('the rest follow')
    expect(sentence).not.toContain('Nothing new')
  })
})

describe('runHeading', () => {
  test.each([
    ['schedule', 'pull', '22 Oct, 06:00 · Scheduled'],
    ['manual', 'pull', '22 Oct, 06:00 · Manual'],
    ['push', 'push', '22 Oct, 06:00 · Push'],
    ['catchup', 'job', '22 Oct, 06:00 · Catch-up'],
    ['schedule', 'folder', '22 Oct, 06:00 · Folder scan'],
    ['manual', 'folder', '22 Oct, 06:00 · Folder scan'],
    ['schedule', 'publish', '22 Oct, 06:00 · Sent to calendar'],
  ] as const)('%s on the %s channel', (trigger, channel, expected) => {
    expect(runHeading(run({ trigger, channel }))).toBe(expected)
    expect(lintText(expected)).toEqual([])
  })

  test('pads the time and shows the reader s local day', () => {
    expect(runHeading(run({ startedAt: new Date(2026, 0, 5, 7, 4).toISOString() }))).toBe(
      '5 Jan, 07:04 · Scheduled',
    )
  })
})

describe('failuresLabel', () => {
  test('counts the failures', () => {
    expect(failuresLabel(1)).toBe('Show the one that could not be imported')
    expect(failuresLabel(3)).toBe('Show the 3 that could not be imported')
    expect(lintText(failuresLabel(3))).toEqual([])
  })
})
