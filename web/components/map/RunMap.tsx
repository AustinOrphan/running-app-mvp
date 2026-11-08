import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  CUT_ENDS_LINE,
  MAP_OFF_LINE,
  MAP_OFF_LINK,
  OSM_COPYRIGHT_URL,
  OSM_CREDIT,
  routeAloneLine,
  routeSummary,
} from '../../../shared/copy/runMap.ts'
import {
  metresPerPixel,
  pointAtDistance,
  scaleBar,
  tilesFor,
  tileUrl,
  toBox,
  viewFor,
  type Pixel,
} from '../../../shared/domain/mapTiles.ts'
import { decodePolyline } from '../../../shared/importers/files/track.ts'
import type { ActivityTrackView, Units } from '../../../shared/types.ts'
import { Skeleton } from '../Skeleton.tsx'
import { useOnline } from '../useOnline.ts'
import type { DistanceCursor } from './distanceCursor.ts'
import styles from './RunMap.module.css'
import { useMapTiles } from './useMapTiles.ts'

/** Space kept clear between the route and the edge of the box, in CSS pixels. */
const FIT_PADDING = 28
/** The scale bar is never longer than this share of the box, nor this many pixels. */
const SCALE_MAX_SHARE = 0.4
const SCALE_MAX_PX = 140

export interface RunMapProps {
  track: ActivityTrackView
  units: Units
  /** The activity's distance; the track's own length stands in when it has none. */
  distanceM: number | null
  /** The distance a chart points at; the dot follows it. Optional: a map without charts has none. */
  cursor?: DistanceCursor
}

interface Box {
  width: number
  height: number
}

/** The size of an element, kept current by a ResizeObserver. */
function useBox(ref: React.RefObject<HTMLElement | null>): Box | null {
  const [box, setBox] = useState<Box | null>(null)
  useLayoutEffect(() => {
    const element = ref.current
    if (element === null) return undefined
    const read = (width: number, height: number) => {
      if (width <= 0 || height <= 0) return
      setBox((previous) =>
        previous !== null && previous.width === width && previous.height === height
          ? previous
          : { width, height },
      )
    }
    const rect = element.getBoundingClientRect()
    read(rect.width, rect.height)
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (entry !== undefined) read(entry.contentRect.width, entry.contentRect.height)
    })
    observer.observe(element)
    return () => {
      observer.disconnect()
    }
  }, [ref])
  return box
}

/**
 * The route of a run drawn on a street map, with no map library: OpenStreetMap raster tiles placed
 * as images by the tile maths in `shared/domain/mapTiles.ts`, the route as an SVG line over them.
 * A static fit: no drag, no wheel, no zoom. The tiles are muted by a CSS filter (and inverted in
 * dark mode); with the Map tiles switch off, offline, or when they fail to load, the route is drawn
 * alone on the paper with its scale bar. A dot follows the distance a chart points at.
 */
