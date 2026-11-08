import { useCallback, useSyncExternalStore } from 'react'

/**
 * The Illustrations switch (visual design, section 5): a device setting like the theme, kept in
 * `localStorage` and off until the runner turns it on. A blocked or empty store reads as off.
 */
export const ILLUSTRATIONS_KEY = 'rl_illustrations'

const listeners = new Set<() => void>()

// Where storage cannot be written (blocked, full or read-only) the choice still holds for the life
// of the page: `blockedChoice` is read while the last write failed, or while reading throws.
let blockedChoice = false
let writeFailed = false

function snapshot(): boolean {
  if (writeFailed) return blockedChoice
  try {
    return localStorage.getItem(ILLUSTRATIONS_KEY) === 'on'
  } catch {
    return blockedChoice
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  // another tab changing the switch
  const onStorage = (event: StorageEvent) => {
    if (event.key === ILLUSTRATIONS_KEY || event.key === null) listener()
  }
  window.addEventListener('storage', onStorage)
  return () => {
    listeners.delete(listener)
    window.removeEventListener('storage', onStorage)
  }
}

/** Whether the drawings show, and the one way to change it. */
export function useIllustrations(): { on: boolean; setOn: (next: boolean) => void } {
  const on = useSyncExternalStore(subscribe, snapshot, () => false)
  const setOn = useCallback((next: boolean) => {
    try {
      localStorage.setItem(ILLUSTRATIONS_KEY, next ? 'on' : 'off')
      writeFailed = false
    } catch {
      writeFailed = true
      blockedChoice = next
    }
    for (const listener of listeners) listener()
  }, [])
  return { on, setOn }
}
