import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, test, vi } from 'vitest'
import {
  useCreateDisruption,
  useRemoveDisruption,
  useUpdateDisruption,
} from '../../web/api/disruptions.ts'
import { useActivateGoal } from '../../web/api/goals.ts'
import {
  useAdjustSession,
  useGeneratePlan,
  useLinkPlanSession,
  useReplan,
  useRestorePlan,
  useUndoRevision,
  useUpdatePlanWeek,
} from '../../web/api/plan.ts'
import { useSaveReview } from '../../web/api/reviews.ts'
import { useAcceptZoneProposal, useDeclineZoneProposal } from '../../web/api/zones.ts'
import { mockApi } from './helpers.tsx'

// The brief describes the plan, so every write that changes the plan reads it again. A brief that
// stayed cached after a new plan would still describe the old one.

interface Case {
  label: string
  route: string
  /** Runs the write; the hook is rendered inside the providers. */
  run: (wrapper: ({ children }: { children: ReactNode }) => ReactNode) => Promise<unknown>
}

async function mutate<TVariables>(
  hook: () => { mutateAsync: (variables: TVariables) => Promise<unknown> },
  variables: TVariables,
  wrapper: ({ children }: { children: ReactNode }) => ReactNode,
) {
  const { result } = renderHook(hook, { wrapper })
  await act(async () => {
    await result.current.mutateAsync(variables)
  })
}

const CASES: Case[] = [
  {
    label: 'generating a plan',
    route: 'POST /api/plan/generate',
    run: (wrapper) => mutate(useGeneratePlan, { goalId: 'g1' }, wrapper),
  },
  {
    label: 'editing a week of the plan',
    route: 'PUT /api/plan/weeks/2027-01-11',
    run: (wrapper) =>
      mutate(useUpdatePlanWeek, { weekStart: '2027-01-11', patch: { targetRunMin: 200 } }, wrapper),
  },
  {
    label: 'saving a review',
    route: 'PUT /api/reviews/2027-01-11',
    run: (wrapper) => mutate(useSaveReview, { weekStart: '2027-01-11', patch: {} }, wrapper),
  },
  {
    label: 'restoring an archived plan',
    route: 'POST /api/plan/archived/p1/restore',
    run: (wrapper) => mutate(useRestorePlan, 'p1', wrapper),
  },
  {
    label: 'activating a goal and replacing the plan',
    route: 'POST /api/goals/g1/activate',
    run: (wrapper) => mutate(useActivateGoal, { id: 'g1', replacePlan: true }, wrapper),
  },
  {
    label: 'a re-plan',
    route: 'POST /api/plan/replan',
    run: (wrapper) => mutate(useReplan, undefined, wrapper),
  },
  {
    label: 'an edit of one session',
    route: 'POST /api/plan/sessions/s1/adjust',
    run: (wrapper) =>
      mutate(
        useAdjustSession,
        { id: 's1', adjustment: { type: 'skip' }, expectHash: 'a'.repeat(64) },
        wrapper,
      ),
  },
  {
    label: 'opening a rest window',
    route: 'POST /api/plan/disruptions',
    run: (wrapper) =>
      mutate(
        useCreateDisruption,
        {
          reason: 'illness-above-neck',
          mode: 'rest',
          startDate: '2027-01-12',
          endDate: '2027-01-14',
        },
        wrapper,
      ),
  },
  {
    label: 'changing a rest window',
    route: 'PATCH /api/plan/disruptions/d1',
    run: (wrapper) => mutate(useUpdateDisruption, { id: 'd1', endDate: '2027-01-15' }, wrapper),
  },
  {
    label: 'removing a rest window',
    route: 'DELETE /api/plan/disruptions/d1',
    run: (wrapper) => mutate(useRemoveDisruption, { id: 'd1' }, wrapper),
  },
  {
    label: 'accepting a zone proposal',
    route: 'POST /api/zones/proposals/z1/accept',
    run: (wrapper) => mutate(useAcceptZoneProposal, 'z1', wrapper),
  },
  {
    label: 'declining a zone proposal',
    route: 'POST /api/zones/proposals/z1/decline',
    run: (wrapper) => mutate(useDeclineZoneProposal, 'z1', wrapper),
  },
  {
    label: 'linking a run to a session',
    route: 'POST /api/plan/sessions/s1/link',
    run: (wrapper) => mutate(useLinkPlanSession, { id: 's1', activityId: 'a1' }, wrapper),
  },
  {
    label: 'an undo',
    route: 'POST /api/plan/revisions/r1/undo',
    run: (wrapper) => mutate(useUndoRevision, { id: 'r1', expectHash: 'a'.repeat(64) }, wrapper),
  },
]

describe('plan-changing writes refresh the brief', () => {
  test.each(CASES)('$label', async ({ route, run }) => {
    mockApi({ [route]: () => ({}) })
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    })
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    )
    await run(wrapper)
    const keys = invalidate.mock.calls.map(
      ([filter]) => (filter as { queryKey: string[] }).queryKey[0],
    )
    expect(keys).toContain('brief')
  })
})
