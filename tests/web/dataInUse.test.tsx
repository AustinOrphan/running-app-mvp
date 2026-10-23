import { screen, waitFor } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import { dataInUseText } from '../../shared/copy/dataInUse.ts'
import { DataInUse } from '../../web/components/DataInUse.tsx'
import { expectCleanCopy, mockApi, renderWithProviders } from './helpers.tsx'
import { makeInputs, makeStateView } from './state-fixtures.ts'

async function shows(text: string): Promise<HTMLElement> {
  const status = await screen.findByRole('status')
  await waitFor(() => {
    expect(status).toHaveTextContent(text)
  })
  return status
}

describe('DataInUse', () => {
  test('says what the advice reads, with the latest day of each source', async () => {
    mockApi({ 'GET /api/state': () => makeStateView() })
    const { container } = renderWithProviders(<DataInUse />)

    const status = await shows(
      'Training advice reads 214 activities, the latest on 21 Oct, and 41 days of wellness, the latest on 22 Oct.',
    )
    expect(status).toHaveTextContent(/^Training advice reads [^]*\.$/)
    expectCleanCopy(container)
  })

  test('uses the singular for one activity and one day', async () => {
    mockApi({
      'GET /api/state': () =>
        makeStateView(
          makeInputs({
            activities: { windowDays: 365, count: 1, latest: '2026-10-21', flaggedDuplicates: 0 },
            wellness: { windowDays: 60, count: 1, latest: '2026-10-22' },
          }),
        ),
    })
    renderWithProviders(<DataInUse />)

    await shows(
      'Training advice reads 1 activity, the latest on 21 Oct, and 1 day of wellness, the latest on 22 Oct.',
    )
  })

  test('says so when there is no wellness data yet', async () => {
    mockApi({
      'GET /api/state': () =>
        makeStateView(makeInputs({ wellness: { windowDays: 60, count: 0, latest: null } })),
    })
    renderWithProviders(<DataInUse />)

    await shows('Training advice reads 214 activities, the latest on 21 Oct. No wellness data yet.')
  })

  test('points to a source or a file when there are no activities', async () => {
    mockApi({
      'GET /api/state': () =>
        makeStateView(
          makeInputs({
            activities: { windowDays: 365, count: 0, latest: null, flaggedDuplicates: 0 },
            wellness: { windowDays: 60, count: 0, latest: null },
          }),
        ),
    })
    const { container } = renderWithProviders(<DataInUse />)

    const status = await shows('No activities yet. Connect a source or import a file.')
    expect(status).not.toHaveTextContent('Training advice reads')
    expectCleanCopy(container)
  })

  test('still names wellness days when there are no activities', async () => {
    mockApi({
      'GET /api/state': () =>
        makeStateView(
          makeInputs({
            activities: { windowDays: 365, count: 0, latest: null, flaggedDuplicates: 0 },
          }),
        ),
    })
    renderWithProviders(<DataInUse />)

    await shows(
      'No activities yet. Connect a source or import a file. Training advice reads 41 days of wellness, the latest on 22 Oct.',
    )
  })

  test('names the flagged duplicates the advice leaves out', async () => {
    mockApi({
      'GET /api/state': () =>
        makeStateView(
          makeInputs({
            activities: { windowDays: 365, count: 214, latest: '2026-10-21', flaggedDuplicates: 3 },
          }),
        ),
    })
    const { container } = renderWithProviders(<DataInUse />)

    await shows(
      'Training advice reads 214 activities, the latest on 21 Oct, and 41 days of wellness, the latest on 22 Oct. 3 flagged duplicates are left out.',
    )
    expectCleanCopy(container)
  })

  test('uses the singular for one flagged duplicate', async () => {
    mockApi({
      'GET /api/state': () =>
        makeStateView(
          makeInputs({
            activities: { windowDays: 365, count: 214, latest: '2026-10-21', flaggedDuplicates: 1 },
          }),
        ),
    })
    renderWithProviders(<DataInUse />)

    await shows('1 flagged duplicate is left out.')
  })

  test('says the summary is loading until the server answers', async () => {
    mockApi({
      'GET /api/state': () => makeStateView(),
    })
    renderWithProviders(<DataInUse />)

    expect(screen.getByRole('status')).toHaveTextContent('Loading the data summary.')
    await shows('Training advice reads 214 activities')
  })

  test('says the summary did not load when the request fails', async () => {
    mockApi({
      'GET /api/state': () => ({
        status: 500,
        body: { error: { code: 'internal', message: 'Something went wrong.' } },
      }),
    })
    const { container } = renderWithProviders(<DataInUse />)

    await shows('The data summary did not load.')
    expectCleanCopy(container)
  })
})

describe('dataInUseText', () => {
  test('is built from templates, so every sentence ends with a stop', () => {
    const inputs = makeInputs({
      activities: { windowDays: 365, count: 2, latest: '2026-10-21', flaggedDuplicates: 2 },
    })
    const text = dataInUseText(inputs)
    expect(text).toBe(
      'Training advice reads 2 activities, the latest on 21 Oct, and 41 days of wellness, the latest on 22 Oct. 2 flagged duplicates are left out.',
    )
  })
})
