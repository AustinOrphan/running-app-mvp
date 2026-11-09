/**
 * The distance (metres from the start) a chart is pointing at, shared by the stream charts and the
 * run map. It is a small store outside React on purpose: a pointer moving over a chart changes it
 * dozens of times a second, and only the map's dot cares, so the dot moves by writing to its
 * element and no component renders again. `null` means no chart is being pointed at.
 */
export interface DistanceCursor {
  get: () => number | null
  set: (distM: number | null) => void
  subscribe: (listener: (distM: number | null) => void) => () => void
}

export function createDistanceCursor(): DistanceCursor {
  let current: number | null = null
  const listeners = new Set<(distM: number | null) => void>()
  return {
    get: () => current,
    set: (distM) => {
      if (distM === current) return
      current = distM
      for (const listener of listeners) listener(distM)
    },
    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}
