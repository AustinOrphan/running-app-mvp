import { gzipSync } from 'node:zlib'
import type { PrismaClient } from '../../server/db.ts'
import { encryptSecret, hashToken } from '../../server/crypto.ts'

/** The bytes of a stored original file, as uploaded: a tiny synthetic GPX. */
export const GPX_BYTES = Buffer.from(
  '<?xml version="1.0"?><gpx version="1.1"><trk><name>Synthetic</name></trk></gpx>\n',
)

export interface SeededSecrets {
  /** Strings that must appear nowhere in an archive. */
  secrets: string[]
  /** A string of the runner's own data that must appear in the archive. */
  ownMarker: string
}

/**
 * One runner with a row in every table the export covers, tagged by `tag` in the free-text
 * fields, and a secret in every column that holds one. `sessionSecret` encrypts the integration's
 * secret the way the app does.
 */
export async function seedEverything(
  prisma: PrismaClient,
  userId: string,
  tag: string,
  sessionSecret: string,
): Promise<SeededSecrets> {
  const plainSecret = `plain-api-key-${tag}-0123456789`
  const encrypted = encryptSecret(plainSecret, sessionSecret)
  const pushToken = `push-token-${tag}-abcdef`
  const feedHash = hashToken(`feed-token-${tag}-abcdef`)
  const ownMarker = `own-note-${tag}`

  const activity = await prisma.activity.create({
    data: {
      userId,
      date: '2026-03-02',
      startTime: '07:05',
      type: 'run',
      durationSec: 1805,
      distanceM: 5000,
      rpe: 5,
      rpeSource: 'watch',
      feel: 1,
      pain: 2,
      notes: ownMarker,
      terrainBins: JSON.stringify({ flat: 1 }),
      surfaceBins: JSON.stringify({ v: 1, trailM: 3100, pavedM: 500, roadM: 1400, unknownM: 0 }),
      hrQuality: JSON.stringify({ v: 1, source: 'wrist', movingSec: 1800, cleanSec: 1700 }),
      hrHistogram: JSON.stringify({ z1: 3 }),
    },
  })
  const second = await prisma.activity.create({
    data: { userId, date: '2026-03-03', type: 'strength', durationSec: 1800 },
  })
  await prisma.activityStream.create({
    data: {
      activityId: activity.id,
      sampleSec: 1,
      data: JSON.stringify({ hr: [120, 121] }),
      laps: JSON.stringify([{ lap: 1 }]),
    },
  })
  await prisma.activityTrack.create({
    data: {
      activityId: activity.id,
      v: 1,
      polyline: '_p~iF~ps|U_ulLnnqC',
      distM: JSON.stringify([0, 1000]),
      pointCount: 2,
      minLat: 38.5,
      minLng: -120.2,
      maxLat: 40.7,
      maxLng: -120.2,
      toleranceM: 5,
    },
  })
  await prisma.mapArea.create({
    data: {
      userId,
      minLat: 44.8,
      minLng: -93.2,
      maxLat: 45.2,
      maxLng: -92.8,
      fetchedAt: new Date('2026-11-09T10:00:00Z'),
      dataTimestamp: '2026-11-08T09:00:00Z',
      wayCount: 2,
      v: 1,
      matchV: 1,
    },
  })
  await prisma.mapWay.create({
    data: { userId, seq: 0, cls: 't', polyline: `way-polyline-${tag}` },
  })
  await prisma.activityFile.create({
    data: {
      activityId: activity.id,
      format: 'gpx',
      fileName: `morning-${tag}.gpx`,
      sizeBytes: GPX_BYTES.length,
      sha256: 'a'.repeat(64),
      gz: gzipSync(GPX_BYTES),
    },
  })
  await prisma.activityInsight.create({
    data: { activityId: activity.id, version: 1, facts: '{}', computedAt: new Date() },
  })
  const batch = await prisma.importBatch.create({
    data: {
      userId,
      source: 'csv',
      rowCount: 1,
      accepted: 1,
      skippedDuplicate: 0,
      skippedInvalid: 0,
      errors: '[]',
    },
  })
  await prisma.importedFile.create({
    data: { userId, sha256: 'b'.repeat(64), channel: 'upload', outcome: 'imported' },
  })
  await prisma.wellnessDay.create({
    data: { userId, date: '2026-03-02', source: 'manual', fatigue: 4, notes: ownMarker },
  })
  await prisma.weeklyReview.create({ data: { userId, weekStart: '2026-02-23', notes: ownMarker } })
  await prisma.screening.create({
    data: { userId, date: '2026-03-01', kind: 'reds', answers: '{"q1":true}', flags: 1 },
  })
  const goal = await prisma.goal.create({
    data: {
      userId,
      name: `Goal ${tag}`,
      priority: 'A',
      targetDate: '2026-09-12',
      distanceM: 42195,
    },
  })
  await prisma.raceResult.create({
    data: {
      userId,
      goalId: goal.id,
      date: '2026-09-12',
      distanceM: 42195,
      outcome: 'finished',
      timeSec: 12000,
    },
  })
  await prisma.raceCheckpoint.create({
    data: { userId, goalId: goal.id, name: `Checkpoint ${tag}`, distanceM: 10000 },
  })
  await prisma.predictionLog.create({
    data: {
      userId,
      goalId: goal.id,
      method: 'm',
      predictedSec: 12000,
      lowSec: 11000,
      highSec: 13000,
      weekStart: '2026-02-23',
      loggedOn: '2026-03-01',
    },
  })
  const plan = await prisma.plan.create({
    data: {
      userId,
      goalId: goal.id,
      name: `Plan ${tag}`,
      startDate: '2026-02-23',
      raceWeekStart: '2026-09-07',
      generatorVersion: 2,
    },
  })
  await prisma.planWeek.create({
    data: {
      planId: plan.id,
      weekStart: '2026-02-23',
      index: 0,
      phase: 'base',
      baselineRunMin: 100,
      targetRunMin: 110,
      longRunMin: 40,
      runDays: 4,
      strengthSessions: 1,
      tid: '{"z1":80}',
    },
  })
  const revision = await prisma.planRevision.create({
    data: {
      planId: plan.id,
      reason: 'generate',
      summary: `Revision ${tag}`,
      undo: '{"x":1}',
      paramsVersion: '2026-01-01.1',
    },
  })
  await prisma.planSession.create({
    data: {
      planId: plan.id,
      externalId: `ext-${tag}`,
      weekStart: '2026-02-23',
      date: '2026-03-02',
      order: 0,
      kind: 'easy',
      title: `Easy ${tag}`,
      durationMin: 30,
      target: '{}',
      purpose: 'p',
      activityId: activity.id,
      refusedActivityIds: JSON.stringify(['refused-1', 'refused-2']),
    },
  })
  await prisma.weeklyBrief.create({
    data: {
      userId,
      weekStart: '2026-02-23',
      revisionId: revision.id,
      version: 1,
      facts: '{"k":1}',
    },
  })
  await prisma.disruption.create({
    data: {
      userId,
      reason: 'travel',
      mode: 'rest',
      startDate: '2026-03-10',
      endDate: '2026-03-12',
      note: ownMarker,
    },
  })
  await prisma.athleteProfile.create({
    data: { userId, heightCm: 180, timezone: 'UTC', injuries: '[]' },
  })
  await prisma.strengthSettings.create({ data: { userId, note: ownMarker } })
  await prisma.strengthLift.create({
    data: {
      userId,
      exerciseId: 'goblet-squat',
      kind: 'set',
      loadG: 16000,
      reps: 8,
      asOf: '2026-03-01',
    },
  })
  const log = await prisma.strengthLog.create({
    data: { id: `log-${tag}`, userId, activityId: second.id, prescribed: '{}' },
  })
  await prisma.strengthSet.create({
    data: {
      logId: log.id,
      userId,
      exerciseId: 'goblet-squat',
      position: 0,
      loadG: 16000,
      count: 8,
    },
  })
  const product = await prisma.fuelProduct.create({
    data: { userId, name: `Gel ${tag}`, kind: 'gel', servingLabel: '1 gel', carbsG: 22 },
  })
  await prisma.fuelLog.create({
    data: {
      userId,
      activityId: activity.id,
      items: JSON.stringify([{ product: product.id }]),
      gut: 1,
    },
  })
  await prisma.fuelSettings.create({ data: { userId, optIn90: true } })
  await prisma.syncRun.create({
    data: {
      userId,
      provider: 'smashrun',
      channel: 'pull',
      trigger: 'manual',
      startedAt: new Date(),
      finishedAt: new Date(),
      status: 'ok',
      importBatchId: batch.id,
    },
  })
  await prisma.integration.create({
    data: {
      userId,
      provider: 'smashrun',
      status: 'connected',
      secret: encrypted,
      config: JSON.stringify({ athleteId: `config-marker-${tag}` }),
      ingestTokenHash: hashToken(pushToken),
      cursor: `cursor-marker-${tag}`,
      lastError: `last-error-marker-${tag}`,
      lastSyncStatus: 'ok',
    },
  })
  await prisma.deliveryChannel.create({
    data: {
      userId,
      channel: 'calendar',
      enabled: true,
      tokenHash: feedHash,
      referenceJson: `{"reference-marker-${tag}":1}`,
      dataKey: `data-key-marker-${tag}`,
    },
  })
  await prisma.wristPublication.create({
    data: {
      userId,
      channel: 'intervals',
      externalId: `ext-${tag}`,
      date: '2026-03-02',
      kind: 'easy',
      title: `Wrist ${tag}`,
      state: 'sent',
      desiredHash: 'h',
    },
  })

  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } })
  return {
    secrets: [
      plainSecret,
      encrypted,
      hashToken(pushToken),
      feedHash,
      user.passwordHash,
      sessionSecret,
      `config-marker-${tag}`,
      `cursor-marker-${tag}`,
      `last-error-marker-${tag}`,
      `reference-marker-${tag}`,
      `data-key-marker-${tag}`,
    ],
    ownMarker,
  }
}
