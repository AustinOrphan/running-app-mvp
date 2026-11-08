import { useCallback, useSyncExternalStore } from 'react'

/**
 * The Illustrations switch (visual design, section 5): a device setting like the theme, kept in
 * `localStorage` and off until the runner turns it on. A blocked or empty store reads as off.
 */
export const ILLUSTRATIONS_KEY = 'rl_illustrations'

const listeners = new Set<() => void>()

function read(): boolean {
  try {
    return localStorage.getItem(ILLUSTRATIONS_KEY) === 'on'
  } catch {
    return false
  }
}

// Where storage is blocked the choice still holds for the life of the page.
let fallback: boolean | null = null

function snapshot(): boolean {
  return fallback ?? read()
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
      fallback = null
    } catch {
      fallback = next
    }
    for (const listener of listeners) listener()
  }, [])
  return { on, setOn }
}