export function RunMap({ track, units, distanceM, cursor }: RunMapProps) {
  const frameRef = useRef<HTMLDivElement>(null)
  const dotRef = useRef<HTMLSpanElement>(null)
  const box = useBox(frameRef)
  const online = useOnline()
  const tilesSwitch = useMapTiles().on
  const wantTiles = tilesSwitch && online
  const [failed, setFailed] = useState<ReadonlySet<string>>(() => new Set())

  const path = useMemo(() => decodePolyline(track.polyline), [track.polyline])
  const density = typeof window === 'undefined' ? 1 : window.devicePixelRatio
  const view = useMemo(
    () =>
      box === null
        ? null
        : viewFor(track.bbox, box.width, box.height, { padding: FIT_PADDING, density }),
    [box, track.bbox, density],
  )
  const points = useMemo<Pixel[]>(
    () => (view === null ? [] : path.map(([lat, lng]) => toBox(view, lat, lng))),
    [view, path],
  )
  const tiles = useMemo(() => (view !== null && wantTiles ? tilesFor(view) : []), [view, wantTiles])
  const failedNow = tiles.filter((tile) => failed.has(tile.key)).length
  const tilesAllFailed = tiles.length > 0 && failedNow === tiles.length
  const showCredit = tiles.length > 0 && !tilesAllFailed

  // The dot: written straight to its element, so a pointer moving over a chart renders nothing.
  useEffect(() => {
    const dot = dotRef.current
    if (dot === null) return undefined
    const place = (distM: number | null) => {
      const at = distM === null ? null : pointAtDistance(points, track.distM, distM)
      if (at === null) {
        dot.hidden = true
        return
      }
      dot.style.transform = `translate(${at.x.toFixed(1)}px, ${at.y.toFixed(1)}px)`
      dot.hidden = false
    }
    place(cursor?.get() ?? null)
    return cursor?.subscribe(place)
  }, [cursor, points, track.distM])

  const first = points[0]
  const last = points.at(-1)
  const hidden = track.endsHiddenM > 0
  const scale =
    view === null
      ? null
      : scaleBar(metresPerPixel(view), units, Math.min(SCALE_MAX_PX, view.width * SCALE_MAX_SHARE))
  const summary = routeSummary(distanceM ?? track.distM.at(-1) ?? null, units, track.endsHiddenM)
  const note = !tilesSwitch ? (
    <>
      {MAP_OFF_LINE} <Link to="/settings">{MAP_OFF_LINK}</Link>
    </>
  ) : !online ? (
    routeAloneLine('offline')
  ) : tilesAllFailed ? (
    routeAloneLine('failed')
  ) : null

  return (
    <figure className={styles.map}>
      <div className={styles.frame} ref={frameRef}>
        {view === null ? null : (
          <>
            <div role="img" aria-label="Map of the route" className={styles.picture}>
              {tiles.length > 0 ? (
                <div className={styles.tiles} aria-hidden="true">
                  {tiles.map((tile) => (
                    <img
                      key={tile.key}
                      src={tileUrl(tile)}
                      alt=""
                      width={tile.width}
                      height={tile.height}
                      style={{ left: tile.left, top: tile.top }}
                      className={styles.tile}
                      draggable={false}
                      decoding="async"
                      referrerPolicy="strict-origin-when-cross-origin"
                      hidden={failed.has(tile.key)}
                      onError={() => {
                        setFailed((previous) => new Set(previous).add(tile.key))
                      }}
                    />
                  ))}
                </div>
              ) : null}
              <svg
                className={styles.trace}
                width={view.width}
                height={view.height}
                viewBox={`0 0 ${String(view.width)} ${String(view.height)}`}
                aria-hidden="true"
                focusable="false"
              >
                <polyline
                  className={styles.casing}
                  points={points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')}
                />
                <polyline
                  className={styles.line}
                  points={points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')}
                />
              </svg>
              {first === undefined || last === undefined ? null : hidden ? (
                <>
                  <span
                    className={styles.cut}
                    data-marker="cut-start"
                    style={{ transform: `translate(${String(first.x)}px, ${String(first.y)}px)` }}
                  />
                  <span
                    className={styles.cut}
                    data-marker="cut-end"
                    style={{ transform: `translate(${String(last.x)}px, ${String(last.y)}px)` }}
                  />
                </>
              ) : (
                <>
                  <span
                    className={styles.start}
                    data-marker="start"
                    style={{ transform: `translate(${String(first.x)}px, ${String(first.y)}px)` }}
                  />
                  <span
                    className={styles.finish}
                    data-marker="finish"
                    style={{ transform: `translate(${String(last.x)}px, ${String(last.y)}px)` }}
                  />
                </>
              )}
              <span ref={dotRef} className={styles.dot} data-marker="cursor" hidden />
            </div>
            {scale === null ? null : (
              <div className={styles.scale} aria-hidden="true" data-scale={scale.label}>
                <span className={styles.scaleBar} style={{ width: scale.px }} />
                <span>{scale.label}</span>
              </div>
            )}
            {showCredit ? (
              <a
                className={styles.credit}
                href={OSM_COPYRIGHT_URL}
                target="_blank"
                rel="noopener noreferrer"
              >
                {OSM_CREDIT}
              </a>
            ) : null}
          </>
        )}
      </div>
      <figcaption className={styles.caption}>
        <span>{summary}</span>
        {hidden ? <span>{` ${CUT_ENDS_LINE}`}</span> : null}
        {note === null ? null : <span className={styles.note}>{note}</span>}
      </figcaption>
    </figure>
  )
}

/** The map's place while the track loads: the frame at its height, so the page does not jump. */
export function RunMapLoading() {
  return (
    <div className={styles.map}>
      <div className={styles.frame}>
        <Skeleton lines={3} />
      </div>
    </div>
  )
}
