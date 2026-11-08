import { act, fireEvent } from '@testing-library/react'
import { expect, test, vi } from 'vitest'
import { encodePolyline } from '../../shared/importers/files/track.ts'
import { RunMap } from '../../web/components/map/RunMap.tsx'
import { renderWithProviders } from './helpers.tsx'

// RunMap on its own, with the network coming and going: the tiles follow the browser's state, and
// tiles that failed are asked for again once the network is back.

const LOOP: Array<[number, number]> = [
  [12.3456, -45.6789],
  [12.3476, -45.6759],
]

test('the tiles leave when the browser goes offline and come back, failed ones included, online', () => {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(
    () => ({ width: 360, height: 240 }) as DOMRect,
  )
  let online = true
  vi.spyOn(navigator, 'onLine', 'get').mockImplementation(() => online)
  const { container } = renderWithProviders(
    <RunMap
      track={{
        activityId: 'a',
        v: 1,
        polyline: encodePolyline(LOOP),
        distM: [0, 300],
        pointCount: 2,
        bbox: { minLat: 12.3456, minLng: -45.6789, maxLat: 12.3476, maxLng: -45.6759 },
        endsHiddenM: 0,
      }}
      units="km"
      distanceM={300}
    />,
  )
  const tiles = () => Array.from(container.querySelectorAll('img'))
  expect(tiles().length).toBeGreaterThan(0)
  for (const tile of tiles()) fireEvent.error(tile)
  expect(container.querySelector('figcaption')?.textContent).toContain('did not load')

  online = false
  act(() => {
    window.dispatchEvent(new Event('offline'))
  })
  expect(tiles()).toHaveLength(0)
  expect(container.querySelector('figcaption')?.textContent).toContain('Offline')

  online = true
  act(() => {
    window.dispatchEvent(new Event('online'))
  })
  expect(tiles().length).toBeGreaterThan(0)
  expect(tiles().every((tile) => !tile.hidden)).toBe(true)
  expect(container.querySelector('figcaption')?.textContent).not.toContain('did not load')
})
