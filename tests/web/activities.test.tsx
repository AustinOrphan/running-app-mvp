import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, test } from 'vitest'
import { todayIso } from '../../shared/dates.ts'
import type { Activity, ImportBatch, Units } from '../../shared/types.ts'
import { ToastProvider } from '../../web/components/Toast.tsx'
import { ActivitiesPage } from '../../web/pages/ActivitiesPage.tsx'
import { parseDistanceInput, parseDurationInput } from '../../web/pages/ActivityForm.tsx'
import { ImportDialog } from '../../web/pages/ImportDialog.tsx'
import { makeActivity } from '../factories.ts'
import { mockApi, renderWithProviders, type MockRoutes } from './helpers.tsx'

function settings(units: Units) {
  return { email: 'runner@example.com', displayName: null, units }
}

function renderPage(opts: {
  route?: string
  activities?: Activity[]
  units?: Units
  routes?: MockRoutes
}) {
  const api = mockApi({
    'GET /api/settings': () => settings(opts.units ?? 'mi'),
    'GET /api/activities': () => opts.activities ?? [],
    ...opts.routes,
  })
  renderWithProviders(
    <ToastProvider>
      <ActivitiesPage />
    </ToastProvider>,
    { route: opts.route ?? '/activities' },
  )
  return api
}

function batch(over: Partial<ImportBatch> = {}): ImportBatch {
  return {
    id: 'b1',
    userId: 'u1',
    source: 'smashrun',
    fileName: 'runs.csv',
    rowCount: 3,
    accepted: 3,
    skippedDuplicate: 0,
    skippedInvalid: 0,
    errors: [],
    createdAt: '2026-03-02T12:00:00.000Z',
    ...over,
  }
}

describe('parseDurationInput', () => {
  test.each([
    ['45', 2700],
    ['90', 5400],
    ['45:30', 2730],
    ['1:05:30', 3930],
    ['0:45:00', 2700],
    [' 45 ', 2700],
    ['', null],
    ['0', null],
    ['abc', null],
    ['1:75', null],
    ['1:75:00', null],
    ['1:05:75', null],
    ['49:00:00', null],
    ['48:00:00', 172800],
    ['-5', null],
  ])('%j -> %j', (text, expected) => {
    expect(parseDurationInput(text)).toBe(expected)
  })
})

describe('parseDistanceInput', () => {
  test('5 mi -> 8047, 5,2 km -> 5200, "-1" and "abc" -> null', () => {
    expect(parseDistanceInput('5', 'mi')).toBe(8047)
    expect(parseDistanceInput('5.2', 'km')).toBe(5200)
    expect(parseDistanceInput('5,2', 'km')).toBe(5200)
    expect(parseDistanceInput('-1', 'km')).toBeNull()
    expect(parseDistanceInput('abc', 'mi')).toBeNull()
    expect(parseDistanceInput('', 'mi')).toBeNull()
    expect(parseDistanceInput('0', 'mi')).toBeNull()
  })
})

