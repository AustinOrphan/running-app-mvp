import { useId, useState, type FormEvent } from 'react'
import type { ImportBatch, Units } from '../../shared/types.ts'
import { ApiError } from '../api/client.ts'
import { useImportFile } from '../api/imports.ts'
import { useSettings } from '../api/settings.ts'
import { Button } from '../components/Button.tsx'
import { Segmented } from '../components/Segmented.tsx'
import { Sheet } from '../components/Sheet.tsx'
import styles from './ImportDialog.module.css'

export interface ImportDialogProps {
  open: boolean
  onClose: () => void
}

type Kind = 'smashrun' | 'csv'

const KIND_OPTIONS: Array<{ value: Kind; label: string }> = [
  { value: 'smashrun', label: 'Smashrun' },
  { value: 'csv', label: 'Generic CSV' },
]

const UNIT_OPTIONS: Array<{ value: Units; label: string }> = [
  { value: 'mi', label: 'mi' },
  { value: 'km', label: 'km' },
]

/** The API rejects bodies above 10 MB; say so before reading the file. */
const MAX_FILE_BYTES = 10 * 1024 * 1024
/** A re-import lists every skipped row; show a screenful and say how many more there are. */
const MAX_REASONS_SHOWN = 50

/** Closed, it renders nothing, so every opening starts without the previous file or report. */
export function ImportDialog(props: ImportDialogProps) {
  if (!props.open) return null
  return <ImportDialogSheet {...props} />
}

function ImportDialogSheet({ onClose }: ImportDialogProps) {
  const formId = useId()
  const settings = useSettings()
  const importFile = useImportFile()
  const [kind, setKind] = useState<Kind>('smashrun')
  // Until the runner picks a unit, the account setting decides (once it has loaded).
  const [pickedUnit, setPickedUnit] = useState<Units | null>(null)
  const unit = pickedUnit ?? settings.data?.units ?? 'mi'
  const [file, setFile] = useState<File | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [report, setReport] = useState<ImportBatch | null>(null)

  async function submit() {
    if (!file) return
    setError(null)
    if (file.size > MAX_FILE_BYTES) {
      setError('Import failed. The file is larger than 10 MB. Split it and import the parts.')
      return
    }
    try {
      const text = await file.text()
      const batch = await importFile.mutateAsync({
        kind,
        fileName: file.name,
        text,
        ...(kind === 'smashrun' ? { distanceUnit: unit } : {}),
      })
      setReport(batch)
    } catch (err) {
      const reason = err instanceof ApiError ? err.message : 'The file could not be read.'
      setError(`Import failed. ${reason} Nothing was imported; try again.`)
    }
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    void submit()
  }

  if (report) {
    const shown = report.errors.slice(0, MAX_REASONS_SHOWN)
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
            {`${report.accepted} imported, ${report.skippedDuplicate} already imported, ${report.skippedInvalid} skipped`}
          </p>
          {shown.length > 0 ? (
            <ul className={styles.reasons} aria-label="Row details">
              {shown.map((row, index) => (
                <li key={index}>
                  {row.line === null ? row.reason : `Line ${row.line}: ${row.reason}`}
                </li>
              ))}
            </ul>
          ) : null}
          {report.errors.length > shown.length ? (
            <p className={styles.more}>{`and ${report.errors.length - shown.length} more`}</p>
          ) : null}
        </div>
      </Sheet>
    )
  }

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
          loading={importFile.isPending}
          disabled={file === null}
        >
          Import file
        </Button>
      }
    >
      <form id={formId} onSubmit={onSubmit} className={styles.form}>
        <p className={styles.intro}>
          Rows already imported are skipped, so a file can be imported again safely.
        </p>
        <Segmented label="Source" options={KIND_OPTIONS} value={kind} onChange={setKind} />
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
            CSV file
          </label>
          <input
            id={`${formId}-file`}
            className={styles.file}
            type="file"
            accept=".csv,text/csv"
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null)
              setError(null)
            }}
          />
        </div>
        {error !== null ? (
          <p role="alert" className={styles.error}>
            {error}
          </p>
        ) : null}
      </form>
    </Sheet>
  )
}
