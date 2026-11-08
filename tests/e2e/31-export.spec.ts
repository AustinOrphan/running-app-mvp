import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { unzipSync } from 'fflate'
import { createPrisma } from '../../server/db.ts'
import { RUNNER, resetData, signedInApi } from './helpers.ts'
import { E2E_DATABASE_URL } from './env.ts'

// Settings > Your data > "Download all your data": the button downloads one ZIP of the runner's
// records, with a README, a JSON file per table and the activity CSV, and no secret in it.

const SECRET = 'e2e-integration-secret-marker'

test('Download all your data saves a ZIP with the runner records and no secret', async ({
  page,
  baseURL,
}) => {
  const api = await signedInApi(page, baseURL ?? '')
  await resetData()
  await api.post('/activities', {
    date: '2026-03-02',
    startTime: '07:05',
    type: 'run',
    durationSec: 1800,
    distanceM: 5000,
    notes: 'export-e2e-note',
  })
  const prisma = createPrisma(E2E_DATABASE_URL)
  try {
    const user = await prisma.user.findUniqueOrThrow({ where: { email: RUNNER.email } })
    await prisma.integration.create({
      data: {
        userId: user.id,
        provider: 'smashrun',
        status: 'connected',
        secret: SECRET,
        config: '{}',
        ingestTokenHash: SECRET,
      },
    })
  } finally {
    await prisma.$disconnect()
  }

  await page.goto('/settings')
  await expect(page.getByText(/leaves out your password and the keys and tokens/)).toBeVisible()
  const downloading = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download all your data' }).click()
  const download = await downloading
  expect(download.suggestedFilename()).toMatch(/^running-log-export-\d{4}-\d{2}-\d{2}\.zip$/)
  await expect(page.getByText('Archive downloaded.')).toBeVisible()

  const path = await download.path()
  const bytes = readFileSync(path)
  const files = unzipSync(new Uint8Array(bytes))
  const text = (name: string) => Buffer.from(files[name] ?? new Uint8Array()).toString('utf8')

  for (const name of [
    'README.txt',
    'export-info.json',
    'activities.csv',
    'activities.json',
    'settings.json',
    'integrations.json',
    'plans.json',
    'wellness.json',
  ]) {
    expect(Object.keys(files), name).toContain(name)
  }
  expect(text('README.txt')).toContain('metres')
  expect(text('activities.csv')).toContain('2026-03-02,07:05,run,30.00,3.1069')
  const activities = JSON.parse(text('activities.json')) as { notes: string }[]
  expect(activities.map((a) => a.notes)).toEqual(['export-e2e-note'])
  expect(JSON.parse(text('settings.json'))).toMatchObject({ email: RUNNER.email })
  const integrations = JSON.parse(text('integrations.json')) as { provider: string }[]
  expect(integrations.map((i) => i.provider)).toEqual(['smashrun'])
  for (const name of Object.keys(files)) expect(text(name), name).not.toContain(SECRET)
  expect(bytes.includes(SECRET)).toBe(false)
})
