import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, test } from 'vitest'
import type { JobsView } from '../../shared/types.ts'
import { keys } from '../../web/api/client.ts'
import { useJobs } from '../../web/api/jobs.ts'
import { mockApi } from './helpers.tsx'

describe('useJobs', () => {
  test('reads the latest job runs and the weekly update under its own key', async () => {
    const view: JobsView = {
      jobs: [
        {
          id: 'j1',
          provider: 'replan',
          channel: 'job',
          trigger: 'catchup',
          startedAt: '2026-10-19T08:00:00.000Z',
          finishedAt: '2026-10-19T08:00:01.000Z',
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
        },
      ],
      weeklyUpdate: { due: false, lastRevisionAt: '2026-10-19T08:00:01.000Z' },
    }
    const { calls } = mockApi({ 'GET /api/jobs': () => view })
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const { result } = renderHook(() => useJobs(), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      ),
    })

    await waitFor(() => {
      expect(result.current.data).toEqual(view)
    })
    expect(calls).toEqual([{ method: 'GET', url: '/api/jobs', body: undefined }])
    expect(queryClient.getQueryData([keys.jobs])).toEqual(view)
  })
})
