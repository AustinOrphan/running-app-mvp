import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { gzipSync, strToU8, zipSync } from 'fflate'
import { describe, expect, test } from 'vitest'
import type { ImportBatch, ParsedActivity } from '../../shared/types.ts'
import { ToastProvider } from '../../web/components/Toast.tsx'
import { processAppleExport } from '../../web/import/appleExport.ts'
import { batchParsed, MAX_PARSED_ACTIVITIES, uploadParsed } from '../../web/import/parsed.ts'
import { mergeReport } from '../../web/import/report.ts'
import {
  MAX_BATCH_BASE64_CHARS,
  MAX_BATCH_FILES,
  toBase64,
  uploadActivityFiles,
} from '../../web/import/files.ts'
import { ImportDialog } from '../../web/pages/ImportDialog.tsx'
import { mockApi, renderWithProviders, type MockRoutes } from './helpers.tsx'

const exportXml = readFileSync(join(process.cwd(), 'tests/fixtures/apple/export.xml'), 'utf8')

function batch(over: Partial<ImportBatch> = {}): ImportBatch {
  return {
    id: 'b1',
    userId: 'u1',
    source: 'file',
    fileName: null,
    rowCount: 1,
    accepted: 1,
    skippedDuplicate: 0,
    skippedInvalid: 0,
    errors: [],
    createdAt: '2026-03-10T12:00:00.000Z',
    ...over,
  }
}

function bytesOf(...values: number[]): Uint8Array {
  return Uint8Array.from(values)
}

function fromBase64(text: string): Uint8Array {
  return Uint8Array.from(Buffer.from(text, 'base64'))
}

function fileOf(name: string, data: Uint8Array | string): File {
  return new File([data as BlobPart], name)
}

const GPX = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="synthetic" xmlns="http://www.topografix.com/GPX/1/1">
 <trk><trkseg>
  <trkpt lat="0.0000" lon="0.0000"><ele>10</ele><time>2026-03-02T12:00:00Z</time></trkpt>
  <trkpt lat="0.0010" lon="0.0000"><ele>12</ele><time>2026-03-02T12:00:30Z</time></trkpt>
  <trkpt lat="0.0020" lon="0.0000"><ele>11</ele><time>2026-03-02T12:01:00Z</time></trkpt>
 </trkseg></trk>
