import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import type {
  Goal,
  GoalPriority,
  GoalStatus,
  GoalSurface,
  GoalType,
  SupportLevel,
} from '../../shared/types.ts'
import { api, keys } from './client.ts'

export interface GoalInput {
  name: string
  priority: GoalPriority
  status: GoalStatus
  targetDate: string
  dateProvisional: boolean
  distanceM?: number | null
  location?: string | null
  successCriteria?: string | null
  notes?: string | null
  url?: string | null
  /** Race descriptors for the training engine; the server defaults the omitted ones. */
  gainM?: number | null
  lossM?: number | null
  surface?: GoalSurface
  goalType?: GoalType
  targetTimeSec?: number | null
  startTime?: string | null
  raceLat?: number | null
  raceLng?: number | null
  supportLevel?: SupportLevel
}

/** The active goal decides which plan is shown, so goal changes refresh the plan too. */
function invalidateGoalData(queryClient: QueryClient): Promise<unknown> {
  return Promise.all(
    [keys.goals, keys.plan].map((key) => queryClient.invalidateQueries({ queryKey: [key] })),
  )
}

export function useGoals() {
  return useQuery({
    queryKey: [keys.goals],
    queryFn: () => api<Goal[]>('GET', '/goals'),
  })
}

export function useCreateGoal() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: GoalInput) => api<Goal>('POST', '/goals', input),
    onSuccess: () => invalidateGoalData(queryClient),
  })
}

export function useUpdateGoal() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: GoalInput }) =>
      api<Goal>('PUT', `/goals/${encodeURIComponent(id)}`, input),
    onSuccess: () => invalidateGoalData(queryClient),
  })
}

export function useDeleteGoal() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api<void>('DELETE', `/goals/${encodeURIComponent(id)}`),
    onSuccess: () => invalidateGoalData(queryClient),
  })
}

export function useActivateGoal() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api<Goal>('POST', `/goals/${encodeURIComponent(id)}/activate`),
    onSuccess: () => invalidateGoalData(queryClient),
  })
}
