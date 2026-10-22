import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { ImportBatch, Units } from '../../shared/types.ts'
import { invalidateActivityData } from './activities.ts'
import { api, keys } from './client.ts'

export interface ImportFileRequest {
  kind: 'smashrun' | 'csv'
  fileName: string
  /** The whole CSV file as text. */
  text: string
  /** Read by the smashrun importer only; the server defaults to the user's units. */
  distanceUnit?: Units
}

export function useImports() {
  return useQuery({
    queryKey: [keys.imports],
    queryFn: () => api<ImportBatch[]>('GET', '/imports'),
  })
}

export function useImportFile() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ kind, ...body }: ImportFileRequest) =>
      api<ImportBatch>('POST', `/imports/${kind}`, body),
    onSuccess: () =>
      Promise.all([
        invalidateActivityData(queryClient),
        queryClient.invalidateQueries({ queryKey: [keys.imports] }),
      ]),
  })
}
