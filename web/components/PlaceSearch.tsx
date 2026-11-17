import { useState } from 'react'
import { placeLabel } from '../../shared/copy/places.ts'
import { render } from '../../shared/copy/template.ts'
import { TEMPLATES } from '../../shared/copy/templates.ts'
import { ApiError } from '../api/client.ts'
import { usePlaceSearch, type PlaceMatch } from '../api/places.ts'
import { Button } from './Button.tsx'
import { Field, Input } from './Field.tsx'
import styles from './PlaceSearch.module.css'
import { useOnline } from './useOnline.ts'

const MIN_QUERY = 2

export interface PlaceSearchProps {
  /** Called with the chosen match; the page fills its draft fields and saves as usual. */
  onChoose: (place: PlaceMatch) => void
}

type PlainId =
  | 'places.unavailable'
  | 'places.search.label'
  | 'places.search.list'
  | 'places.search.button'
  | 'places.search.too-short'
  | 'places.search.none'
  | 'places.search.results'
  | 'places.search.offline'

const say = (id: PlainId): string => render(TEMPLATES[id], {}, 'km')

/**
 * Search a town or postcode and choose a match (PL2, ADR 0024). The search runs on the button or
 * Enter only, never per keystroke: each one is an outside request. Choosing fills the page's
 * coordinate fields and saves nothing. It sits inside the page's form, so it is not a form itself.
 */
export function PlaceSearch({ onChoose }: PlaceSearchProps) {
  const [query, setQuery] = useState('')
  const [line, setLine] = useState<string | undefined>()
  const [chosen, setChosen] = useState<string | undefined>()
  const search = usePlaceSearch()
  const online = useOnline()

  function submit() {
    if (search.isPending) return
    setChosen(undefined)
    search.reset()
    if (query.trim().length < MIN_QUERY) {
      setLine(say('places.search.too-short'))
      return
    }
    if (!online) {
      setLine(say('places.search.offline'))
      return
    }
    setLine(undefined)
    search.mutate(query.trim(), {
      onError: (error) => {
        // The 502 carries the app's own sentence; anything else (no network) is the offline line.
        setLine(
          error instanceof ApiError && error.status === 502
            ? say('places.unavailable')
            : say('places.search.offline'),
        )
      },
    })
  }

  const places = search.data
  let status = line
  if (status === undefined && chosen !== undefined) status = chosen
  if (status === undefined && places !== undefined) {
    status = places.length === 0 ? say('places.search.none') : say('places.search.results')
  }

  return (
    <div className={styles.search}>
      <div className={styles.row}>
        <Field label={say('places.search.label')}>
          {(control) => (
            <Input
              {...control}
              type="text"
              autoComplete="off"
              value={query}
              maxLength={80}
              onChange={(event) => {
                setQuery(event.target.value)
              }}
              onKeyDown={(event) => {
                if (event.key !== 'Enter') return
                event.preventDefault()
                submit()
              }}
            />
          )}
        </Field>
        <Button loading={search.isPending} onClick={submit}>
          {say('places.search.button')}
        </Button>
      </div>
      <p className={styles.status} role="status" aria-live="polite">
        {status}
      </p>
      {places !== undefined && places.length > 0 && line === undefined && chosen === undefined ? (
        <ul className={styles.results} aria-label={say('places.search.list')}>
          {places.map((place) => {
            const label = placeLabel(place)
            return (
              <li key={`${place.lat},${place.lng},${label}`}>
                <Button
                  className={styles.result}
                  aria-label={label}
                  onClick={() => {
                    setChosen(render(TEMPLATES['places.search.chosen'], { place: label }, 'km'))
                    onChoose(place)
                  }}
                >
                  {label}
                </Button>
              </li>
            )
          })}
        </ul>
      ) : null}
    </div>
  )
}
