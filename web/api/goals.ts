import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import type {
  ActivateRequiresPlan,
  Goal,
  GoalPriority,
  GoalStatus,
  GoalSurface,
  GoalType,
  SupportLevel,
} from '../../shared/types.ts'
import { api, ApiError, invalidateNewPlan, keys } from './client.ts'

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

/**
 * What a goal write moves. The active goal decides which plan is shown, so the plan is read again.
 * The goal's distance, climb, surface, place and date are what the race prediction is computed
 * from, and the countdown on Today and in the weekly brief is built from the goal, so those are
 * read again too. A goal edit records no plan revision, so this stays apart from
 * `invalidatePlanReaders`.
 */
const GOAL_KEYS = [keys.goals, keys.plan, keys.predictions, keys.today, keys.brief] as const

function invalidateGoalData(queryClient: QueryClient): Promise<unknown> {
  return Promise.all(GOAL_KEYS.map((key) => queryClient.invalidateQueries({ queryKey: [key] })))
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

export interface ActivateGoalRequest {
  id: string
  /** Agree to build the plan for this goal when the plan follows another goal. */
  replacePlan?: boolean
}

/**
 * Makes a goal active. While a plan follows another goal the server answers 409 with
 * `details.requires === 'replacePlan'` (`replacePlanRequired` reads it); asking again with
 * `replacePlan` builds the plan for the goal and archives the old one.
 */
export function useActivateGoal() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, replacePlan = false }: ActivateGoalRequest) =>
      api<Goal>(
        'POST',
        `/goals/${encodeURIComponent(id)}/activate`,
        replacePlan ? { replacePlan: true } : undefined,
      ),
    onSuccess: (_goal, { replacePlan }) =>
      replacePlan === true ? invalidateNewPlan(queryClient) : invalidateGoalData(queryClient),
  })
}

/** The goal the plan follows, when an error is the 409 that asks for `replacePlan`; else null. */
export function replacePlanRequired(error: unknown): ActivateRequiresPlan | null {
  if (!(error instanceof ApiError) || error.status !== 409) return null
  const details = error.details as Partial<ActivateRequiresPlan> | undefined
  return details?.requires === 'replacePlan' &&
    typeof details.planGoalId === 'string' &&
    typeof details.planGoalName === 'string'
    ? {
        requires: 'replacePlan',
        planGoalId: details.planGoalId,
        planGoalName: details.planGoalName,
      }
    : null
}