</gpx>`

function renderDialog(routes: MockRoutes) {
  const api = mockApi({
    'GET /api/settings': () => ({ units: 'mi' }),
    ...routes,
  })
  renderWithProviders(
    <ToastProvider>
      <ImportDialog open onClose={() => {}} />
    </ToastProvider>,
  )
  return api
}

describe('uploadActivityFiles', () => {
  test('sends at most 20 files per request and chains the batch id', async () => {
    const files = Array.from({ length: 45 }, (_, i) => fileOf(`run-${i}.fit`, bytesOf(i, 1, 2)))
    const requests: Array<{ batchId?: string; names: string[] }> = []
    const progress: Array<{ done: number; found: number }> = []
    const summary = await uploadActivityFiles(
      files,
      (request) => {
        requests.push({
          ...(request.batchId === undefined ? {} : { batchId: request.batchId }),
          names: request.files.map((f) => f.name),
        })
        return Promise.resolve(batch({ accepted: request.files.length }))
      },
      { onProgress: (p) => progress.push({ done: p.done, found: p.found }) },
    )
    expect(MAX_BATCH_FILES).toBe(20)
    expect(requests.map((r) => r.names.length)).toEqual([20, 20, 5])
    expect(requests.map((r) => r.batchId)).toEqual([undefined, 'b1', 'b1'])
    expect(summary.sent).toBe(45)
    expect(progress.at(-1)).toEqual({ done: 45, found: 45 })
  })

  test('starts a new request when the base64 size would pass 12 MB', async () => {
    const big = new Uint8Array(5 * 1024 * 1024)
    const files = [1, 2, 3].map((i) => fileOf(`big-${i}.fit`, big))
    const sizes: number[] = []
    await uploadActivityFiles(files, (request) => {
      sizes.push(request.files.length)
      const chars = request.files.reduce((sum, f) => sum + f.dataBase64.length, 0)
      expect(chars).toBeLessThanOrEqual(MAX_BATCH_BASE64_CHARS)
      return Promise.resolve(batch())
    })
    expect(sizes).toEqual([1, 1, 1])
  })

  test('opens nested ZIPs and .gz files, and lists what it cannot use', async () => {
    const inner = zipSync({ 'a/inner.fit': bytesOf(1, 1), 'a/readme.txt': strToU8('hi') })
    const outer = zipSync({
      'x/nested.zip': inner,
      'x/ride.gpx.gz': gzipSync(strToU8(GPX)),
      'x/notes.json': strToU8('{}'),
      '__MACOSX/._junk': bytesOf(0),
    })
    const files = [
      fileOf('export.zip', outer),
      fileOf('lone.tcx', '<x/>'),
      fileOf('picture.png', bytesOf(9)),
    ]
    const sent: Array<{ name: string; bytes: Uint8Array }> = []
    const summary = await uploadActivityFiles(files, (request) => {
      for (const f of request.files) sent.push({ name: f.name, bytes: fromBase64(f.dataBase64) })
      return Promise.resolve(batch())
    })
    expect(sent.map((f) => f.name).sort()).toEqual([
      'export.zip/x/nested.zip/a/inner.fit',
      'export.zip/x/ride.gpx',
      'lone.tcx',
    ])
    expect(sent.find((f) => f.name.endsWith('inner.fit'))?.bytes).toEqual(bytesOf(1, 1))
    expect(new TextDecoder().decode(sent.find((f) => f.name.endsWith('ride.gpx'))?.bytes)).toBe(GPX)
    expect(summary.skipped.map((s) => s.name).sort()).toEqual([
      'export.zip/x/nested.zip/a/readme.txt',
      'export.zip/x/notes.json',
      'picture.png',
    ])
  })

  test('streams a ZIP larger than one read chunk', async () => {
    const big = new Uint8Array(10 * 1024 * 1024).map((_, i) => (i * 7919) % 251)
    const zip = zipSync({ 'a.fit': [bytesOf(1, 2, 3), { level: 0 }], 'b.fit': [big, { level: 0 }] })
    expect(zip.length).toBeGreaterThan(4 * 1024 * 1024)
    const sent: Array<{ name: string; chars: number }> = []
    const summary = await uploadActivityFiles([fileOf('many.zip', zip)], (request) => {
      for (const f of request.files) sent.push({ name: f.name, chars: f.dataBase64.length })
      return Promise.resolve(batch())
    })
    // 10 MiB is 14 million base64 characters, over the 12 MiB request limit.
    expect(sent.map((f) => f.name)).toEqual(['many.zip/a.fit'])
    expect(summary.skipped).toEqual([
      { name: 'many.zip/b.fit', reason: 'larger than 12 MB once encoded' },
    ])
  })

  test('lists a corrupt ZIP or GZ instead of failing the whole import', async () => {
    const files = [
      fileOf('broken.zip', bytesOf(1, 2, 3, 4)),
      fileOf('bad.fit.gz', bytesOf(1, 2, 3)),
    ]
    const summary = await uploadActivityFiles(files, () => Promise.resolve(batch()))
    expect(summary.sent).toBe(0)
    expect(summary.skipped.map((s) => s.name).sort()).toEqual(['bad.fit.gz', 'broken.zip'])
  })

  test('lists an entry with an unreadable compression method and reads the rest', async () => {
    const zip = zipSync({
      'odd.fit': [bytesOf(7, 7), { level: 0 }],
      'good.fit': [bytesOf(1, 2), { level: 0 }],
    })
    // The first local header's method field (offset 8) set to 9, Deflate64.
    zip[8] = 9
    const sent: string[] = []
    const summary = await uploadActivityFiles([fileOf('mixed.zip', zip)], (request) => {
      sent.push(...request.files.map((f) => f.name))
      return Promise.resolve(batch())
    })
    expect(sent).toEqual(['mixed.zip/good.fit'])
    expect(summary.skipped).toEqual([
      { name: 'mixed.zip/odd.fit', reason: 'could not be unzipped (compression method 9)' },
    ])
  })

  test('toBase64 handles large arrays', () => {
    const data = new Uint8Array(200_000).map((_, i) => i % 251)
    expect(fromBase64(toBase64(data))).toEqual(data)
  })
})

describe('uploadParsed', () => {
  function activity(i: number): ParsedActivity {
    return { providerKey: `apple:${i}` } as unknown as ParsedActivity
  }

  test('sends activities 200 at a time, then wellness 500 at a time, on one batch', async () => {
    const activities = Array.from({ length: 450 }, (_, i) => activity(i))
    const wellness = Array.from({ length: 501 }, (_, i) => ({
      date: `2026-01-${String((i % 28) + 1).padStart(2, '0')}`,
      restingHr: 50,
      hrvRmssd: null,
      hrvSdnn: null,
      sleepSec: null,
      sleepScore: null,
      weightKg: null,
      vo2max: null,
    }))
    const requests: Array<{ batchId?: string; activities: number; wellness: number }> = []
    let rows = 0
    const summary = await uploadParsed('apple-health', activities, wellness, (request) => {
      requests.push({
        ...(request.batchId === undefined ? {} : { batchId: request.batchId }),
        activities: request.activities.length,
        wellness: request.wellness.length,
      })
      expect(request.source).toBe('apple-health')
      rows += request.activities.length + request.wellness.length
      // The server answers with the batch's running totals.
      return Promise.resolve(batch({ rowCount: rows, accepted: rows }))
    })
    expect(MAX_PARSED_ACTIVITIES).toBe(200)
    expect(requests).toEqual([
      { activities: 200, wellness: 0 },
      { batchId: 'b1', activities: 200, wellness: 0 },
      { batchId: 'b1', activities: 50, wellness: 0 },
      { batchId: 'b1', activities: 0, wellness: 500 },
      { batchId: 'b1', activities: 0, wellness: 1 },
    ])
    expect(summary.batch?.accepted).toBe(951)
    expect(summary.wellnessDays).toBe(501)
  })

  test('starts a new request before the JSON passes about 8 MB', () => {
    // About 3 million characters each, so two fit in a request and a third does not.
    const heavy = {
      providerKey: 'apple:x',
      samples: { t: new Array(1_500_000).fill(1) },
    } as unknown as ParsedActivity
    expect(batchParsed([heavy, heavy, heavy, heavy]).map((b) => b.length)).toEqual([2, 2])
  })
})

describe('mergeReport', () => {
  test('replaces the report with running totals of the same batch', () => {
    const first = batch({ rowCount: 2, accepted: 2 })
    expect(mergeReport(first, batch({ rowCount: 5, accepted: 4 }))).toEqual(
      batch({ rowCount: 5, accepted: 4 }),
    )
  })

  test('adds a response for another batch to the report', () => {
    const merged = mergeReport(
      batch({ rowCount: 2, accepted: 1, errors: [{ line: null, reason: 'a' }] }),
      batch({ id: 'b2', rowCount: 3, accepted: 2, errors: [{ line: null, reason: 'b' }] }),
    )
    expect(merged).toMatchObject({ id: 'b1', rowCount: 5, accepted: 3 })
    expect(merged.errors.map((e) => e.reason)).toEqual(['a', 'b'])
  })
})

describe('Import dialog, activity files', () => {
  async function chooseKind(dialog: HTMLElement, name: string) {
    await userEvent.click(within(dialog).getByRole('radio', { name }))
  }

  test('uploads the chosen files, shows progress and one aggregated report', async () => {
    const api = renderDialog({
      'POST /api/imports/files': () => ({
        status: 201,
        body: batch({
          rowCount: 2,
          accepted: 1,
          skippedDuplicate: 1,
          errors: [{ line: null, reason: 'b.fit: already imported' }],
        }),
      }),
    })
    const dialog = await screen.findByRole('dialog', { name: 'Import activities' })
    await chooseKind(dialog, 'Activity files')
    const input = within(dialog).getByLabelText('Activity files (FIT, GPX, TCX, ZIP)')
    expect(input).toHaveAttribute('multiple')
    expect(within(dialog).getByRole('button', { name: 'Import files' })).toBeDisabled()
    // The picker's accept filter is bypassed, as with "All files" in a real file dialog.
    await userEvent
      .setup({ applyAccept: false })
      .upload(input, [
        fileOf('a.fit', bytesOf(1)),
        fileOf('b.fit', bytesOf(2)),
        fileOf('notes.txt', 'x'),
      ])
    await userEvent.click(within(dialog).getByRole('button', { name: 'Import files' }))
    expect(
      await within(dialog).findByText('1 imported, 1 already imported, 1 skipped'),
    ).toBeInTheDocument()
    expect(within(dialog).getByText('b.fit: already imported')).toBeInTheDocument()
    expect(
      within(dialog).getByText('notes.txt: not a FIT, GPX, TCX, ZIP or GZ file'),
    ).toBeInTheDocument()
    const post = api.calls.find((c) => c.url === '/api/imports/files')
    expect(post?.body).toEqual({
      files: [
        { name: 'a.fit', dataBase64: toBase64(bytesOf(1)) },
        { name: 'b.fit', dataBase64: toBase64(bytesOf(2)) },
      ],
    })
  })

  test('a failed request says how far it got and keeps the dialog open', async () => {
    renderDialog({
      'POST /api/imports/files': () => ({
        status: 500,
        body: { error: { code: 'internal', message: 'Database is busy.' } },
      }),
    })
    const dialog = await screen.findByRole('dialog')
    await chooseKind(dialog, 'Activity files')
    await userEvent.upload(
      within(dialog).getByLabelText('Activity files (FIT, GPX, TCX, ZIP)'),
      fileOf('a.fit', bytesOf(1)),
    )
    await userEvent.click(within(dialog).getByRole('button', { name: 'Import files' }))
    const alert = await within(dialog).findByRole('alert')
    expect(alert).toHaveTextContent('Database is busy.')
    expect(alert).toHaveTextContent('0 of 1 files')
    expect(within(dialog).getByRole('button', { name: 'Import files' })).toBeEnabled()
  })
})

function appleZip(): File {
  return fileOf(
    'export.zip',
    zipSync({
      'apple_health_export/export.xml': strToU8(exportXml),
      'apple_health_export/workout-routes/route_2026-03-02_7.00am.gpx': strToU8(GPX),
      'apple_health_export/export_cda.xml': strToU8('<ClinicalDocument/>'),
    }),
  )
}

describe('processAppleExport', () => {
  test('reads both workouts, wellness, heart rate and the matching route', async () => {
    const fractions: number[] = []
    const result = await processAppleExport(appleZip(), {
      timezone: 'UTC',
      onProgress: (p) => fractions.push(p.fraction),
    })
    expect(result.activities).toHaveLength(2)
    const first = result.activities[0] as ParsedActivity
    expect(first.startUtc).toBe('2026-03-02T12:00:00.000Z')
    expect(first.samples.hr?.length).toBeGreaterThan(0)
    expect(first.samples.alt).not.toBeNull()
    expect(result.activities[1]?.samples.alt).toBeNull()
    expect(result.wellness.map((w) => w.date)).toContain('2026-03-02')
    expect(result.routesMatched).toBe(1)
    expect(fractions.at(-1)).toBe(1)
    expect([...fractions].sort((a, b) => a - b)).toEqual(fractions)
  })

  test('also reads a bare export.xml', async () => {
    const result = await processAppleExport(fileOf('export.xml', exportXml), { timezone: 'UTC' })
    expect(result.activities).toHaveLength(2)
  })

  test('reads the DOCTYPE with an internal DTD that Apple writes at the top', async () => {
    const doctype = `<!DOCTYPE HealthData [
<!-- HealthKit Export Version: 13 -->
<!ELEMENT HealthData (ExportDate,Me,(Record|Workout)*)>
<!ATTLIST HealthData
  locale CDATA #REQUIRED
>
<!ELEMENT ExportDate EMPTY>
<!ATTLIST ExportDate
  value CDATA #REQUIRED
>
]>`
    const withDtd = exportXml.replace('<HealthData', `${doctype}\n<HealthData`)
    expect(withDtd).not.toBe(exportXml)
    const result = await processAppleExport(fileOf('export.xml', withDtd), { timezone: 'UTC' })
    expect(result.activities).toHaveLength(2)
  })

  test('says what to choose when the ZIP has no export.xml', async () => {
    const zip = fileOf('other.zip', zipSync({ 'readme.txt': strToU8('x') }))
    await expect(processAppleExport(zip, { timezone: 'UTC' })).rejects.toThrow(/export\.xml/)
  })
})

describe('Import dialog, Apple Health', () => {
  test('parses the export in the browser and posts parsed activities and wellness', async () => {
    const api = renderDialog({
      'POST /api/imports/parsed': (req) => {
        const body = req.body as { activities: unknown[] }
        return {
          status: 201,
          body: batch({
            source: 'apple-health',
            rowCount: body.activities.length,
            accepted: body.activities.length,
          }),
        }
      },
    })
    const dialog = await screen.findByRole('dialog', { name: 'Import activities' })
    await userEvent.click(within(dialog).getByRole('radio', { name: 'Apple Health' }))
    expect(within(dialog).getByText(/Export All Health Data/)).toBeInTheDocument()
    await userEvent.upload(
      within(dialog).getByLabelText('Apple Health export (export.zip)'),
      appleZip(),
    )
    await userEvent.click(within(dialog).getByRole('button', { name: 'Import export' }))
    expect(
      await within(dialog).findByText('2 imported, 0 already imported, 0 skipped'),
    ).toBeInTheDocument()
    expect(within(dialog).getByText(/wellness days/)).toBeInTheDocument()
    await waitFor(() => {
      expect(api.calls.some((c) => c.url === '/api/imports/parsed')).toBe(true)
    })
    const posts = api.calls.filter((c) => c.url === '/api/imports/parsed')
    const first = posts[0]?.body as {
      source: string
      activities: ParsedActivity[]
      wellness: unknown[]
    }
    expect(first.source).toBe('apple-health')
    expect(first.activities).toHaveLength(2)
    const wellnessSent = posts.reduce(
      (sum, p) => sum + (p.body as { wellness: unknown[] }).wellness.length,
      0,
    )
    expect(wellnessSent).toBeGreaterThan(0)
  })
})
