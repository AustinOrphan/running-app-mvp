import { useId, useRef, useState, type ChangeEvent } from 'react'
import { describeRaceCourse } from '../../../shared/copy/racePlan.ts'
import { P } from '../../../shared/engine/params/index.ts'
import type { Units } from '../../../shared/types.ts'
import { Button } from '../Button.tsx'
import type { CourseImport } from './courseImport.ts'
import styles from './CourseImportButton.module.css'

export interface CourseImportButtonProps {
  units: Units
  /** The goal's distance in metres. */
  goalDistanceM: number
  /** Called with the rows and the profile once a file has been read. */
  onRead: (course: CourseImport) => void
}

type State = { kind: 'idle' } | { kind: 'reading' } | { kind: 'error'; message: string }

/**
 * "Import course GPX": a button that opens the file picker. The file is read in this browser, by a
 * module loaded on the first choice so the XML parser is not in the page's first load; nothing is
 * sent. A file the page cannot use gets one sentence in a live region next to the button.
 */
export function CourseImportButton({ units, goalDistanceM, onRead }: CourseImportButtonProps) {
  const words = describeRaceCourse(units)
  const input = useRef<HTMLInputElement>(null)
  const statusId = useId()
  const [state, setState] = useState<State>({ kind: 'idle' })

  async function choose(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    // The same file can be chosen again after a fix, so the field is emptied.
    event.target.value = ''
    if (file === undefined) return
    setState({ kind: 'reading' })
    try {
      const loaded = await import('./courseImport.ts')
      try {
        const course = await loaded.readCourseFile(file, {
          units,
          max: P.r1.maxCheckpoints.value,
          goalDistanceM,
          nameFor: words.pointName,
        })
        setState({ kind: 'idle' })
        onRead(course)
      } catch (error) {
        const large = error instanceof loaded.CourseFileError && error.reason === 'large'
        setState({
          kind: 'error',
          message: large ? words.errLarge(loaded.COURSE_FILE_MAX_MB) : words.errUnreadable,
        })
      }
    } catch {
      // The module itself did not load (offline with no copy of the chunk): the same sentence.
      setState({ kind: 'error', message: words.errUnreadable })
    }
  }

  return (
    <div className={styles.wrap}>
      <input
        ref={input}
        type="file"
        accept=".gpx,application/gpx+xml,application/xml,text/xml"
        hidden
        tabIndex={-1}
        aria-label={words.fileLabel}
        onChange={(event) => {
          void choose(event)
        }}
      />
      <Button
        busy={state.kind === 'reading'}
        aria-describedby={statusId}
        onClick={() => {
          input.current?.click()
        }}
      >
        {words.importLabel}
      </Button>
      {/* The region is always on the page, so a sentence added to it is announced. */}
      <p
        id={statusId}
        role={state.kind === 'error' ? 'alert' : 'status'}
        className={state.kind === 'error' ? styles.error : styles.status}
      >
        {state.kind === 'reading' ? words.reading : state.kind === 'error' ? state.message : ''}
      </p>
    </div>
  )
}
