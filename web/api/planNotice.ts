import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { PlanNoticeConfirm, PlanNoticeView } from '../../shared/types.ts'
import { api, keys } from './client.ts'

/** The health notice before a first plan: whether it stands confirmed and what the age needs (FS1). */
export function usePlanNotice(options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: [keys.planNotice],
    queryFn: () => api<PlanNoticeView>('GET', '/plan-notice'),
    enabled: options.enabled ?? true,
  })
}

/** Stores the confirmation; the plan page then shows the generate form instead of the notice. */
export function useConfirmPlanNotice() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: PlanNoticeConfirm) => api<PlanNoticeView>('PUT', '/plan-notice', input),
    onSuccess: (view) => {
      queryClient.setQueryData([keys.planNotice], view)
    },
  })
}
