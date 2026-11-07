import { useId, useState, type FormEvent } from 'react'
import { PACES_TEMPLATES, pacesText } from '../../../shared/copy/myPaces.ts'
import { render } from '../../../shared/copy/template.ts'
import type { Units } from '../../../shared/types.ts'
import {
  PACES_CUSTOM_GAIN_MAX_M,
  PACES_CUSTOM_MAX_M,
  PACES_CUSTOM_MIN_M,
} from '../../../shared/limits.ts'
import type { CustomCourse as Course } from '../../api/paces.ts'
import { distanceInputText, parseDistance, parseMetres } from '../goalFormat.ts'
import { Button } from '../Button.tsx'
import { Field, Input } from '../Field.tsx'
import styles from './Paces.module.css'

export interface CustomCourseProps {
  units: Units
  course: Course | null
  onCourse: (course: Course | null) => void
}

/**
 * A distance of the runner's own, in their units, with the climb in metres when there is one. The
 * form checks what it can before it asks (the server checks again): a distance that is not a
 * number, or outside the bounds of a course, and a climb that is not whole metres.
 */
export function CustomCourse({ units, course, onCourse }: CustomCourseProps) {
  const formId = useId()
  const [distance, setDistance] = useState(
    course === null ? '' : distanceInputText(course.distanceM, units),
  )
  const [climb, setClimb] = useState(course?.gainM == null ? '' : String(course.gainM))
  const [errors, setErrors] = useState<{ distance?: string; climb?: string }>({})

  function submit(event: FormEvent): void {
    event.preventDefault()
    const metres = parseDistance(distance, units)
    const gain = parseMetres(climb)
    const next: { distance?: string; climb?: string } = {}
    if (metres === null) next.distance = pacesText('paces.custom.distance-error')
    else if (metres < PACES_CUSTOM_MIN_M || metres > PACES_CUSTOM_MAX_M) {
      next.distance = pacesText('paces.custom.range-error')
    }
    if (gain === undefined || (gain !== null && gain > PACES_CUSTOM_GAIN_MAX_M)) {
      next.climb = pacesText('paces.custom.climb-error')
    }
    setErrors(next)
    if (next.distance !== undefined || next.climb !== undefined) return
    onCourse({ distanceM: metres ?? 0, gainM: gain === undefined ? null : gain })
  }

  function clear(): void {
    setDistance('')
    setClimb('')
    setErrors({})
    onCourse(null)
  }

  return (
    <form
      id={formId}
      className={styles.form}
      onSubmit={submit}
      noValidate
      aria-label={pacesText('paces.custom.heading')}
    >
      <Field
        label={render(PACES_TEMPLATES['paces.custom.distance'], { unit: units }, units)}
        {...(errors.distance === undefined ? {} : { error: errors.distance })}
      >
        {(control) => (
          <Input
            {...control}
            inputMode="decimal"
            autoComplete="off"
            value={distance}
            onChange={(event) => {
              setDistance(event.target.value)
            }}
          />
        )}
      </Field>
      <Field
        label={pacesText('paces.custom.climb')}
        {...(errors.climb === undefined ? {} : { error: errors.climb })}
      >
        {(control) => (
          <Input
            {...control}
            inputMode="numeric"
            autoComplete="off"
            value={climb}
            onChange={(event) => {
              setClimb(event.target.value)
            }}
          />
        )}
      </Field>
      <div className={styles.actions}>
        <Button type="submit" variant="primary">
          {pacesText('paces.custom.submit')}
        </Button>
        {course === null ? null : (
          <Button onClick={clear}>{pacesText('paces.custom.clear')}</Button>
        )}
      </div>
    </form>
  )
}
