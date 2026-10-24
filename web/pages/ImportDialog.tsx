import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { render } from '../../shared/copy/template.ts'
import { TEMPLATES } from '../../shared/copy/templates.ts'
import type { Units } from '../../shared/types.ts'
import { ApiError } from '../api/client.ts'
import { useImportFile, useImportFiles, useImportParsed } from '../api/imports.ts'
import { useSettings } from '../api/settings.ts'
import { Button } from '../components/Button.tsx'
import { Segmented } from '../components/Segmented.tsx'
import { Sheet } from '../components/Sheet.tsx'
import { startAppleExport } from '../import/appleHealthClient.ts'
import { uploadActivityFiles } from '../import/files.ts'
import { uploadParsed } from '../import/parsed.ts'
import styles from './ImportDialog.module.css'

export interface ImportDialogProps {
  open: boolean
  onClose: () => void
}

type Kind = 'smashrun' | 'csv' | 'files' | 'apple'

const KIND_OPTIONS: Array<{ value: Kind; label: string }> = [
  { value: 'smashrun', label: 'Smashrun' },
  { value: 'csv', label: 'Generic CSV' },
  { value: 'files', label: 'Activity files' },
  { value: 'apple', label: 'Apple Health' },
]

const UNIT_OPTIONS: Array<{ value: Units; label: string }> = [
  { value: 'mi', label: 'mi' },
  { value: 'km', label: 'km' },
]

/** The CSV API rejects bodies above 10 MB; say so before reading the file. */
const MAX_FILE_BYTES = 10 * 1024 * 1024
/** No import sentence holds a distance or a pace, so the unit system cannot change a word of it. */
const WORDS_UNITS: Units = 'km'
/** A re-import lists every skipped row; show a screenful and say how many more there are. */
const MAX_REASONS_SHOWN = 50

/** What the report screen shows, whichever kind of import produced it. */
interface Report {
  accepted: number
  duplicates: number
  skipped: number
  rows: string[]
  notes: string[]
}

