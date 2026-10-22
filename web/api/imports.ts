import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  ActivitySource,
  ImportBatch,
  ParsedActivity,
  Units,
  WellnessInput,
} from '../../shared/types.ts'
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

export interface ImportFilesRequest {
  /** Appends to an earlier batch of the same upload (at most an hour old). */
  batchId?: string
  /** At most 20 files and 12 MB of base64 per request. */
  files: Array<{ name: string; dataBase64: string }>
}

export interface ImportParsedRequest {
  batchId?: string
  source: ActivitySource
  /** At most 500 activities per request. */
  activities: ParsedActivity[]
  wellness: WellnessInput[]
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

function invalidateImportData(queryClient: ReturnType<typeof useQueryClient>): Promise<unknown> {
  return Promise.all([
    invalidateActivityData(queryClient),
    queryClient.invalidateQueries({ queryKey: [keys.imports] }),
    queryClient.invalidateQueries({ queryKey: [keys.wellness] }),
  ])
}

/** Uploads activity files (FIT, GPX, TCX) as base64 JSON. */
export function useImportFiles() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (request: ImportFilesRequest) =>
      api<ImportBatch>('POST', '/imports/files', request),
    onSuccess: () => invalidateImportData(queryClient),
  })
}

/** Sends activities and wellness rows that the browser parsed from an export. */
export function useImportParsed() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (request: ImportParsedRequest) =>
      api<ImportBatch>('POST', '/imports/parsed', request),
    onSuccess: () => invalidateImportData(queryClient),
  })
}