describe('Activities page', () => {
  test('empty list shows "No activities yet." with Log and Import actions, never an error', async () => {
    renderPage({})
    expect(await screen.findByText('No activities yet.')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Activities', level: 1 })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Log activity' })).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Import' }))
    expect(await screen.findByRole('dialog', { name: 'Import activities' })).toBeInTheDocument()
  })

  test('rows show date, type, duration, distance and pace in the user units (mi and km)', async () => {
    const rows = [
      makeActivity({ id: 'r1', date: '2026-03-02', durationSec: 2700, distanceM: 8047 }),
      makeActivity({
        id: 'r2',
        date: '2026-03-02',
        type: 'strength',
        durationSec: 1800,
        distanceM: null,
      }),
      makeActivity({
        id: 'r3',
        date: '2026-03-01',
        type: 'cross',
        durationSec: 3600,
        distanceM: null,
      }),
    ]
    renderPage({ activities: rows })
    expect(await screen.findByRole('heading', { name: /^Mon 2 Mar/ })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /^Sun 1 Mar/ })).toBeInTheDocument()
    expect(screen.getByText('45:00')).toBeInTheDocument()
    expect(screen.getByText('5.00 mi')).toBeInTheDocument()
    expect(screen.getByText('9:00 /mi')).toBeInTheDocument()
    expect(screen.getByText('30:00')).toBeInTheDocument()
    // Strength has no pace; a cross row with no distance shows an en dash.
    expect(screen.getAllByText(/\/mi$/)).toHaveLength(1)
    expect(screen.getByText('–')).toBeInTheDocument()
  })

  test('km users see km and pace per km', async () => {
    renderPage({
      units: 'km',
      activities: [makeActivity({ durationSec: 2700, distanceM: 8047 })],
    })
    expect(await screen.findByText('8.05 km')).toBeInTheDocument()
    expect(screen.getByText('5:36 /km')).toBeInTheDocument()
  })

  test('quick log: date defaults to today, type Run, entering 45 and 5 posts the entry and toasts "Run saved"', async () => {
    const user = userEvent.setup()
    const api = renderPage({
      routes: { 'POST /api/activities': () => ({ status: 201, body: makeActivity() }) },
    })
    await user.click(await screen.findByRole('button', { name: 'Log activity' }))
    const dialog = await screen.findByRole('dialog', { name: 'Log activity' })
    expect(within(dialog).getByLabelText('Date')).toHaveValue(todayIso())
    expect(within(dialog).getByRole('radio', { name: 'Run' })).toBeChecked()
    expect(within(dialog).getByLabelText('Distance (mi)')).toBeInTheDocument()

    await user.type(within(dialog).getByLabelText('Duration'), '45')
    await user.type(within(dialog).getByLabelText('Distance (mi)'), '5')
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(api.calls.filter((c) => c.method === 'POST')).toHaveLength(1)
    })
    expect(api.calls.find((c) => c.method === 'POST')?.body).toEqual({
      date: todayIso(),
      type: 'run',
      durationSec: 2700,
      distanceM: 8047,
    })
    expect(await screen.findByText('Run saved')).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
  })

  test('an invalid duration shows the hint under Duration and posts nothing; the sheet keeps the entries when the server fails', async () => {
    const user = userEvent.setup()
    const api = renderPage({
      routes: {
        'POST /api/activities': () => ({
          status: 500,
          body: { error: { code: 'internal', message: 'The server did not respond.' } },
        }),
      },
    })
    await user.click(await screen.findByRole('button', { name: 'Log activity' }))
    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByLabelText('Duration'), 'abc')
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))
    expect(within(dialog).getByText('Enter minutes like 45, or 0:45:00')).toBeInTheDocument()
    expect(within(dialog).getByLabelText('Duration')).toHaveAttribute('aria-invalid', 'true')
    expect(api.calls.filter((c) => c.method === 'POST')).toHaveLength(0)

    await user.clear(within(dialog).getByLabelText('Duration'))
    await user.type(within(dialog).getByLabelText('Duration'), '30')
    await user.type(within(dialog).getByLabelText('Distance (mi)'), '3')
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'Activity not saved. The server did not respond.',
    )
    expect(within(dialog).getByLabelText('Duration')).toHaveValue('30')
    expect(within(dialog).getByLabelText('Distance (mi)')).toHaveValue('3')
    expect(screen.queryByText('Run saved')).not.toBeInTheDocument()
  })

  test('Strength hides Distance; the distance label follows the units', async () => {
    const user = userEvent.setup()
    renderPage({ units: 'km' })
    await user.click(await screen.findByRole('button', { name: 'Log activity' }))
    const dialog = await screen.findByRole('dialog')
    expect(await within(dialog).findByLabelText('Distance (km)')).toBeInTheDocument()
    await user.click(within(dialog).getByRole('radio', { name: 'Strength' }))
    expect(within(dialog).queryByLabelText(/^Distance/)).not.toBeInTheDocument()
  })

  test('More details holds Start time, RPE chips 1 to 10, Average HR, Max HR, Elevation gain and Notes', async () => {
    const user = userEvent.setup()
    const api = renderPage({
      routes: { 'POST /api/activities': () => ({ status: 201, body: makeActivity() }) },
    })
    await user.click(await screen.findByRole('button', { name: 'Log activity' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).queryByLabelText('Start time')).not.toBeInTheDocument()

    await user.click(within(dialog).getByRole('button', { name: 'More details' }))
    expect(within(dialog).getByLabelText('Start time')).toBeInTheDocument()
    expect(within(dialog).getByLabelText('Average HR')).toBeInTheDocument()
    expect(within(dialog).getByLabelText('Max HR')).toBeInTheDocument()
    expect(within(dialog).getByLabelText('Elevation gain (ft)')).toBeInTheDocument()
    expect(within(dialog).getByLabelText('Notes')).toBeInTheDocument()
    const chips = within(within(dialog).getByRole('group', { name: 'RPE' })).getAllByRole('button')
    expect(chips.map((c) => c.textContent)).toEqual([
      '1',
      '2',
      '3',
      '4',
      '5',
      '6',
      '7',
      '8',
      '9',
      '10',
    ])

    await user.type(within(dialog).getByLabelText('Duration'), '50')
    fireEvent.change(within(dialog).getByLabelText('Start time'), { target: { value: '06:30' } })
    await user.click(within(dialog).getByRole('button', { name: '7' }))
    await user.type(within(dialog).getByLabelText('Average HR'), '150')
    await user.type(within(dialog).getByLabelText('Max HR'), '172')
    await user.type(within(dialog).getByLabelText('Elevation gain (ft)'), '100')
    await user.type(within(dialog).getByLabelText('Notes'), 'Easy loop')
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() => {
      expect(api.calls.filter((c) => c.method === 'POST')).toHaveLength(1)
    })
    expect(api.calls.find((c) => c.method === 'POST')?.body).toEqual({
      date: todayIso(),
      startTime: '06:30',
      type: 'run',
      durationSec: 3000,
      rpe: 7,
      avgHr: 150,
      maxHr: 172,
      elevationGainM: 30,
      notes: 'Easy loop',
    })
  })

  test('editing an imported row PUTs; an untouched distance is sent back exactly', async () => {
    const user = userEvent.setup()
    const row = makeActivity({
      id: 'imp1',
      source: 'smashrun',
      providerKey: 'smashrun:1',
      durationSec: 1800,
      distanceM: 5000,
      date: '2026-03-02',
    })
    const api = renderPage({
      activities: [row],
      routes: { 'PUT /api/activities/imp1': () => row },
    })
    await user.click(await screen.findByRole('button', { name: /3\.11 mi/ }))
    const dialog = await screen.findByRole('dialog', { name: 'Edit activity' })
    expect(within(dialog).getByLabelText('Duration')).toHaveValue('30:00')
    await user.clear(within(dialog).getByLabelText('Duration'))
    await user.type(within(dialog).getByLabelText('Duration'), '31')
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() => {
      expect(api.calls.filter((c) => c.method === 'PUT')).toHaveLength(1)
    })
    expect(api.calls.find((c) => c.method === 'PUT')?.body).toEqual({
      date: '2026-03-02',
      type: 'run',
      durationSec: 1860,
      distanceM: 5000,
    })
  })

  test('Delete asks for confirmation; deleting a manual row toasts "Activity deleted" with Undo that re-posts it', async () => {
    const user = userEvent.setup()
    const row = makeActivity({ id: 'a1', durationSec: 2700, distanceM: 8047, rpe: 6 })
    const api = renderPage({
      activities: [row],
      routes: {
        'DELETE /api/activities/a1': () => ({ status: 204, body: undefined }),
        'POST /api/activities': () => ({ status: 201, body: row }),
      },
    })
    await user.click(await screen.findByRole('button', { name: /5\.00 mi/ }))
    const dialog = await screen.findByRole('dialog', { name: 'Edit activity' })
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }))
    expect(within(dialog).getByText('Delete this activity?')).toBeInTheDocument()
    expect(api.calls.filter((c) => c.method === 'DELETE')).toHaveLength(0)

    await user.click(within(dialog).getByRole('button', { name: 'Delete activity' }))
    expect(await screen.findByText('Activity deleted')).toBeInTheDocument()
    expect(api.calls.filter((c) => c.method === 'DELETE')).toHaveLength(1)

    await user.click(screen.getByRole('button', { name: 'Undo' }))
    await waitFor(() => {
      expect(api.calls.filter((c) => c.method === 'POST')).toHaveLength(1)
    })
    expect(api.calls.find((c) => c.method === 'POST')?.body).toEqual({
      date: '2026-03-02',
      type: 'run',
      durationSec: 2700,
      distanceM: 8047,
      rpe: 6,
    })
  })

  test('a failed Undo says the activity was not restored', async () => {
    const user = userEvent.setup()
    const row = makeActivity({ id: 'a1', durationSec: 2700, distanceM: 8047 })
    renderPage({
      activities: [row],
      routes: {
        'DELETE /api/activities/a1': () => ({ status: 204, body: undefined }),
        'POST /api/activities': () => ({
          status: 500,
          body: { error: { code: 'internal', message: 'The server did not respond.' } },
        }),
      },
    })
    await user.click(await screen.findByRole('button', { name: /5\.00 mi/ }))
    const dialog = await screen.findByRole('dialog', { name: 'Edit activity' })
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }))
    await user.click(within(dialog).getByRole('button', { name: 'Delete activity' }))
    await user.click(await screen.findByRole('button', { name: 'Undo' }))
    expect(
      await screen.findByText('Activity not restored. The server did not respond.'),
    ).toBeInTheDocument()
  })

  test('a possible duplicate shows a badge with "Confirm duplicate" and "Not a duplicate" buttons that POST the status', async () => {
    const user = userEvent.setup()
    const flagged = makeActivity({
      id: 'dup1',
      duplicateStatus: 'possible',
      duplicateOfId: 'imp1',
    })
    const api = renderPage({
      activities: [flagged],
      routes: {
        'POST /api/activities/dup1/duplicate': () => ({ ...flagged, duplicateStatus: 'confirmed' }),
      },
    })
    expect(await screen.findByText('Possible duplicate')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Confirm duplicate' }))
    await waitFor(() => {
      expect(api.calls.filter((c) => c.method === 'POST')).toHaveLength(1)
    })
    expect(api.calls.find((c) => c.method === 'POST')?.body).toEqual({ status: 'confirmed' })

    await user.click(screen.getByRole('button', { name: 'Not a duplicate' }))
    await waitFor(() => {
      expect(api.calls.filter((c) => c.method === 'POST')).toHaveLength(2)
    })
    expect(api.calls.filter((c) => c.method === 'POST')[1]?.body).toEqual({ status: 'dismissed' })
  })

  test('?new=1 opens the sheet', async () => {
    renderPage({ route: '/activities?new=1' })
    expect(await screen.findByRole('dialog', { name: 'Log activity' })).toBeInTheDocument()
  })

  test('?duplicates=1 shows only rows waiting for a decision', async () => {
    renderPage({
      route: '/activities?duplicates=1',
      activities: [
        makeActivity({ id: 'ok1', durationSec: 3600, distanceM: 10000 }),
        makeActivity({
          id: 'dup2',
          durationSec: 1800,
          distanceM: 5000,
          duplicateStatus: 'possible',
        }),
      ],
    })
    expect(await screen.findByText('Possible duplicate')).toBeInTheDocument()
    expect(screen.getByText('30:00')).toBeInTheDocument()
    expect(screen.queryByText('1:00:00')).not.toBeInTheDocument()
  })

  test('filters send type, from and to to the server', async () => {
    const user = userEvent.setup()
    const api = renderPage({ activities: [makeActivity()] })
    await screen.findByText('30:00')
    await user.click(screen.getByRole('radio', { name: 'Race' }))
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-03-01' } })
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-03-31' } })
    await waitFor(() => {
      expect(api.calls.at(-1)?.url).toBe('/api/activities?from=2026-03-01&to=2026-03-31&type=race')
    })
  })
})