interface Progress {
  label: string
  /** 0 to 1, or `null` while the total is not known. */
  fraction: number | null
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

function browserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

/** Closed, it renders nothing, so every opening starts without the previous file or report. */
export function ImportDialog(props: ImportDialogProps) {
  if (!props.open) return null
  return <ImportDialogSheet {...props} />
}

function ImportDialogSheet({ onClose }: ImportDialogProps) {
  const formId = useId()
  const settings = useSettings()
  const importFile = useImportFile()
  const importFiles = useImportFiles()
  const importParsed = useImportParsed()
  const [kind, setKind] = useState<Kind>('smashrun')
  // Until the runner picks a unit, the account setting decides (once it has loaded).
  const [pickedUnit, setPickedUnit] = useState<Units | null>(null)
  const unit = pickedUnit ?? settings.data?.units ?? 'mi'
  const [chosen, setChosen] = useState<File[]>([])
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<Progress | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [report, setReport] = useState<Report | null>(null)
  const cancel = useRef<(() => void) | null>(null)

  // Closing the dialog mid-import stops reading and sending; what the server has is kept.
  useEffect(
    () => () => {
      cancel.current?.()
    },
    [],
  )

  function pickKind(next: Kind) {
    setKind(next)
    setChosen([])
    setError(null)
  }

  async function submitCsv(file: File) {
    if (file.size > MAX_FILE_BYTES) {
      setError(
        render(
          TEMPLATES['import.error.too-large'],
          { mb: { kind: 'count', n: MAX_FILE_BYTES / (1024 * 1024) } },
          WORDS_UNITS,
        ),
      )
      return
    }
    try {
      const text = await file.text()
      const batch = await importFile.mutateAsync({
        kind: kind as 'smashrun' | 'csv',
        fileName: file.name,
        text,
        ...(kind === 'smashrun' ? { distanceUnit: unit } : {}),
      })
      setReport({
        accepted: batch.accepted,
        duplicates: batch.skippedDuplicate,
        skipped: batch.skippedInvalid,
        rows: batch.errors.map((row) =>
          row.line === null ? row.reason : `Line ${row.line}: ${row.reason}`,
        ),
        notes: [],
      })
    } catch (err) {
      const reason = err instanceof ApiError ? err.message : 'The file could not be read.'
      setError(render(TEMPLATES['import.error.csv'], { reason }, WORDS_UNITS))
    }
  }

  async function submitFiles(files: File[]) {
    const controller = new AbortController()
    cancel.current = () => controller.abort()
    let done = 0
    let found = 0
    try {
      const summary = await uploadActivityFiles(
        files,
        (request) => importFiles.mutateAsync(request),
        {
          signal: controller.signal,
          onProgress: (p) => {
            done = p.done
            found = p.found
            setProgress({
              label: `${done} of ${found} files${p.scanning ? ' so far' : ''}`,
              fraction: p.scanning || found === 0 ? null : done / found,
            })
          },
        },
      )
      const batch = summary.batch
      setReport({
        accepted: batch?.accepted ?? 0,
        duplicates: batch?.skippedDuplicate ?? 0,
        skipped: (batch?.skippedInvalid ?? 0) + summary.skipped.length,
        rows: [
          ...(batch?.errors.map((row) =>
            row.line === null ? row.reason : `Line ${row.line}: ${row.reason}`,
          ) ?? []),
          ...summary.skipped.map((entry) => `${entry.name}: ${entry.reason}`),
        ],
        notes: summary.sent === 0 ? ['No FIT, GPX or TCX file was found in the selection.'] : [],
      })
    } catch (err) {
      if (controller.signal.aborted) return
      const reason = err instanceof ApiError ? err.message : 'The files could not be read.'
      setError(
        render(
          TEMPLATES['import.error.files'],
          { reason, done: { kind: 'count', n: done }, found: { kind: 'count', n: found } },
          WORDS_UNITS,
        ),
      )
    }
  }

  async function submitApple(file: File) {
    const run = startAppleExport(file, browserTimezone(), (p) => {
      setProgress({
        label:
          p.phase === 'workouts'
            ? 'Reading workouts and daily values'
            : 'Reading heart rate and routes',
        fraction: p.fraction,
      })
    })
    const controller = new AbortController()
    cancel.current = () => {
      controller.abort()
      run.cancel()
    }
    try {
      const exported = await run.result
      const summary = await uploadParsed(
        'apple-health',
        exported.activities,
        exported.wellness,
        (request) => importParsed.mutateAsync(request),
        {
          signal: controller.signal,
          onProgress: (p) => {
            setProgress({
              label: `Sending ${p.sent} of ${p.total} records`,
              fraction: p.total === 0 ? null : p.sent / p.total,
            })
          },
        },
      )
      const batch = summary.batch
      setReport({
        accepted: batch?.accepted ?? 0,
        duplicates: batch?.skippedDuplicate ?? 0,
        skipped: batch?.skippedInvalid ?? 0,
        rows:
          batch?.errors.map((row) =>
            row.line === null ? row.reason : `Line ${row.line}: ${row.reason}`,
          ) ?? [],
        notes: [
          `${plural(summary.wellnessDays, 'wellness day', 'wellness days')} read from the export.`,
          `${plural(exported.routesMatched, 'workout', 'workouts')} matched to a route.`,
        ],
      })
    } catch (err) {
      if (controller.signal.aborted) return
      const reason =
        err instanceof ApiError || err instanceof Error
          ? err.message
          : 'The export could not be read.'
      setError(render(TEMPLATES['import.error.apple'], { reason }, WORDS_UNITS))
    }
  }

  async function submit() {
    const first = chosen[0]
    if (!first) return
    setError(null)
    setProgress(null)
    setBusy(true)
    try {
      if (kind === 'files') await submitFiles(chosen)
      else if (kind === 'apple') await submitApple(first)
      else await submitCsv(first)
    } finally {
      cancel.current = null
      setBusy(false)
      setProgress(null)
    }
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    void submit()
  }

  if (report) {
    const shown = report.rows.slice(0, MAX_REASONS_SHOWN)
    return (
      <Sheet
        open
        onClose={onClose}
        title="Import activities"
        footer={
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        }
      >
        <div className={styles.form}>
          <p className={styles.summary}>
            {`${report.accepted} imported, ${report.duplicates} already imported, ${report.skipped} skipped`}
          </p>
          {report.notes.map((note) => (
            <p key={note} className={styles.intro}>
              {note}
            </p>
          ))}
          {shown.length > 0 ? (
            <ul className={styles.reasons} aria-label="Row details">
              {shown.map((row, index) => (
                <li key={index}>{row}</li>
              ))}
            </ul>
          ) : null}
          {report.rows.length > shown.length ? (
            <p className={styles.more}>{`and ${report.rows.length - shown.length} more`}</p>
          ) : null}
        </div>
      </Sheet>
    )
  }

  const csv = kind === 'smashrun' || kind === 'csv'
  const inputLabel = csv
    ? 'CSV file'
    : kind === 'files'
      ? 'Activity files (FIT, GPX, TCX, ZIP)'
      : 'Apple Health export (export.zip)'
  const submitLabel = csv ? 'Import file' : kind === 'files' ? 'Import files' : 'Import export'
  const accept = csv
    ? '.csv,text/csv'
    : kind === 'files'
      ? '.fit,.gpx,.tcx,.zip,.gz'
      : '.zip,.xml,application/zip'
  const pending = busy || importFile.isPending

  return (
    <Sheet
      open
      onClose={onClose}
      title="Import activities"
      footer={
        <Button
          type="submit"
          form={formId}
          variant="primary"
          loading={pending}
          disabled={chosen.length === 0}
        >
          {submitLabel}
        </Button>
      }
    >
      <form id={formId} onSubmit={onSubmit} className={styles.form}>
        <p className={styles.intro}>
          {kind === 'apple'
            ? 'On the iPhone, open the Health app, tap your picture, then Export All Health Data, and choose the export.zip it makes. The file is read in this browser; only workouts and daily values are sent.'
            : kind === 'files'
              ? 'Pick FIT, GPX or TCX files, or a ZIP of them, such as the Garmin or Strava data export. Archives inside archives and .gz files are opened here.'
              : 'Rows already imported are skipped, so a file can be imported again safely.'}
        </p>
        <Segmented label="Source" options={KIND_OPTIONS} value={kind} onChange={pickKind} />
        {kind === 'smashrun' ? (
          <Segmented
            label="Distance unit in the file"
            options={UNIT_OPTIONS}
            value={unit}
            onChange={setPickedUnit}
          />
        ) : null}
        <div>
          <label htmlFor={`${formId}-file`} className={styles.fileLabel}>
            {inputLabel}
          </label>
          <input
            key={kind}
            id={`${formId}-file`}
            className={styles.file}
            type="file"
            accept={accept}
            multiple={kind === 'files'}
            disabled={pending}
            onChange={(e) => {
              setChosen(Array.from(e.target.files ?? []))
              setError(null)
            }}
          />
        </div>
        {progress !== null ? (
          <div className={styles.progress} role="status">
            <progress
              aria-label="Import progress"
              max={1}
              {...(progress.fraction === null ? {} : { value: progress.fraction })}
            />
            <span>{progress.label}</span>
          </div>
        ) : null}
        {error !== null ? (
          <p role="alert" className={styles.error}>
            {error}
          </p>
        ) : null}
      </form>
    </Sheet>
  )
}