describe('Import dialog', () => {
  const csv = 'Run Id,Start Date,Distance\n1001,26/03/02 6:30,3\n'

  function renderDialog(routes: MockRoutes, units: Units = 'mi') {
    const api = mockApi({ 'GET /api/settings': () => settings(units), ...routes })
    renderWithProviders(
      <ToastProvider>
        <ImportDialog open onClose={() => {}} />
      </ToastProvider>,
    )
    return api
  }

  async function chooseFile(dialog: HTMLElement, name = 'runs.csv') {
    await userEvent.upload(
      within(dialog).getByLabelText('CSV file'),
      new File([csv], name, { type: 'text/csv' }),
    )
  }

  test('choosing a file and Import file posts JSON { fileName, text, distanceUnit } then shows the counts', async () => {
    const api = renderDialog({
      'POST /api/imports/smashrun': () => ({ status: 201, body: batch() }),
    })
    const dialog = await screen.findByRole('dialog', { name: 'Import activities' })
    expect(within(dialog).getByRole('button', { name: 'Import file' })).toBeDisabled()
    await chooseFile(dialog)
    await userEvent.click(within(dialog).getByRole('button', { name: 'Import file' }))
    expect(
      await within(dialog).findByText('3 imported, 0 already imported, 0 skipped'),
    ).toBeInTheDocument()
    expect(api.calls.find((c) => c.method === 'POST')?.body).toEqual({
      fileName: 'runs.csv',
      text: csv,
      distanceUnit: 'mi',
    })
  })

  test('the unit defaults to the user setting and can be changed', async () => {
    const api = renderDialog(
      { 'POST /api/imports/smashrun': () => ({ status: 201, body: batch() }) },
      'km',
    )
    const dialog = await screen.findByRole('dialog')
    await waitFor(() => {
      expect(within(dialog).getByRole('radio', { name: 'km' })).toBeChecked()
    })
    await userEvent.click(within(dialog).getByRole('radio', { name: 'mi' }))
    await chooseFile(dialog)
    await userEvent.click(within(dialog).getByRole('button', { name: 'Import file' }))
    await within(dialog).findByText(/imported/)
    expect(api.calls.find((c) => c.method === 'POST')?.body).toMatchObject({ distanceUnit: 'mi' })
  })

  test('Generic CSV posts to /imports/csv without a distance unit', async () => {
    const api = renderDialog({
      'POST /api/imports/csv': () => ({ status: 201, body: batch({ source: 'csv' }) }),
    })
    const dialog = await screen.findByRole('dialog')
    await userEvent.click(within(dialog).getByRole('radio', { name: 'Generic CSV' }))
    expect(within(dialog).queryByRole('radio', { name: 'km' })).not.toBeInTheDocument()
    await chooseFile(dialog, 'a.csv')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Import file' }))
    await within(dialog).findByText(/imported/)
    const post = api.calls.find((c) => c.method === 'POST')
    expect(post?.url).toBe('/api/imports/csv')
    expect(post?.body).toEqual({ fileName: 'a.csv', text: csv })
  })

  test('per-row reasons are listed with their line numbers', async () => {
    renderDialog({
      'POST /api/imports/smashrun': () => ({
        status: 201,
        body: batch({
          rowCount: 4,
          accepted: 2,
          skippedDuplicate: 1,
          skippedInvalid: 1,
          errors: [
            { line: 3, reason: 'Distance must be above 0' },
            { line: null, reason: 'already imported (smashrun:1001)' },
          ],
        }),
      }),
    })
    const dialog = await screen.findByRole('dialog')
    await chooseFile(dialog)
    await userEvent.click(within(dialog).getByRole('button', { name: 'Import file' }))
    expect(
      await within(dialog).findByText('2 imported, 1 already imported, 1 skipped'),
    ).toBeInTheDocument()
    expect(within(dialog).getByText('Line 3: Distance must be above 0')).toBeInTheDocument()
    expect(within(dialog).getByText('already imported (smashrun:1001)')).toBeInTheDocument()
  })

  test('a failed import says so and keeps the chosen file', async () => {
    renderDialog({
      'POST /api/imports/smashrun': () => ({
        status: 400,
        body: { error: { code: 'validation', message: 'The file has no rows.' } },
      }),
    })
    const dialog = await screen.findByRole('dialog')
    await chooseFile(dialog)
    await userEvent.click(within(dialog).getByRole('button', { name: 'Import file' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'Import failed. The file has no rows.',
    )
    expect(within(dialog).getByRole('button', { name: 'Import file' })).toBeEnabled()
  })
})
